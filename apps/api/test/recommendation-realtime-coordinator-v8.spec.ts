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

  function readyRealtimeState() {
    return {
      ready: true,
      blockers: [],
      state: { decisionId: 'decision-1' },
      itemGraph: { graph: true },
      featureState: {
        contractVersion: 'recommendation-features-v8',
        decisionId: 'decision-1',
      },
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
    };
  }

  function harness(options: { servingFails?: boolean } = {}) {
    const realtimeState = { build: jest.fn(async () => readyRealtimeState()) };
    const decisionResult = {
      event: { eventId: 'evt-decision-1' },
      fallbackUsed: false,
      fallbackReasons: [],
    };
    const decisionService = {
      prepareBehavioralDecision: jest.fn(() => ({
        domainCandidates: [],
        decision: {
          decisionId: 'decision-1',
          state: { contractVersion: 'recommendation-features-v8', decisionId: 'decision-1' },
          candidates: [{
            actionKey: 'WAIT_SAVE',
            actionType: 'WAIT_SAVE',
            effectiveCostSouls: 0,
            feasible: true,
          }],
        },
      })),
      createDecision: jest.fn(() => decisionResult),
    };
    const telemetryIngest = {
      appendInternal: jest.fn(async () => ({
        status: 'APPENDED' as const,
        eventId: 'evt-decision-1',
        deduplicationKey: 'dedupe-1',
      })),
    };
    const behavioralServing = {
      predict: options.servingFails
        ? jest.fn(async () => { throw new Error('serving unavailable'); })
        : jest.fn(async () => ({
            prediction: {
              decisionId: 'decision-1',
              probabilityContract: 'RAW_SOFTMAX_FEASIBLE_CHOICE_SET',
              candidates: [{ actionKey: 'WAIT_SAVE', score: 0, probability: 1, rank: 1 }],
              entropy: 0,
            },
            modelId: 'deadlock-buildlm-behavioral-v8',
            modelVersion: 'behavioral-v8',
            manifestSha256: 'b'.repeat(64),
            inferenceLatencyMs: 7.25,
          })),
    };
    const service = new RecommendationRealtimeCoordinatorV8Service(
      realtimeState as never,
      decisionService as never,
      telemetryIngest as never,
      behavioralServing as never,
    );
    return { service, realtimeState, decisionService, telemetryIngest, behavioralServing, decisionResult };
  }

  it('builds causal realtime state, creates the decision, and persists it internally', async () => {
    const { service, decisionService, telemetryIngest, decisionResult } = harness();

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
    const { service, realtimeState, decisionService, telemetryIngest } = harness();
    realtimeState.build.mockResolvedValueOnce({
      ready: false,
      blockers: ['CATALOG_ALIGNMENT_MISMATCH'],
    } as never);

    const result = await service.decide(request());

    expect(result).toEqual({ ready: false, blockers: ['CATALOG_ALIGNMENT_MISMATCH'] });
    expect(decisionService.createDecision).not.toHaveBeenCalled();
    expect(telemetryIngest.appendInternal).not.toHaveBeenCalled();
  });

  it('passes exact serving identity, prediction, and upstream latency into the decision path', async () => {
    const { service, decisionService, behavioralServing } = harness();

    const result = await service.decide(request(), {
      behavioralServing: {
        modelVersion: 'behavioral-v8',
        manifestSha256: 'b'.repeat(64),
      },
    });

    expect(result.ready).toBe(true);
    expect(behavioralServing.predict).toHaveBeenCalledWith(expect.objectContaining({
      modelVersion: 'behavioral-v8',
      featureContractVersion: 'recommendation-features-v8',
      candidateGeneratorVersion: 'feasible-v8',
      manifestSha256: 'b'.repeat(64),
    }));
    expect(decisionService.createDecision).toHaveBeenCalledWith(expect.objectContaining({
      behavioralPrediction: expect.objectContaining({ decisionId: 'decision-1' }),
      modelRuntimeCompatible: true,
      upstreamInferenceLatencyMs: 7.25,
      preInferenceBlockers: [],
    }));
  });

  it('fails closed when Behavioral serving is unavailable', async () => {
    const { service, decisionService, telemetryIngest } = harness({ servingFails: true });

    const result = await service.decide(request(), {
      behavioralServing: {
        modelVersion: 'behavioral-v8',
        manifestSha256: 'b'.repeat(64),
      },
    });

    expect(result.ready).toBe(true);
    expect(decisionService.createDecision).toHaveBeenCalledWith(expect.objectContaining({
      behavioralPrediction: undefined,
      modelRuntimeCompatible: false,
      upstreamInferenceLatencyMs: 0,
      preInferenceBlockers: ['BEHAVIORAL_SERVING_FAILED'],
    }));
    expect(telemetryIngest.appendInternal).toHaveBeenCalledTimes(1);
  });

  it('rejects ambiguous Behavioral runtime sources before touching realtime state', async () => {
    const { service, realtimeState, decisionService, behavioralServing } = harness();

    const result = await service.decide(request(), {
      behavioralModel: { modelVersion: 'linear-1' } as never,
      behavioralServing: {
        modelVersion: 'behavioral-v8',
        manifestSha256: 'b'.repeat(64),
      },
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('MULTIPLE_BEHAVIORAL_RUNTIME_SOURCES');
    expect(realtimeState.build).not.toHaveBeenCalled();
    expect(decisionService.createDecision).not.toHaveBeenCalled();
    expect(behavioralServing.predict).not.toHaveBeenCalled();
  });
});
