import {
  RECOMMENDATION_TELEMETRY_CONTRACT_VERSION,
  RECOMMENDATION_TELEMETRY_SCHEMA_VERSION,
  PlayerStateEventV8,
} from '@deadlock-live-probe/shared';
import {
  RecommendationTelemetryIngestV8Service,
  parseDirectShopSourceAllowlist,
} from '../src/deadlock-live/recommendation-telemetry-ingest-v8.service';

const DIRECT_SHOP_ALLOWLIST_ENV = 'RECOMMENDATION_DIRECT_SHOP_SOURCE_ALLOWLIST';

describe('RecommendationTelemetryIngestV8Service', () => {
  const originalDirectShopAllowlist = process.env[DIRECT_SHOP_ALLOWLIST_ENV];

  function event(): PlayerStateEventV8 {
    return {
      schemaVersion: RECOMMENDATION_TELEMETRY_SCHEMA_VERSION,
      contractVersion: RECOMMENDATION_TELEMETRY_CONTRACT_VERSION,
      eventId: 'evt-1',
      eventType: 'PLAYER_STATE',
      matchId: 'm1',
      playerKey: 'p1',
      source: 'OVERWOLF_GEP',
      sourceOccurredAtMs: 1000,
      receivedAtMs: 1010,
      versions: {
        client: 'client-1',
        gep: 'gep-1',
        normalizer: 'gep-canonical-v2',
        ruleset: 'r1',
        catalogSha256: 'a'.repeat(64),
      },
      quality: {
        directlyObserved: true,
        reconstructed: false,
        stale: false,
        alignmentAgeMs: 10,
      },
      payload: {
        heroId: 1,
        soulsRaw: 3510,
        shopOpportunity: 'UNKNOWN',
      },
    };
  }

  afterEach(() => {
    if (originalDirectShopAllowlist === undefined) delete process.env[DIRECT_SHOP_ALLOWLIST_ENV];
    else process.env[DIRECT_SHOP_ALLOWLIST_ENV] = originalDirectShopAllowlist;
  });

  it('keeps raw souls unverified until controlled evidence passes', async () => {
    const append = jest.fn(async (value) => value);
    const service = new RecommendationTelemetryIngestV8Service(
      { append, reject: jest.fn() } as never,
      {
        report: jest.fn(async () => ({
          contractVersion: 'souls-affordability-v1',
          canMarkSpendableSoulsVerified: false,
        })),
      } as never,
    );

    await service.appendExternal(event());
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][0].payload.spendableSoulsVerified).toBeUndefined();
  });

  it('marks raw souls verified only after the controlled evidence report passes', async () => {
    const append = jest.fn(async (value) => value);
    const service = new RecommendationTelemetryIngestV8Service(
      { append, reject: jest.fn() } as never,
      {
        report: jest.fn(async () => ({
          contractVersion: 'souls-affordability-v1',
          canMarkSpendableSoulsVerified: true,
        })),
      } as never,
    );

    await service.appendExternal(event());
    expect(append.mock.calls[0][0].payload.spendableSoulsVerified).toEqual({
      value: 3510,
      verificationContractVersion: 'souls-affordability-v1:PASS',
    });
  });

  it('rejects and records client self-asserted spendable souls verification', async () => {
    const append = jest.fn();
    const reject = jest.fn();
    const service = new RecommendationTelemetryIngestV8Service(
      { append, reject } as never,
      { report: jest.fn() } as never,
    );
    const selfAsserted = event();
    selfAsserted.payload.spendableSoulsVerified = {
      value: 3510,
      verificationContractVersion: 'fake:PASS',
    };

    await expect(service.appendExternal(selfAsserted)).rejects.toThrow(/must not self-assert/);
    expect(append).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledWith(selfAsserted, ['EXTERNAL_SPENDABLE_SOULS_VERIFICATION_FORBIDDEN']);
  });

  it('rejects a client direct-shop claim until the exact source is server-approved', async () => {
    delete process.env[DIRECT_SHOP_ALLOWLIST_ENV];
    const append = jest.fn();
    const reject = jest.fn();
    const service = new RecommendationTelemetryIngestV8Service(
      { append, reject } as never,
      { report: jest.fn() } as never,
    );
    const directShop = event();
    directShop.payload.shopOpportunity = 'AVAILABLE';
    directShop.payload.shopOpportunityProvenance = {
      type: 'DIRECT_SOURCE_SIGNAL',
      sourceField: 'onInfoUpdates2|match_info|match_info|candidate_shop_state',
    };

    await expect(service.appendExternal(directShop)).rejects.toThrow(/not server-approved/);
    expect(append).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledWith(directShop, ['EXTERNAL_DIRECT_SHOP_SOURCE_NOT_APPROVED']);
  });

  it('accepts a direct-shop claim only for an exact server-approved source key', async () => {
    const sourceField = 'onInfoUpdates2|match_info|match_info|candidate_shop_state';
    process.env[DIRECT_SHOP_ALLOWLIST_ENV] = `OVERWOLF_GEP:${sourceField}`;
    const append = jest.fn(async (value) => value);
    const reject = jest.fn();
    const service = new RecommendationTelemetryIngestV8Service(
      { append, reject } as never,
      {
        report: jest.fn(async () => ({
          contractVersion: 'souls-affordability-v1',
          canMarkSpendableSoulsVerified: false,
        })),
      } as never,
    );
    const directShop = event();
    directShop.payload.shopOpportunity = 'UNAVAILABLE';
    directShop.payload.shopOpportunityProvenance = {
      type: 'DIRECT_SOURCE_SIGNAL',
      sourceField,
    };

    await service.appendExternal(directShop);

    expect(reject).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledWith(directShop);
  });

  it('parses the direct-shop source allowlist conservatively', () => {
    expect([...parseDirectShopSourceAllowlist(' OVERWOLF_GEP:a ,OVERWOLF_GEP:b,, ')]).toEqual([
      'OVERWOLF_GEP:a',
      'OVERWOLF_GEP:b',
    ]);
    expect([...parseDirectShopSourceAllowlist(undefined)]).toEqual([]);
  });

  it('rejects server-owned decision telemetry on the external endpoint', async () => {
    const append = jest.fn();
    const reject = jest.fn();
    const service = new RecommendationTelemetryIngestV8Service(
      { append, reject } as never,
      { report: jest.fn() } as never,
    );
    const decision = {
      ...event(),
      eventType: 'RECOMMENDATION_DECISION' as const,
      payload: {},
    };

    await expect(service.appendExternal(decision as never)).rejects.toThrow(/server-owned/);
    expect(append).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledWith(decision, ['SERVER_OWNED_EVENT_TYPE']);
  });
});
