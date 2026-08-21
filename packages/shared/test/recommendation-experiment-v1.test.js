const assert = require('node:assert/strict');
const {
  assignRecommendationExperimentByMatchV1,
  selectSafeExplorationActionV1,
} = require('../dist');

const arms = [
  { arm: 'CONTROL', probability: 0.5 },
  { arm: 'BUILDLM', probability: 0.5 },
];

const first = assignRecommendationExperimentByMatchV1('exp-1', 'match-1', arms);
const repeated = assignRecommendationExperimentByMatchV1('exp-1', 'match-1', arms);
assert.deepEqual(repeated, first);
assert.equal(first.assignmentUnit, 'MATCH');
assert.equal(first.armAssignmentPropensity, 0.5);
assert.equal(first.randomized, true);

const exploration = selectSafeExplorationActionV1('exp-1', 'match-1', 'decision-1', [
  { actionKey: 'BUY_ITEM:1', legal: true, telemetryFresh: true, feasibilityKnown: true, probability: 0.6 },
  { actionKey: 'BUY_ITEM:2', legal: true, telemetryFresh: true, feasibilityKnown: true, probability: 0.25 },
  { actionKey: 'WAIT_SAVE', legal: true, telemetryFresh: true, feasibilityKnown: true, probability: 0.15 },
]);
assert(['BUY_ITEM:1', 'BUY_ITEM:2', 'WAIT_SAVE'].includes(exploration.actionKey));
assert(exploration.actionLoggingPropensity > 0);

assert.throws(
  () => selectSafeExplorationActionV1('exp-1', 'match-1', 'decision-2', [
    { actionKey: 'BUY_ITEM:1', legal: false, telemetryFresh: true, feasibilityKnown: true, probability: 0.5 },
    { actionKey: 'WAIT_SAVE', legal: true, telemetryFresh: true, feasibilityKnown: true, probability: 0.5 },
  ]),
  /ILLEGAL/,
);

assert.throws(
  () => assignRecommendationExperimentByMatchV1('exp-1', 'match-1', [
    { arm: 'A', probability: 0.7 },
    { arm: 'B', probability: 0.4 },
  ]),
  /sum to 1/,
);

console.log('recommendation experiment v1 fixtures: PASS');
