const assert = require('node:assert/strict');
const { evaluateRecommendationObservabilityGateV1 } = require('../dist');

const ready = evaluateRecommendationObservabilityGateV1({
  decisionCount: 20_000,
  exactSpendableSoulsCoverage: 0.995,
  shopOpportunityCoverage: 0.995,
  inventorySnapshotCoverage: 0.9995,
  rulesetCatalogCoverage: 0.999,
  transactionMechanicsCoverage: 0.995,
  playerIdentityCoverage: 0.999,
  nonFutureStateTimestampRate: 1,
  directlyObservedStateRate: 0.995,
  staleStateRate: 0.005,
}, [
  {
    cohortKey: 'phase:late',
    decisionCount: 1_000,
    exactSpendableSoulsCoverage: 0.98,
    shopOpportunityCoverage: 0.99,
    inventorySnapshotCoverage: 0.999,
    rulesetCatalogCoverage: 0.999,
    transactionMechanicsCoverage: 0.98,
    playerIdentityCoverage: 0.999,
    nonFutureStateTimestampRate: 1,
    directlyObservedStateRate: 0.99,
    staleStateRate: 0.005,
  },
]);
assert.equal(ready.passed, true);
assert.equal(ready.evidenceSufficient, true);

const blocked = evaluateRecommendationObservabilityGateV1({
  decisionCount: 20_000,
  exactSpendableSoulsCoverage: 0,
  shopOpportunityCoverage: 0,
  inventorySnapshotCoverage: 1,
  rulesetCatalogCoverage: 1,
  transactionMechanicsCoverage: 0,
  playerIdentityCoverage: 1,
  nonFutureStateTimestampRate: 1,
  directlyObservedStateRate: 1,
  staleStateRate: 0,
});
assert.equal(blocked.passed, false);
assert(blocked.blockers.includes('EXACT_SPENDABLE_SOULS_COVERAGE'));
assert(blocked.blockers.includes('SHOP_OPPORTUNITY_COVERAGE'));
assert(blocked.blockers.includes('TRANSACTION_MECHANICS_COVERAGE'));

const insufficient = evaluateRecommendationObservabilityGateV1({
  decisionCount: 0,
  exactSpendableSoulsCoverage: 1,
  shopOpportunityCoverage: 1,
  inventorySnapshotCoverage: 1,
  rulesetCatalogCoverage: 1,
  transactionMechanicsCoverage: 1,
  playerIdentityCoverage: 1,
  nonFutureStateTimestampRate: 1,
  directlyObservedStateRate: 1,
  staleStateRate: 0,
});
assert.equal(insufficient.evidenceSufficient, false);
assert.equal(insufficient.passed, false);

console.log('recommendation observability gate v1 fixtures: PASS');
