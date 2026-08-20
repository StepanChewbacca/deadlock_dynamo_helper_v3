const assert = require('node:assert/strict');
const {
  RECOMMENDATION_TELEMETRY_CONTRACT_VERSION,
  validatePlayerStateEventV8,
  validateRecommendationDecisionEventV8,
  recommendationTelemetryDeduplicationKeyV8,
} = require('../dist');

const base = {
  schemaVersion: 2,
  contractVersion: RECOMMENDATION_TELEMETRY_CONTRACT_VERSION,
  eventId: 'evt-1',
  matchId: 'match-1',
  playerKey: 'hmac:player',
  source: 'OVERWOLF_GEP',
  sourceEventId: 'seq-1',
  sourceOccurredAtMs: 1000,
  receivedAtMs: 1010,
  gameTimeMs: 100000,
  sequenceNo: 1,
  versions: {
    client: 'client-1',
    gep: 'gep-1',
    normalizer: 'gep-canonical-v2',
    ruleset: 'ruleset-1',
    catalogSha256: 'a'.repeat(64),
  },
  quality: {
    directlyObserved: true,
    reconstructed: false,
    stale: false,
    alignmentAgeMs: 10,
  },
};

const decision = {
  ...base,
  eventType: 'RECOMMENDATION_DECISION',
  payload: {
    decisionId: 'decision-1',
    stateRevision: 'state-1',
    candidateGeneratorVersion: 'feasible-v1',
    feasibleActions: [
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
      },
    ],
    selectedActionKey: 'BUY_ITEM:1',
    modelVersion: 'baseline-v1',
    policyProbability: 1,
    experiment: {
      arm: 'CONTROL',
      assignmentUnit: 'MATCH',
      loggingPropensity: 1,
      randomized: false,
      assignmentVersion: 'assignment-v1',
    },
    observedActionInjected: false,
  },
};

assert.deepEqual(validateRecommendationDecisionEventV8(decision), { valid: true, errors: [] });
assert.equal(recommendationTelemetryDeduplicationKeyV8(decision), 'match-1:OVERWOLF_GEP:seq-1');

const injected = structuredClone(decision);
injected.payload.observedActionInjected = true;
assert.equal(validateRecommendationDecisionEventV8(injected).valid, false);
assert(validateRecommendationDecisionEventV8(injected).errors.includes('OBSERVED_ACTION_INJECTION_FORBIDDEN'));

const illegalSelected = structuredClone(decision);
illegalSelected.payload.feasibleActions[0].feasible = false;
assert(validateRecommendationDecisionEventV8(illegalSelected).errors.includes('SELECTED_ACTION_NOT_FEASIBLE'));

const unverifiedPlayer = {
  ...base,
  eventType: 'PLAYER_STATE',
  payload: { soulsRaw: 3510 },
};
assert.deepEqual(validatePlayerStateEventV8(unverifiedPlayer), { valid: true, errors: [] });

const verifiedWithoutContract = structuredClone(unverifiedPlayer);
verifiedWithoutContract.payload.spendableSoulsVerified = { value: 3510, verificationContractVersion: '' };
assert(validatePlayerStateEventV8(verifiedWithoutContract).errors.includes('SPENDABLE_SOULS_VERIFICATION_CONTRACT_REQUIRED'));

console.log('recommendation telemetry v8 fixtures: PASS');
