const assert = require('node:assert/strict');
const {
  EXACT_ACTION_PROPENSITY_SOURCE,
  RECOMMENDATION_FEATURE_CONTRACT_VERSION,
  buildRecommendationPolicyDistributionV1,
  createRecommendationValueV8Model,
  evaluateRecommendationValueV8,
  predictRecommendationValueV8,
  trainRecommendationValueV8Example,
  valueActionResidualVarianceV8,
} = require('../dist');

const state = {
  contractVersion: RECOMMENDATION_FEATURE_CONTRACT_VERSION,
  decisionId: 'd1',
  matchId: 'm1',
  playerKey: 'player-1',
  decisionAtMs: 10_000,
  stateSourceAtMs: 9_900,
  gameTimeSec: 100,
  heroId: 1,
  verifiedSpendableSouls: 1_600,
  spendableSoulsVerificationContract: 'souls-affordability-v1:PASS',
  shopOpportunity: 'AVAILABLE',
  inventorySnapshotSha256: 'a'.repeat(64),
  inventory: [],
  history: [],
  rulesetVersion: 'r1',
  catalogSha256: 'b'.repeat(64),
};
const buy = { actionKey: 'BUY_ITEM:1', actionType: 'BUY_ITEM', targetItemId: 1, effectiveCostSouls: 800 };
const wait = { actionKey: 'WAIT_SAVE', actionType: 'WAIT_SAVE', effectiveCostSouls: 0 };
const model = createRecommendationValueV8Model('value-linear-v1', RECOMMENDATION_FEATURE_CONTRACT_VERSION, 1024);

for (let index = 0; index < 200; index += 1) {
  trainRecommendationValueV8Example(model, {
    decisionId: `buy-${index}`,
    state: { ...state, decisionId: `buy-${index}` },
    action: buy,
    reward: 1,
    actionLoggingPropensity: 0.5,
    loggingPropensitySource: EXACT_ACTION_PROPENSITY_SOURCE,
  }, {
    learningRate: 0.01,
    l2: 1e-5,
    gradientClip: 5,
    maxImportanceWeight: 10,
  });
  trainRecommendationValueV8Example(model, {
    decisionId: `wait-${index}`,
    state: { ...state, decisionId: `wait-${index}` },
    action: wait,
    reward: 0,
    actionLoggingPropensity: 0.5,
    loggingPropensitySource: EXACT_ACTION_PROPENSITY_SOURCE,
  }, {
    learningRate: 0.01,
    l2: 1e-5,
    gradientClip: 5,
    maxImportanceWeight: 10,
  });
}

const buyValue = predictRecommendationValueV8(model, state, buy).value;
const waitValue = predictRecommendationValueV8(model, state, wait).value;
assert(buyValue > waitValue);
assert(valueActionResidualVarianceV8(model, state, [buy, wait]) > 0);

const evaluation = evaluateRecommendationValueV8(model, [
  {
    decisionId: 'eval-buy',
    state: { ...state, decisionId: 'eval-buy' },
    action: buy,
    reward: 1,
    actionLoggingPropensity: 0.5,
    loggingPropensitySource: EXACT_ACTION_PROPENSITY_SOURCE,
  },
  {
    decisionId: 'eval-wait',
    state: { ...state, decisionId: 'eval-wait' },
    action: wait,
    reward: 0,
    actionLoggingPropensity: 0.5,
    loggingPropensitySource: EXACT_ACTION_PROPENSITY_SOURCE,
  },
]);
assert.equal(evaluation.decisionCount, 2);
assert(Number.isFinite(evaluation.weightedMse));

assert.throws(() => trainRecommendationValueV8Example(model, {
  decisionId: 'bad-propensity',
  state,
  action: buy,
  reward: 1,
  actionLoggingPropensity: 0.5,
  loggingPropensitySource: 'RECONSTRUCTED',
}, {
  learningRate: 0.01,
  l2: 0,
  gradientClip: 1,
}), /Reconstructed action propensity is forbidden/);

const evidence = {
  spendableSouls: 'OBSERVED',
  shopOpportunity: 'OBSERVED',
  inventory: 'OBSERVED',
  ruleset: 'RECONSTRUCTED',
  transaction: 'RECONSTRUCTED',
};
const candidates = [
  {
    actionKey: 'BUY_ITEM:1',
    actionType: 'BUY_ITEM',
    targetItemId: 1,
    effectiveCostSouls: 800,
    feasible: true,
    feasibilityReasons: ['FEASIBLE'],
    affordable: true,
    slotLegal: true,
    recipeLegal: true,
    shopLegal: true,
    rulesetLegal: true,
    transactionMechanicsKnown: true,
    evidence,
    behaviorProbability: 0.5,
    valueScore: buyValue,
  },
  {
    actionKey: 'WAIT_SAVE',
    actionType: 'WAIT_SAVE',
    effectiveCostSouls: 0,
    feasible: true,
    feasibilityReasons: ['FEASIBLE'],
    affordable: 'UNKNOWN',
    slotLegal: true,
    recipeLegal: true,
    shopLegal: 'UNKNOWN',
    rulesetLegal: true,
    transactionMechanicsKnown: true,
    evidence,
    behaviorProbability: 0.5,
    valueScore: waitValue,
  },
];
const policy = buildRecommendationPolicyDistributionV1(candidates, {
  temperature: 1,
  behaviorRegularization: 0.1,
});
assert.equal(policy.selectedActionKey, 'BUY_ITEM:1');
assert(Math.abs(policy.candidates.reduce((sum, candidate) => sum + candidate.policyProbability, 0) - 1) < 1e-12);

const unsupported = structuredClone(candidates);
unsupported[0].behaviorProbability = 0;
const supportedPolicy = buildRecommendationPolicyDistributionV1(unsupported, {
  temperature: 1,
  behaviorRegularization: 0,
});
assert.equal(supportedPolicy.selectedActionKey, 'WAIT_SAVE');
assert(supportedPolicy.excludedActionKeys.includes('BUY_ITEM:1'));

console.log('recommendation value-policy v1 fixtures: PASS');
