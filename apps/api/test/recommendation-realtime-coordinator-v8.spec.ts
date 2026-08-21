import { assignRecommendationExperimentByMatchV1 } from '@deadlock-live-probe/shared';
import { RecommendationRealtimeCoordinatorV8Service } from '../src/deadlock-live/recommendation-realtime-coordinator-v8.service';

describe('RecommendationRealtimeCoordinatorV8Service', () => {
  function request() {
    return {
      eventId: 'evt-decision-1',
      decisionId: 'decision-1',
      matchId: 'match-1',
      playerKey: 'player-1',
      playerSlot: 1,
      decisionAtMs: 10_000,
      candidateGeneratorVersion: 'feasible-v8',
      modelVersion: 'behavioral-v8',
      runtimeMode: 'SHADOW' as const,
      observabilityGatePassed: true,
      modelRuntimeCompatible: true,
      shadowGatePassed: false,
      experiment: assignRecommendationExperimentByMatchV1('control', 'match-1', [
        { arm: 'CONTROL', probability: 1 },
      ]),
      selectionMode: 'DETERMINISTIC' as const,
    };
  }

  it('builds causal realtime state, creates the decision, and persists it internally', async () => {
    const realtimeState = {
      build: jest.fn(async () => ({
        ready: true,
        blockers: [],
        state: { decisionId: 'decision-1' },
        itemGraph: { graph: true },
        featureState: { decisionId: 'decision-1' },
        stateRevision: 'recommendation-state-v8:abc',
        versions: {
          client: 'client-1',
          gep: 'gep-1',
          normalizer: 'gep-canonical-v2',
          ruleset: 'ruleset-1',
          catalogSha256: 'a'.repeat(64),
        },
        quality: {
          directlyObserved: true,
          reconstructed: false,
          stale: false,
          alignmentAgeMs: 20,
        },
      })),
    };
    const decisionResult = {
      event: { eventId: 'evt-decision-1' },
      fallbackUsed: false,
      fallbackReasons: [],
    };
    const decisionService = {
      createDecision: jest.fn(() => decisionResult),
    };
    const telemetryIngest = {
      appendInternal: jest.fn(async () => ({
        status: 'APPENDED' as const,
        eventId: 'evt-decision-1',
        deduplicationKey: 'dedupe-1',
      })),
    };
    const service = new RecommendationRealtimeCoordinatorV8Service(
      realtimeState as never,
      decisionService as never,
      telemetryIngest as never,
    );

    const result = await service.decide(request());

    expect(result.ready).toBe(true);
    expect(result.persistence?.status).toBe('APPENDED');
    expect(decisionService.createDecision).toHaveBeenCalledWith(expect.objectContaining({
      playerKey: 'player-1',
      stateRevision: 'recommendation-state-v8:abc',
      source: 'RECOMMENDATION_REALTIME_V8',
    }));
    expect(telemetryIngest.appendInternal).toHaveBeenCalledWith(decisionResult.event);
  });

  it('does not create or persist a decision when the realtime state bridge is blocked', async () => {
    const realtimeState = {
      build: jest.fn(async () => ({
        ready: false,
        blockers: ['CATALOG_ALIGNMENT_MISMATCH'],
      })),
    };
    const decisionService = { createDecision: jest.fn() };
    const telemetryIngest = { appendInternal: jest.fn() };
    const service = new RecommendationRealtimeCoordinatorV8Service(
      realtimeState as never,
      decisionService as never,
      telemetryIngest as never,
    );

    const result = await service.decide(request());

    expect(result).toEqual({ ready: false, blockers: ['CATALOG_ALIGNMENT_MISMATCH'] });
    expect(decisionService.createDecision).not.toHaveBeenCalled();
    expect(telemetryIngest.appendInternal).not.toHaveBeenCalled();
  });
});
