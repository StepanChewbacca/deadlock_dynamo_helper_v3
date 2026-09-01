const assert = require('node:assert/strict');
const {
  RECOMMENDATION_BEHAVIORAL_RUNTIME_VERSION,
  RECOMMENDATION_FEATURE_CONTRACT_VERSION,
  createRecommendationBehavioralLinearRuntimePredictorV1,
  createRecommendationBehavioralV8LinearModel,
  evaluateRecommendationBehavioralV8Linear,
  predictRecommendationBehavioralRuntimeV1,
  predictRecommendationBehavioralV8Linear,
  recommendationStateTokensV8,
  trainRecommendationBehavioralV8LinearDecision,
  validateRecommendationFeatureStateV8,
  validateRawBehaviorProbabilityVectorV8,
} = require('../dist');

function state(overrides = {}) {
  return {
    contractVersion: RECOMMENDATION_FEATURE_CONTRACT_VERSION,
    decisionId: 'd1',
    matchId: 'm1',
    playerKey: 'player-1',
    decisionAtMs: 10_000,
    stateSourceAtMs: 9_900,
    gameTimeSec: 100,
    heroId: 1,
    level: 3,
    healthFraction: 0.8,
    verifiedSpendableSouls: 1600,
    spendableSoulsVerificationContract: 'souls-affordability-v1:PASS',
    shopOpportunity: 'AVAILABLE',
    inventorySnapshotSha256: 'a'.repeat(64),
    inventory: [],
    history: [
      { occurredAtMs: 8_000, eventType: 'PLAYER_STATE' },
      { occurredAtMs: 9_000, eventType: 'BUY', actionKey: 'BUY_ITEM:9', itemId: 9 },
    ],
    rulesetVersion: 'ruleset-1',
    catalogSha256: 'b'.repeat(64),
    ...overrides,
  };
}

const validState = state();
assert.deepEqual(validateRecommendationFeatureStateV8(validState), { valid: true, errors: [] });
assert(recommendationStateTokensV8(validState).includes('WALLET800:2'));
assert(!recommendationStateTokensV8(validState).some((token) => token.startsWith('NET_WORTH')));

const futureLeaking = state({ history: [{ occurredAtMs: 10_001, eventType: 'FUTURE' }] });
assert(validateRecommendationFeatureStateV8(futureLeaking).errors.includes('NON_CAUSAL_HISTORY_EVENT:0'));

const decision = {
  decisionId: 'd1',
  state: validState,
  candidates: [
    { actionKey: 'BUY_ITEM:1', actionType: 'BUY_ITEM', targetItemId: 1, effectiveCostSouls: 800, feasible: true },
    { actionKey: 'WAIT_SAVE', actionType: 'WAIT_SAVE', effectiveCostSouls: 0, feasible: true },
  ],
  observedActionKey: 'BUY_ITEM:1',
};

const model = createRecommendationBehavioralV8LinearModel('linear-v1', RECOMMENDATION_FEATURE_CONTRACT_VERSION, 1024);
const before = predictRecommendationBehavioralV8Linear(model, decision);
validateRawBehaviorProbabilityVectorV8(before);
assert.equal(before.candidates.reduce((sum, candidate) => sum + candidate.probability, 0), 1);

for (let index = 0; index < 200; index += 1) {
  trainRecommendationBehavioralV8LinearDecision(model, decision, {
    learningRate: 0.02,
    l2: 1e-5,
    gradientClip: 2,
  });
}
const after = predictRecommendationBehavioralV8Linear(model, decision);
validateRawBehaviorProbabilityVectorV8(after);
assert(after.observedActionProbability > before.observedActionProbability);
assert.equal(after.candidates[0].actionKey, 'BUY_ITEM:1');

const runtimePredictor = createRecommendationBehavioralLinearRuntimePredictorV1(model);
const runtimePrediction = predictRecommendationBehavioralRuntimeV1(runtimePredictor, decision);
assert.equal(runtimePrediction.candidates.length, decision.candidates.length);

const incompleteTransformer = {
  runtimeContract: RECOMMENDATION_BEHAVIORAL_RUNTIME_VERSION,
  family: 'SEQUENCE_TRANSFORMER',
  modelVersion: 'buildlm-v1',
  featureContractVersion: RECOMMENDATION_FEATURE_CONTRACT_VERSION,
  predict: (input) => ({
    decisionId: input.decisionId,
    probabilityContract: 'RAW_SOFTMAX_FEASIBLE_CHOICE_SET',
    candidates: [{ actionKey: 'WAIT_SAVE', score: 0, probability: 1, rank: 1 }],
    entropy: 0,
  }),
};
assert.throws(
  () => predictRecommendationBehavioralRuntimeV1(incompleteTransformer, decision),
  /exactly the feasible choice set/,
);

const evaluation = evaluateRecommendationBehavioralV8Linear(model, [decision]);
assert.equal(evaluation.candidateCoverage, 1);
assert.equal(evaluation.probabilityFloorApplied, false);
assert(Number.isFinite(evaluation.rawLogLoss));

assert.throws(
  () => trainRecommendationBehavioralV8LinearDecision(model, { ...decision, observedActionKey: 'BUY_ITEM:999' }, {
    learningRate: 0.01,
    l2: 0,
    gradientClip: 1,
  }),
  /outside the feasible candidate set/,
);

console.log('recommendation behavioral v8 fixtures: PASS');
