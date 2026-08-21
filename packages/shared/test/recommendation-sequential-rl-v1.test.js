const assert = require('node:assert/strict');
const {
  RECOMMENDATION_FEATURE_CONTRACT_VERSION,
  evaluateRecommendationSequentialDatasetV1,
} = require('../dist');

function state(decisionId, decisionAtMs) {
  return {
    contractVersion: RECOMMENDATION_FEATURE_CONTRACT_VERSION,
    decisionId,
    matchId: 'm1',
    playerKey: 'p1',
    decisionAtMs,
    stateSourceAtMs: decisionAtMs - 100,
    gameTimeSec: decisionAtMs / 1000,
    heroId: 1,
    verifiedSpendableSouls: 1600,
    spendableSoulsVerificationContract: 'souls-affordability-v1:PASS',
    shopOpportunity: 'AVAILABLE',
    inventorySnapshotSha256: 'a'.repeat(64),
    inventory: [],
    history: [],
    rulesetVersion: 'r1',
    catalogSha256: 'b'.repeat(64),
  };
}

const valid = [
  {
    transitionId: 't1',
    matchId: 'm1',
    playerKey: 'p1',
    decisionId: 'd1',
    state: state('d1', 10_000),
    action: { actionKey: 'BUY_ITEM:1', actionType: 'BUY_ITEM', targetItemId: 1, effectiveCostSouls: 800 },
    reward: 0.5,
    actionLoggingPropensity: 0.5,
    loggingPropensitySource: 'RECORDED_AT_ASSIGNMENT',
    nextState: state('d2', 20_000),
    terminal: false,
    rulesetVersion: 'r1',
    catalogSha256: 'b'.repeat(64),
  },
  {
    transitionId: 't2',
    matchId: 'm1',
    playerKey: 'p1',
    decisionId: 'd2',
    state: state('d2', 20_000),
    action: { actionKey: 'WAIT_SAVE', actionType: 'WAIT_SAVE', effectiveCostSouls: 0 },
    reward: 1,
    actionLoggingPropensity: 1,
    loggingPropensitySource: 'RECORDED_AT_ASSIGNMENT',
    terminal: true,
    rulesetVersion: 'r1',
    catalogSha256: 'b'.repeat(64),
  },
];
const report = evaluateRecommendationSequentialDatasetV1(valid);
assert.equal(report.canRunSequentialRlResearch, true);
assert.equal(report.transitionCount, 2);
assert.equal(report.terminalTransitionCount, 1);

const future = structuredClone(valid);
future[0].nextState.decisionAtMs = 9_000;
assert.equal(evaluateRecommendationSequentialDatasetV1(future).canRunSequentialRlResearch, false);
assert(evaluateRecommendationSequentialDatasetV1(future).futureLeakageTransitionIds.includes('t1'));

const reconstructed = structuredClone(valid);
reconstructed[0].loggingPropensitySource = 'RECONSTRUCTED';
assert(evaluateRecommendationSequentialDatasetV1(reconstructed).reconstructedPropensityTransitionIds.includes('t1'));

const patchMismatch = structuredClone(valid);
patchMismatch[0].nextState.catalogSha256 = 'c'.repeat(64);
assert(evaluateRecommendationSequentialDatasetV1(patchMismatch).rulesetMismatchTransitionIds.includes('t1'));

console.log('recommendation sequential rl v1 fixtures: PASS');
