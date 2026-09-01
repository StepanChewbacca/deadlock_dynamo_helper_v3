import fs from 'node:fs';
import path from 'node:path';

const configDir = path.resolve('training/recommendation_v8/config');
const configs = new Map();
for (const name of ['rnn.json', 'transformer.json']) {
  const value = JSON.parse(fs.readFileSync(path.join(configDir, name), 'utf8'));
  configs.set(value.family, { name, value });
}
const rnn = configs.get('SEQUENCE_RNN');
const transformer = configs.get('SEQUENCE_TRANSFORMER');
const errors = [];
if (!rnn) errors.push('SEQUENCE_RNN config is missing');
if (!transformer) errors.push('SEQUENCE_TRANSFORMER config is missing');

const equalComparisonFields = [
  'seed',
  'deterministic',
  'trainSplit',
  'validationSplit',
  'selectionSplit',
  'futureTestAllowed',
  'device',
  'maxEpochs',
  'batchSize',
  'evaluationBatchSize',
  'learningRate',
  'minimumLearningRate',
  'weightDecay',
  'gradientClip',
  'maximumHistoryEvents',
  'hashDimension',
  'embeddingDimension',
  'hiddenDimension',
  'layerCount',
  'dropout',
  'earlyStoppingPatience',
  'earlyStoppingMinDelta',
  'lrPlateauPatience',
  'lrPlateauFactor',
  'shuffleBufferDecisions',
  'supportProbabilityThreshold',
  'majorCohortMinDecisions',
  'majorCohortMinFraction',
  'gateMinDecisions',
  'gateMinCandidateCoverage',
  'gateMinSupport',
  'gateMinMajorCohortSupport',
  'gateMaxFloorSensitivity',
];

if (rnn && transformer) {
  for (const field of equalComparisonFields) {
    if (JSON.stringify(rnn.value[field]) !== JSON.stringify(transformer.value[field])) {
      errors.push(`Behavioral comparison config mismatch: ${field}`);
    }
  }
  if (rnn.value.futureTestAllowed !== false || transformer.value.futureTestAllowed !== false) {
    errors.push('FUTURE_TEST must be disabled for both Behavioral comparison arms');
  }
  if (rnn.value.deterministic !== true || transformer.value.deterministic !== true) {
    errors.push('Both Behavioral comparison arms must be deterministic');
  }
}

const tsContract = fs.readFileSync('packages/shared/src/recommendation-training-pair-v1.ts', 'utf8');
const pyContract = fs.readFileSync('training/recommendation_v8/pretraining_environment_check.py', 'utf8');
for (const field of equalComparisonFields) {
  if (!tsContract.includes(`'${field}'`)) errors.push(`TypeScript training pair contract is missing ${field}`);
  if (!pyContract.includes(`"${field}"`)) errors.push(`Python pretraining pair contract is missing ${field}`);
}

if (errors.length > 0) {
  console.error('recommendation Behavioral training pair audit: FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('recommendation Behavioral training pair audit: PASS');
