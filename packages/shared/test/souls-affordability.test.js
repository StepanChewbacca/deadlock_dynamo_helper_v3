const assert = require('node:assert/strict');
const {
  analyzeSoulsAffordabilityV1,
  SOULS_AFFORDABILITY_CONTRACT_VERSION,
} = require('../dist');

function observation(index, overrides = {}) {
  const sufficient = index < 90;
  const operation = index % 10 === 0 ? 'UPGRADE' : index % 9 === 0 ? 'SELL' : 'BUY';
  const effectiveCost = operation === 'SELL' ? 0 : 1000;
  const soulsRawBefore = operation === 'SELL' ? 1500 : sufficient ? 1500 : 500;
  return {
    observationId: `obs-${index}`,
    matchId: `match-${Math.floor(index / 10)}`,
    gameTimeSec: index * 10,
    operation,
    soulsRawBefore,
    hudSpendableBefore: soulsRawBefore,
    effectiveCost,
    operationSucceeded: operation === 'SELL' ? true : sufficient,
    soulsRawAfter: operation === 'SELL' ? 2000 : sufficient ? soulsRawBefore - effectiveCost : soulsRawBefore,
    hudSpendableAfter: operation === 'SELL' ? 2000 : sufficient ? soulsRawBefore - effectiveCost : soulsRawBefore,
    rulesetVersion: 'fixture-ruleset',
    catalogSha256: 'fixture-sha',
    ...overrides,
  };
}

const passing = Array.from({ length: 110 }, (_, index) => observation(index));
const passReport = analyzeSoulsAffordabilityV1(passing);
assert.equal(passReport.contractVersion, SOULS_AFFORDABILITY_CONTRACT_VERSION);
assert.equal(passReport.verdict, 'PASS');
assert.equal(passReport.gateFailures.length, 0);
assert.ok(passReport.operationCounts.UPGRADE > 0);
assert.ok(passReport.operationCounts.SELL > 0);

const insufficientEvidence = analyzeSoulsAffordabilityV1(passing.slice(0, 20));
assert.equal(insufficientEvidence.verdict, 'INSUFFICIENT_EVIDENCE');
assert.ok(insufficientEvidence.gateFailures.includes('MIN_OBSERVATION_COUNT_NOT_MET'));

const failing = passing.map((value) => ({ ...value }));
failing[0].hudSpendableBefore += 1;
const failReport = analyzeSoulsAffordabilityV1(failing);
assert.equal(failReport.verdict, 'FAIL');
assert.ok(failReport.gateFailures.includes('GEP_HUD_BALANCE_MATCH_BELOW_THRESHOLD'));

console.log('souls affordability contract: PASS');
