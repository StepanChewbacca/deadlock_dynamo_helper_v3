import {
  RECOMMENDATION_TELEMETRY_CONTRACT_VERSION,
  RECOMMENDATION_TELEMETRY_SCHEMA_VERSION,
} from '@deadlock-live-probe/shared';
import { RecommendationRuntimeHealthV8Service } from '../src/deadlock-live/recommendation-runtime-health-v8.service';

describe('RecommendationRuntimeHealthV8Service', () => {
  const versions = {
    client: 'client-1',
    gep: 'gep-1',
    normalizer: 'gep-canonical-v2',
    ruleset: 'ruleset-1',
    catalogSha256: 'a'.repeat(64),
  };

  it('emits a server-owned heartbeat through internal telemetry ingestion', async () => {
    const telemetryIngest = {
      appendInternal: jest.fn(async (event) => ({
        status: 'APPENDED' as const,
        eventId: event.eventId,
        deduplicationKey: 'dedupe-1',
      })),
    };
    const service = new RecommendationRuntimeHealthV8Service(telemetryIngest as never);

    const result = await service.emit({
      eventId: 'health-heartbeat-1',
      matchId: 'match-1',
      playerKey: 'player-1',
      occurredAtMs: 10_000,
      receivedAtMs: 10_010,
      versions,
      runtimeMode: 'SHADOW',
      healthType: 'HEARTBEAT',
      crashCountDelta: 0,
      recommendationReady: true,
      modelVersion: 'behavioral-v8',
    });

    expect(result.status).toBe('APPENDED');
    expect(telemetryIngest.appendInternal).toHaveBeenCalledTimes(1);
    expect(telemetryIngest.appendInternal).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: RECOMMENDATION_TELEMETRY_SCHEMA_VERSION,
      contractVersion: RECOMMENDATION_TELEMETRY_CONTRACT_VERSION,
      eventId: 'health-heartbeat-1',
      eventType: 'RECOMMENDATION_RUNTIME_HEALTH',
      source: 'RECOMMENDATION_RUNTIME_V8',
      sourceOccurredAtMs: 10_000,
      receivedAtMs: 10_010,
      payload: {
        runtimeMode: 'SHADOW',
        healthType: 'HEARTBEAT',
        crashCountDelta: 0,
        modelVersion: 'behavioral-v8',
        recommendationReady: true,
      },
      quality: {
        directlyObserved: true,
        reconstructed: false,
        stale: false,
        alignmentAgeMs: 0,
      },
    }));
  });

  it('emits crash recovery evidence with an explicit crash delta', async () => {
    const telemetryIngest = {
      appendInternal: jest.fn(async () => ({
        status: 'APPENDED' as const,
        eventId: 'health-crash-1',
        deduplicationKey: 'dedupe-2',
      })),
    };
    const service = new RecommendationRuntimeHealthV8Service(telemetryIngest as never);

    await service.emit({
      eventId: 'health-crash-1',
      matchId: 'match-1',
      occurredAtMs: 20_000,
      versions,
      runtimeMode: 'SHADOW',
      healthType: 'CRASH_RECOVERY',
      crashCountDelta: 1,
      recommendationReady: false,
    });

    expect(telemetryIngest.appendInternal).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        healthType: 'CRASH_RECOVERY',
        crashCountDelta: 1,
        recommendationReady: false,
      }),
    }));
  });

  it('rejects a heartbeat that reports crashes', () => {
    const telemetryIngest = { appendInternal: jest.fn() };
    const service = new RecommendationRuntimeHealthV8Service(telemetryIngest as never);

    expect(() => service.emit({
      eventId: 'health-invalid-1',
      matchId: 'match-1',
      occurredAtMs: 30_000,
      versions,
      runtimeMode: 'LIVE',
      healthType: 'HEARTBEAT',
      crashCountDelta: 1,
      recommendationReady: true,
    })).toThrow('HEARTBEAT crashCountDelta must be zero');
    expect(telemetryIngest.appendInternal).not.toHaveBeenCalled();
  });
});
