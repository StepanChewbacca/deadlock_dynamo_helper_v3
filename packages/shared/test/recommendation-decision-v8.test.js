const assert = require('node:assert/strict');
const {
  RECOMMENDATION_DECISION_V8_SCHEMA_VERSION,
  canonicalizeRecommendationDecisionV8,
  validateRecommendationDecisionV8,
} = require('../dist');

const shaA = 'a'.repeat(64);
const shaB = 'b'.repeat(64);

function validDecision() {
  return {
    schemaVersion: RECOMMENDATION_DECISION_V8_SCHEMA_VERSION,
    decisionId: 'decision-1',
    matchId: 'match-1',
    steamId: '76561198000000001',
    heroId: 35,
    teamId: 2,
    gameTimeSec: 420,
    observedAtMs: 1000,
    rulesetVersion: 'sha256:ruleset-fixture',
    rulesetSha256: shaA,
    catalogVersion: 'client-6101',
    catalogSha256: shaB,
    inventoryItemIds: [200, 100],
    economy: {
      evidence: 'VALIDATED',
      spendableSouls: 1800,
    },
    legalActions: [
      {
        actionId: 'UPGRADE:300:200',
        type: 'UPGRADE',
        itemId: 300,
        consumedComponentIds: [200],
        effectiveCost: 1750,
        soulsDelta: -1750,
        spendableSoulsAfter: 50,
      },
      {
        actionId: 'WAIT',
        type: 'WAIT',
        effectiveCost: 0,
        soulsDelta: 0,
        spendableSoulsAfter: 1800,
      },
      {
        actionId: 'SELL:100',
        type: 'SELL',
        itemId: 100,
        effectiveCost: 0,
        soulsDelta: 250,
        spendableSoulsAfter: 2050,
      },
    ],
    servedActionId: 'UPGRADE:300:200',
    exposure: {
      status: 'SHOWN_ACKED',
      exposedActionIds: ['UPGRADE:300:200', 'WAIT'],
      acknowledgedAtMs: 1010,
    },
    observedAction: {
      actionIds: ['UPGRADE:300:200'],
      confidence: 'EXACT_SINGLE_ACTION',
      observedAtGameTimeSec: 430,
    },
  };
}

const valid = validDecision();
assert.deepEqual(validateRecommendationDecisionV8(valid), { ok: true, issues: [] });

const canonical = canonicalizeRecommendationDecisionV8(valid);
assert.deepEqual(canonical.inventoryItemIds, [100, 200]);
assert.deepEqual(
  canonical.legalActions.map((action) => action.actionId),
  ['SELL:100', 'UPGRADE:300:200', 'WAIT'],
);
assert.deepEqual(canonical.exposure.exposedActionIds, ['UPGRADE:300:200', 'WAIT']);

const noEconomy = validDecision();
noEconomy.economy = { evidence: 'UNAVAILABLE' };
noEconomy.legalActions = [
  {
    actionId: 'WAIT',
    type: 'WAIT',
    effectiveCost: 0,
    soulsDelta: 0,
    spendableSoulsAfter: 0,
  },
];
delete noEconomy.servedActionId;
noEconomy.exposure = { status: 'NOT_SHOWN', exposedActionIds: [] };
delete noEconomy.observedAction;
assert.equal(validateRecommendationDecisionV8(noEconomy).ok, true);

const leakedSpendable = validDecision();
leakedSpendable.economy = { evidence: 'UNAVAILABLE', spendableSouls: 1800 };
assert.ok(
  validateRecommendationDecisionV8(leakedSpendable).issues.some(
    (issue) => issue.code === 'INVALID_ECONOMY',
  ),
);

const illegalObservedAction = validDecision();
illegalObservedAction.observedAction.actionIds = ['BUY:999'];
assert.ok(
  validateRecommendationDecisionV8(illegalObservedAction).issues.some(
    (issue) => issue.code === 'OBSERVED_ACTION_NOT_LEGAL',
  ),
);

const illegalExposure = validDecision();
illegalExposure.exposure.exposedActionIds.push('BUY:999');
assert.ok(
  validateRecommendationDecisionV8(illegalExposure).issues.some(
    (issue) => issue.code === 'EXPOSED_ACTION_NOT_LEGAL',
  ),
);

const missingWait = validDecision();
missingWait.legalActions = missingWait.legalActions.filter((action) => action.type !== 'WAIT');
assert.ok(
  validateRecommendationDecisionV8(missingWait).issues.some(
    (issue) => issue.code === 'WAIT_ACTION_MISSING',
  ),
);

console.log('recommendation decision v8 contract: PASS');
