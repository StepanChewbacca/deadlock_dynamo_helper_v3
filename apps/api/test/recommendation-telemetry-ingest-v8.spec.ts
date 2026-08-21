import {
  RECOMMENDATION_TELEMETRY_CONTRACT_VERSION,
  RECOMMENDATION_TELEMETRY_SCHEMA_VERSION,
  PlayerStateEventV8,
} from '@deadlock-live-probe/shared';
import { RecommendationTelemetryIngestV8Service } from '../src/deadlock-live/recommendation-telemetry-ingest-v8.service';

describe('RecommendationTelemetryIngestV8Service', () => {
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

  it('keeps raw souls unverified until controlled evidence passes', async () => {
    const append = jest.fn(async (value) => value);
    const service = new RecommendationTelemetryIngestV8Service(
      { append } as never,
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
      { append } as never,
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

  it('rejects client self-asserted spendable souls verification', async () => {
    const append = jest.fn();
    const service = new RecommendationTelemetryIngestV8Service(
      { append } as never,
      { report: jest.fn() } as never,
    );
    const selfAsserted = event();
    selfAsserted.payload.spendableSoulsVerified = {
      value: 3510,
      verificationContractVersion: 'fake:PASS',
    };

    await expect(service.appendExternal(selfAsserted)).rejects.toThrow(/must not self-assert/);
    expect(append).not.toHaveBeenCalled();
  });
});
