const assert = require('node:assert/strict');
const {
  ADAPTIVE_PLAN_SESSION_STATES_V1,
  ADAPTIVE_PLAN_STEP_STATES_V1,
  ADAPTIVE_PLAN_STEP_KINDS_V1,
  ADAPTIVE_PLAN_TRANSACTION_TYPES_V1,
  ADAPTIVE_PLAN_BARRIER_TYPES_V1,
} = require('../dist');

assert.deepEqual(ADAPTIVE_PLAN_SESSION_STATES_V1, [
  'ACTIVE',
  'WAITING',
  'REPLAN_REQUIRED',
  'COMPLETE',
]);
assert.deepEqual(ADAPTIVE_PLAN_STEP_STATES_V1, [
  'LOCKED',
  'BLOCKED',
  'READY',
  'NEXT',
  'IN_PROGRESS',
  'COMPLETED',
  'INVALIDATED',
  'SKIPPED',
]);
assert.deepEqual(ADAPTIVE_PLAN_STEP_KINDS_V1, ['TRANSACTION', 'BARRIER']);
assert.deepEqual(ADAPTIVE_PLAN_TRANSACTION_TYPES_V1, ['BUY', 'UPGRADE', 'SELL_AND_BUY']);
assert.deepEqual(ADAPTIVE_PLAN_BARRIER_TYPES_V1, [
  'WAIT_FOR_GOLD',
  'WAIT_FOR_FLEX',
  'WAIT_FOR_SHOP',
  'WAIT_FOR_PREREQUISITE',
]);

const projectionBefore = {
  inventoryItemIds: [101],
  spendableSouls: 1000,
  usedByType: { weapon: 0, vitality: 1, spirit: 0 },
  flexUsed: 0,
  unlockedFlexSlots: 0,
  activeItemsUsed: 0,
};

const replacement = {
  stepId: 'step:replace',
  goalId: 'goal:late-core',
  kind: 'TRANSACTION',
  state: 'NEXT',
  action: {
    type: 'SELL_AND_BUY',
    sellItemId: 101,
    buyItemId: 202,
  },
  prerequisiteStepIds: [],
  blockingReasons: [],
  projectedBefore: projectionBefore,
  projectedAfter: {
    inventoryItemIds: [202],
    spendableSouls: 200,
    usedByType: { weapon: 0, vitality: 1, spirit: 0 },
    flexUsed: 0,
    unlockedFlexSlots: 0,
    activeItemsUsed: 0,
  },
  reasonCodes: ['SLOT_REPLACEMENT'],
};

const waitForFlex = {
  stepId: 'step:flex',
  goalId: 'goal:late-core',
  kind: 'BARRIER',
  state: 'BLOCKED',
  barrier: {
    type: 'WAIT_FOR_FLEX',
    targetItemId: 202,
    requiredUnlockedFlexSlots: 2,
  },
  prerequisiteStepIds: [],
  blockingReasons: ['INSUFFICIENT_FLEX'],
  projectedBefore: projectionBefore,
  reasonCodes: ['WAIT_FOR_FLEX'],
};

const session = {
  planSessionId: 'plan:s',
  strategyId: 'strategy:s',
  revision: 1,
  createdAtGameTimeSec: 300,
  updatedAtGameTimeSec: 300,
  state: 'ACTIVE',
  steps: [replacement, waitForFlex],
  nextStepId: replacement.stepId,
  reasonCodes: [],
};

const roundTrip = JSON.parse(JSON.stringify(session));
assert.deepEqual(roundTrip, session);
assert.equal(roundTrip.steps[0].action.sellItemId, 101);
assert.equal(roundTrip.steps[0].action.buyItemId, 202);
assert.equal(roundTrip.steps[1].barrier.requiredUnlockedFlexSlots, 2);

console.log('adaptive transaction plan v1 contract: PASS');
