const assert = require('node:assert/strict');
const { selectRecommendationRuntimeActionV8 } = require('../dist');

function candidates() {
  return [
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
      evidence: {
        spendableSouls: 'OBSERVED',
        shopOpportunity: 'OBSERVED',
        inventory: 'OBSERVED',
        ruleset: 'RECONSTRUCTED',
        transaction: 'RECONSTRUCTED',
      },
      behaviorProbability: 0.8,
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
      evidence: {
        spendableSouls: 'UNKNOWN',
        shopOpportunity: 'UNKNOWN',
        inventory: 'OBSERVED',
        ruleset: 'RECONSTRUCTED',
        transaction: 'RECONSTRUCTED',
      },
      behaviorProbability: 0.2,
    },
  ];
}

const shadow = selectRecommendationRuntimeActionV8({
  mode: 'SHADOW',
  telemetryFresh: true,
  observabilityGatePassed: true,
  modelRuntimeCompatible: true,
  shadowGatePassed: false,
  exactSpendableSoulsKnown: true,
  shopOpportunityKnown: true,
  candidates: candidates(),
});
assert.equal(shadow.selectedActionKey, 'BUY_ITEM:1');
assert.equal(shadow.userVisibleActionKey, undefined);
assert.equal(shadow.fallbackUsed, false);

const liveBlocked = selectRecommendationRuntimeActionV8({
  mode: 'LIVE',
  telemetryFresh: true,
  observabilityGatePassed: true,
  modelRuntimeCompatible: true,
  shadowGatePassed: false,
  exactSpendableSoulsKnown: true,
  shopOpportunityKnown: true,
  candidates: candidates(),
});
assert.equal(liveBlocked.selectedActionKey, 'WAIT_SAVE');
assert.equal(liveBlocked.userVisibleActionKey, 'WAIT_SAVE');
assert(liveBlocked.fallbackReasons.includes('SHADOW_GATE_NOT_PASS'));

const stale = selectRecommendationRuntimeActionV8({
  mode: 'LIVE',
  telemetryFresh: false,
  observabilityGatePassed: true,
  modelRuntimeCompatible: true,
  shadowGatePassed: true,
  exactSpendableSoulsKnown: true,
  shopOpportunityKnown: true,
  candidates: candidates(),
});
assert.equal(stale.selectedActionKey, 'WAIT_SAVE');
assert(stale.fallbackReasons.includes('STALE_TELEMETRY'));

const unknownTransaction = candidates();
unknownTransaction[0].transactionMechanicsKnown = false;
unknownTransaction[0].evidence.transaction = 'UNKNOWN';
const transactionBlocked = selectRecommendationRuntimeActionV8({
  mode: 'LIVE',
  telemetryFresh: true,
  observabilityGatePassed: true,
  modelRuntimeCompatible: true,
  shadowGatePassed: true,
  exactSpendableSoulsKnown: true,
  shopOpportunityKnown: true,
  candidates: unknownTransaction,
});
assert.equal(transactionBlocked.selectedActionKey, 'WAIT_SAVE');

const live = selectRecommendationRuntimeActionV8({
  mode: 'LIVE',
  telemetryFresh: true,
  observabilityGatePassed: true,
  modelRuntimeCompatible: true,
  shadowGatePassed: true,
  exactSpendableSoulsKnown: true,
  shopOpportunityKnown: true,
  candidates: candidates(),
});
assert.equal(live.selectedActionKey, 'BUY_ITEM:1');
assert.equal(live.userVisibleActionKey, 'BUY_ITEM:1');

console.log('recommendation runtime v8 fixtures: PASS');
