const assert = require('node:assert/strict');
const {
  ADAPTIVE_ACTION_TYPES_V1,
  ADAPTIVE_PLAN_STATUSES_V1,
  ADAPTIVE_EVIDENCE_FRESHNESS_V1,
} = require('../dist');

assert.deepEqual(ADAPTIVE_ACTION_TYPES_V1, [
  'BUY',
  'UPGRADE',
  'SELL',
  'REPLACE',
  'WAIT',
  'HOLD',
  'CONTINUE_CORE',
  'ABSTAIN',
]);

assert.deepEqual(ADAPTIVE_PLAN_STATUSES_V1, ['OWNED', 'NEXT', 'PLANNED']);
assert.deepEqual(ADAPTIVE_EVIDENCE_FRESHNESS_V1, [
  'FRESH',
  'STALE_USABLE',
  'UNAVAILABLE',
  'PATCH_MISMATCH',
]);

for (const value of [
  ...ADAPTIVE_ACTION_TYPES_V1,
  ...ADAPTIVE_PLAN_STATUSES_V1,
  ...ADAPTIVE_EVIDENCE_FRESHNESS_V1,
]) {
  assert.equal(typeof value, 'string');
}

console.log('adaptive recommendation v1 contract: PASS');
