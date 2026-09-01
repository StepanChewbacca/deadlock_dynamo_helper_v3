import {
  RECOMMENDATION_BEHAVIORAL_V8_PROBABILITY_CONTRACT,
  RECOMMENDATION_FEATURE_CONTRACT_VERSION,
  RecommendationBehavioralV8Decision,
} from '@deadlock-live-probe/shared';
import { RecommendationBehavioralServingV1Service } from '../src/deadlock-live/recommendation-behavioral-serving-v1.service';

const originalFetch = global.fetch;
const originalUrl = process.env.RECOMMENDATION_BEHAVIORAL_SERVING_URL;
const originalToken = process.env.RECOMMENDATION_BEHAVIORAL_SERVING_TOKEN;
const manifestSha256 = 'a'.repeat(64);

function decision(): RecommendationBehavioralV8Decision {
  return {
    decisionId: 'decision-1',
    state: {
      contractVersion: RECOMMENDATION_FEATURE_CONTRACT_VERSION,
      decisionId: 'decision-1',
      matchId: 'match-1',
      playerKey: 'player-1',
      decisionAtMs: 10_000,
      stateSourceAtMs: 9_900,
      gameTimeSec: 100,
      heroId: 1,
      verifiedSpendableSouls: 2_000,
      spendableSoulsVerificationContract: 'souls-affordability-v1:PASS',
      shopOpportunity: 'AVAILABLE',
      inventorySnapshotSha256: 'b'.repeat(64),
      inventory: [],
      history: [],
      rulesetVersion: 'ruleset-1',
      catalogSha256: 'c'.repeat(64),
    },
    candidates: [
      {
        actionKey: 'BUY_ITEM:1',
        actionType: 'BUY_ITEM',
        targetItemId: 1,
        effectiveCostSouls: 500,
        feasible: true,
      },
      {
        actionKey: 'WAIT_SAVE',
        actionType: 'WAIT_SAVE',
        effectiveCostSouls: 0,
        feasible: true,
      },
    ],
  };
}

function okJson(value: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
}

function predictionResponse(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 'recommendation-behavioral-serving-response-v1',
    modelId: 'deadlock-buildlm-behavioral-v8',
    modelVersion: 'behavioral-v8-1',
    manifestSha256,
    family: 'SEQUENCE_TRANSFORMER',
    featureContractVersion: RECOMMENDATION_FEATURE_CONTRACT_VERSION,
    candidateGeneratorVersion: 'candidate-v1',
    decisionId: 'decision-1',
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V8_PROBABILITY_CONTRACT,
    candidates: [
      { actionKey: 'BUY_ITEM:1', score: 1.2, probability: 0.75, rank: 1 },
      { actionKey: 'WAIT_SAVE', score: 0.1, probability: 0.25, rank: 2 },
    ],
    entropy: 0.5623351446,
    inferenceLatencyMs: 4.5,
    probabilityFloorApplied: false,
    ...overrides,
  };
}

describe('RecommendationBehavioralServingV1Service', () => {
  beforeEach(() => {
    process.env.RECOMMENDATION_BEHAVIORAL_SERVING_URL = 'http://127.0.0.1:8098';
    process.env.RECOMMENDATION_BEHAVIORAL_SERVING_TOKEN = 'serving-secret';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.RECOMMENDATION_BEHAVIORAL_SERVING_URL;
    else process.env.RECOMMENDATION_BEHAVIORAL_SERVING_URL = originalUrl;
    if (originalToken === undefined) delete process.env.RECOMMENDATION_BEHAVIORAL_SERVING_TOKEN;
    else process.env.RECOMMENDATION_BEHAVIORAL_SERVING_TOKEN = originalToken;
    jest.restoreAllMocks();
  });

  it('accepts only an exact immutable model identity and full feasible candidate set', async () => {
    const fetchMock = jest.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer serving-secret');
      return okJson(predictionResponse());
    });
    global.fetch = fetchMock as typeof fetch;
    const service = new RecommendationBehavioralServingV1Service();

    const result = await service.predict({
      decision: decision(),
      modelVersion: 'behavioral-v8-1',
      featureContractVersion: RECOMMENDATION_FEATURE_CONTRACT_VERSION,
      candidateGeneratorVersion: 'candidate-v1',
      manifestSha256,
    });

    expect(result.manifestSha256).toBe(manifestSha256);
    expect(result.inferenceLatencyMs).toBe(4.5);
    expect(result.prediction.candidates.map((candidate) => candidate.actionKey).sort()).toEqual([
      'BUY_ITEM:1',
      'WAIT_SAVE',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a serving process loaded with a different manifest', async () => {
    global.fetch = jest.fn(async () => okJson(predictionResponse({ manifestSha256: 'd'.repeat(64) }))) as typeof fetch;
    const service = new RecommendationBehavioralServingV1Service();

    await expect(service.predict({
      decision: decision(),
      modelVersion: 'behavioral-v8-1',
      featureContractVersion: RECOMMENDATION_FEATURE_CONTRACT_VERSION,
      candidateGeneratorVersion: 'candidate-v1',
      manifestSha256,
    })).rejects.toThrow('BEHAVIORAL_SERVING_MANIFEST_SHA_MISMATCH');
  });

  it('rejects incomplete candidate coverage even when probabilities are normalized', async () => {
    global.fetch = jest.fn(async () => okJson(predictionResponse({
      candidates: [{ actionKey: 'WAIT_SAVE', score: 0.1, probability: 1, rank: 1 }],
    }))) as typeof fetch;
    const service = new RecommendationBehavioralServingV1Service();

    await expect(service.predict({
      decision: decision(),
      modelVersion: 'behavioral-v8-1',
      featureContractVersion: RECOMMENDATION_FEATURE_CONTRACT_VERSION,
      candidateGeneratorVersion: 'candidate-v1',
      manifestSha256,
    })).rejects.toThrow('BEHAVIORAL_SERVING_CANDIDATE_SET_MISMATCH');
  });

  it('validates readiness identity and refuses FUTURE_TEST-contaminated serving state', async () => {
    global.fetch = jest.fn(async () => okJson({
      contractVersion: 'recommendation-behavioral-serving-ready-v1',
      ready: true,
      modelId: 'deadlock-buildlm-behavioral-v8',
      modelVersion: 'behavioral-v8-1',
      manifestSha256,
      family: 'SEQUENCE_TRANSFORMER',
      featureContractVersion: RECOMMENDATION_FEATURE_CONTRACT_VERSION,
      candidateGeneratorVersion: 'candidate-v1',
      device: 'cuda:0',
      futureTestEvaluated: true,
    })) as typeof fetch;
    const service = new RecommendationBehavioralServingV1Service();

    await expect(service.ready()).rejects.toThrow('BEHAVIORAL_SERVING_FUTURE_TEST_VIOLATION');
  });
});
