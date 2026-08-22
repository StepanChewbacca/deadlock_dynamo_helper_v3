import { RecommendationFeatureStoreV8Service } from '../src/deadlock-live/recommendation-feature-store-v8.service';

const SHOP_ALLOWLIST_ENV = 'RECOMMENDATION_DIRECT_SHOP_SOURCE_ALLOWLIST';
const SHOP_SOURCE_FIELD = 'onInfoUpdates2|match_info|match_info|shop_state';

function featureStoreHarness() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM recommendation_decisions_v8')) {
        return [{
          decisionId: 'decision-1',
          matchId: 'match-1',
          playerKey: 'player-1',
          decidedAt: '2026-08-22T00:00:10.000Z',
          gameTimeMs: 10_000,
          rulesetVersion: 'ruleset-1',
          catalogSha256: 'a'.repeat(64),
        }];
      }
      if (sql.includes("\"eventType\" = 'PLAYER_STATE'")) {
        return [{
          eventType: 'PLAYER_STATE',
          source: 'OVERWOLF_GEP',
          sourceOccurredAt: '2026-08-22T00:00:09.500Z',
          payload: {
            heroId: 1,
            shopOpportunity: 'AVAILABLE',
            shopOpportunityProvenance: {
              type: 'DIRECT_SOURCE_SIGNAL',
              sourceField: SHOP_SOURCE_FIELD,
            },
          },
        }];
      }
      if (sql.includes("\"eventType\" = 'INVENTORY_SNAPSHOT'")) {
        return [{
          eventType: 'INVENTORY_SNAPSHOT',
          source: 'OVERWOLF_GEP',
          sourceOccurredAt: '2026-08-22T00:00:09.600Z',
          payload: {
            snapshotSha256: 'b'.repeat(64),
            items: [],
          },
        }];
      }
      if (sql.includes('FROM item_catalog_items')) return [];
      return [];
    }),
  };
  return {
    calls,
    service: new RecommendationFeatureStoreV8Service(dataSource as never),
  };
}

describe('RecommendationFeatureStoreV8Service point-in-time causality', () => {
  const originalShopAllowlist = process.env[SHOP_ALLOWLIST_ENV];

  afterEach(() => {
    if (originalShopAllowlist === undefined) delete process.env[SHOP_ALLOWLIST_ENV];
    else process.env[SHOP_ALLOWLIST_ENV] = originalShopAllowlist;
  });

  it('excludes telemetry that was received after the decision timestamp', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const dataSource = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('FROM recommendation_decisions_v8')) {
          return [{
            decisionId: 'decision-1',
            matchId: 'match-1',
            playerKey: 'player-1',
            decidedAt: '2026-08-22T00:00:10.000Z',
            gameTimeMs: 10_000,
            rulesetVersion: 'ruleset-1',
            catalogSha256: 'a'.repeat(64),
          }];
        }
        return [];
      }),
    };
    const service = new RecommendationFeatureStoreV8Service(dataSource as never);

    await service.buildForDecision('decision-1');

    const player = calls.find((call) => call.sql.includes("\"eventType\" = 'PLAYER_STATE'"));
    const inventory = calls.find((call) => call.sql.includes("\"eventType\" = 'INVENTORY_SNAPSHOT'"));
    const history = calls.find((call) => call.sql.includes('LIMIT $4') && !call.sql.includes("\"eventType\" = 'PLAYER_STATE'"));

    expect(player?.sql).toContain('"sourceOccurredAt" <= $4');
    expect(player?.sql).toContain('"receivedAt" <= $4');
    expect(inventory?.sql).toContain('"sourceOccurredAt" <= $4');
    expect(inventory?.sql).toContain('"receivedAt" <= $4');
    expect(history?.sql).toContain('"sourceOccurredAt" < $3');
    expect(history?.sql).toContain('"receivedAt" <= $3');
  });

  it('downgrades historical unapproved direct shop telemetry to UNKNOWN', async () => {
    delete process.env[SHOP_ALLOWLIST_ENV];
    const harness = featureStoreHarness();

    const result = await harness.service.buildForDecision('decision-1', 5_000, 0);

    expect(result.ready).toBe(true);
    expect(result.featureState?.shopOpportunity).toBe('UNKNOWN');
  });

  it('preserves direct shop telemetry only when the exact source key is approved', async () => {
    process.env[SHOP_ALLOWLIST_ENV] = `OVERWOLF_GEP:${SHOP_SOURCE_FIELD}`;
    const harness = featureStoreHarness();

    const result = await harness.service.buildForDecision('decision-1', 5_000, 0);

    expect(result.ready).toBe(true);
    expect(result.featureState?.shopOpportunity).toBe('AVAILABLE');
  });
});
