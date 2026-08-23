const assert = require('node:assert/strict');
const {
  RECOMMENDATION_BEHAVIORAL_TRAINING_LAUNCH_V1,
  validateRecommendationBehavioralTrainingPairV1,
} = require('../dist');

function config(family) {
  return {
    contractVersion: RECOMMENDATION_BEHAVIORAL_TRAINING_LAUNCH_V1,
    family,
    seed: 17,
    deterministic: true,
    trainSplit: 'TRAIN',
    validationSplit: 'VALIDATION',
    selectionSplit: 'SHADOW_HOLDOUT',
    futureTestAllowed: false,
    device: 'cuda',
    maxEpochs: 30,
    batchSize: 64,
    evaluationBatchSize: 128,
    learningRate: 0.0003,
    minimumLearningRate: 0.000001,
    weightDecay: 0.0001,
    gradientClip: 1,
    maximumHistoryEvents: 64,
    hashDimension: 65536,
    embeddingDimension: 128,
    hiddenDimension: 256,
    layerCount: 3,
    attentionHeads: family === 'SEQUENCE_TRANSFORMER' ? 8 : undefined,
    dropout: 0.1,
    earlyStoppingPatience: 4,
    supportProbabilityThreshold: 0.001,
    majorCohortMinDecisions: 100,
    majorCohortMinFraction: 0.01,
    gateMinDecisions: 10000,
    gateMinCandidateCoverage: 0.99,
    gateMinSupport: 0.9,
    gateMinMajorCohortSupport: 0.75,
    gateMaxFloorSensitivity: 0.01,
  };
}

const rnn = config('SEQUENCE_RNN');
const transformer = config('SEQUENCE_TRANSFORMER');
assert.deepEqual(validateRecommendationBehavioralTrainingPairV1(rnn, transformer).errors, []);
assert.equal(validateRecommendationBehavioralTrainingPairV1(rnn, transformer).valid, true);

const mismatchedHistory = {
  ...transformer,
  maximumHistoryEvents: 32,
};
const historyValidation = validateRecommendationBehavioralTrainingPairV1(rnn, mismatchedHistory);
assert.equal(historyValidation.valid, false);
assert(historyValidation.errors.includes('EQUAL_OBSERVABLES_CONFIG_MISMATCH:maximumHistoryEvents'));

const swappedFamily = validateRecommendationBehavioralTrainingPairV1(transformer, rnn);
assert(swappedFamily.errors.includes('RNN_CONFIG_FAMILY_REQUIRED'));
assert(swappedFamily.errors.includes('TRANSFORMER_CONFIG_FAMILY_REQUIRED'));

console.log('recommendation training pair v1 fixtures: PASS');
