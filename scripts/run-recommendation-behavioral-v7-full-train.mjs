import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { createRequire } from 'node:module';
import { selectBehavioralV7ChoiceSet } from './recommendation-behavioral-v7-evaluation.mjs';

const require = createRequire(import.meta.url);
const {
  createRecommendationBehavioralV7Model,
  trainRecommendationBehavioralV7Decision,
  validateRecommendationBehavioralV7Model,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-behavioral-v7.js');

const datasetPath = required('BEHAVIORAL_V7_FULL_DATASET_PATH');
const crossfitSummaryPath = required('BEHAVIORAL_V7_CROSSFIT_SUMMARY_PATH');
const outputDirectory = required('BEHAVIORAL_V7_FULL_TRAIN_OUTPUT_DIR');
const epochs = 3;
const modelConfig = { hashDimension: 65_536 };
const options = { learningRate: 0.05, l2: 0.0001, gradientClip: 1 };

const crossfit = JSON.parse(await readFile(crossfitSummaryPath, 'utf8'));
if (
  crossfit?.operation !== 'RECOMMENDATION_BEHAVIORAL_V7_STRICT_CROSSFIT' ||
  crossfit?.strictCrossFitPassed !== true ||
  crossfit?.independentTuningPassed !== true ||
  crossfit?.trainingArtifactEligible !== true ||
  crossfit?.contracts?.futureTestEvaluated !== false
) {
  throw new Error('Strict V7 cross-fit evidence does not permit full training.');
}
await mkdir(outputDirectory, { recursive: true });
const model = createRecommendationBehavioralV7Model(modelConfig);
const trainingEpochs = [];
for (let epoch = 1; epoch <= epochs; epoch += 1) {
  trainingEpochs.push(await trainEpoch(model, epoch));
}
validateRecommendationBehavioralV7Model(model);

const artifact = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_FULL_NON_FUTURE_MODEL',
  executorVersion: 'FULL_TRAIN_PLUS_TUNING_NO_FUTURE_1',
  generatedAt: new Date().toISOString(),
  source: { datasetPath, crossfitSummaryPath },
  contracts: {
    trainingRows: 'TRAIN_PLUS_TUNING_ONLY',
    futureTestUsedForTraining: false,
    futureTestUsedForModelSelection: false,
    probabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION',
  },
  modelConfig,
  trainingConfig: { epochs, ...options },
  trainingEpochs,
  structuralAuditPassed: true,
  finalVerificationPending: true,
  trainingArtifactEligible: false,
  model,
};
await writeFile(
  `${outputDirectory}/model.json`,
  `${JSON.stringify(artifact, null, 2)}\n`,
  'utf8',
);
await writeFile(
  `${outputDirectory}/train-summary.json`,
  `${JSON.stringify({ ...artifact, model: undefined }, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify({ ...artifact, model: undefined }, null, 2));

async function trainEpoch(targetModel, epoch) {
  let decisionCount = 0;
  let lossSum = 0;
  let futureRowsSkipped = 0;
  const input = createInterface({ input: openDataset(datasetPath), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.split === 'FUTURE_TEST') {
      futureRowsSkipped += 1;
      continue;
    }
    if (
      !['TRAIN', 'TUNING'].includes(row.split) ||
      row.eligibility?.behavioralModel !== true
    ) {
      continue;
    }
    const selected = selectBehavioralV7ChoiceSet(row);
    if (!selected) continue;
    const result = trainRecommendationBehavioralV7Decision(
      targetModel,
      selected,
      options,
    );
    decisionCount += 1;
    lossSum += result.loss;
  }
  return {
    epoch,
    decisionCount,
    futureRowsSkipped,
    meanOnlineLoss: divide(lossSum, decisionCount),
  };
}

function openDataset(path) {
  const stream = createReadStream(path);
  return path.endsWith('.gz') ? stream.pipe(createGunzip()) : stream;
}
function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
