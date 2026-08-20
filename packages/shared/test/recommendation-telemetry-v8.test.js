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

const knownEvidence = {
  spendableSouls: 'OBSERVED',
  shopOpportunity: 'OBSERVED',
  inventory: 'OBSERVED',
  ruleset: 'RECONSTRUCTED',
  transaction: 'RECONSTRUCTED',
};

const decision = {
  ...base,
  eventType: 'RECOMMENDATION_DECISION',
  payload: {
    decisionId: 'decision-1',
    stateRevision: 'state-1',
    candidateGeneratorVersion: 'feasible-v1',
    candidates: [
      {
        actionKey: 'BUY_ITEM:1',
        actionType: 'BUY_ITEM',
        targetItemId: 1,
        effectiveCostSouls: 800,
        spendableSoulsAfter: 200,
        resultingItemIds: [1],
        feasible: true,
        feasibilityReasons: ['FEASIBLE'],
        affordable: true,
        slotLegal: true,
        recipeLegal: true,
        shopLegal: true,
        rulesetLegal: true,
        transactionMechanicsKnown: true,
        evidence: knownEvidence,
        behaviorProbability: 0.75,
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
          ...knownEvidence,
          spendableSouls: 'UNKNOWN',
          shopOpportunity: 'UNKNOWN',
        },
        behaviorProbability: 0.25,
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
illegalSelected.payload.candidates[0].feasible = false;
assert(validateRecommendationDecisionEventV8(illegalSelected).errors.includes('SELECTED_ACTION_NOT_FEASIBLE'));
assert(validateRecommendationDecisionEventV8(illegalSelected).errors.includes('INFEASIBLE_ACTION_NONZERO_BEHAVIOR_PROBABILITY:BUY_ITEM:1'));

const nonNormalizedBehavior = structuredClone(decision);
nonNormalizedBehavior.payload.candidates[0].behaviorProbability = 0.7;
assert(validateRecommendationDecisionEventV8(nonNormalizedBehavior).errors.includes('BEHAVIOR_PROBABILITY_VECTOR_NOT_NORMALIZED'));

const partialBehavior = structuredClone(decision);
delete partialBehavior.payload.candidates[1].behaviorProbability;
assert(validateRecommendationDecisionEventV8(partialBehavior).errors.includes('PARTIAL_BEHAVIOR_PROBABILITY_VECTOR'));

const missingPlayer = structuredClone(decision);
delete missingPlayer.playerKey;
assert(validateRecommendationDecisionEventV8(missingPlayer).errors.includes('PLAYER_KEY_REQUIRED'));

const unknownTransaction = structuredClone(decision);
unknownTransaction.payload.candidates[0].transactionMechanicsKnown = false;
unknownTransaction.payload.candidates[0].evidence.transaction = 'UNKNOWN';
const unknownTransactionErrors = validateRecommendationDecisionEventV8(unknownTransaction).errors;
assert(unknownTransactionErrors.includes('FEASIBLE_ACTION_TRANSACTION_MECHANICS_UNKNOWN:BUY_ITEM:1'));
assert(unknownTransactionErrors.includes('FEASIBLE_ACTION_TRANSACTION_EVIDENCE_UNKNOWN:BUY_ITEM:1'));

const unverifiedPlayer = {
  ...base,
  eventType: 'PLAYER_STATE',
  payload: { soulsRaw: 3510, shopOpportunity: 'UNKNOWN' },
};
assert.deepEqual(validatePlayerStateEventV8(unverifiedPlayer), { valid: true, errors: [] });

const verifiedWithoutContract = structuredClone(unverifiedPlayer);
verifiedWithoutContract.payload.spendableSoulsVerified = { value: 3510, verificationContractVersion: '' };
assert(validatePlayerStateEventV8(verifiedWithoutContract).errors.includes('SPENDABLE_SOULS_VERIFICATION_CONTRACT_REQUIRED'));

console.log('recommendation telemetry v8 fixtures: PASS');
