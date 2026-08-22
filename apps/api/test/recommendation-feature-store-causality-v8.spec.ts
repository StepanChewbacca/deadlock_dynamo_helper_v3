import { RecommendationFeatureStoreV8Service } from '../src/deadlock-live/recommendation-feature-store-v8.service';

describe('RecommendationFeatureStoreV8Service point-in-time causality', () => {
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
});
