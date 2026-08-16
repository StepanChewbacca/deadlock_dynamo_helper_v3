import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { selectBehavioralV7ChoiceSet } from './recommendation-behavioral-v7-evaluation.mjs';
import {
  BEHAVIORAL_V7_MODEL_FAMILIES,
  createBehavioralV7ModelFamily,
} from './recommendation-behavioral-v7-model-families.mjs';

const datasetPath = required('BEHAVIORAL_V7_FULL_DATASET_PATH');
const crossfitSummaryPath = required('BEHAVIORAL_V7_CROSSFIT_SUMMARY_PATH');
const outputDirectory = required('BEHAVIORAL_V7_FULL_TRAIN_OUTPUT_DIR');
const epochs = 3;

const crossfit = JSON.parse(await readFile(crossfitSummaryPath, 'utf8'));
if (
  crossfit?.operation !== 'RECOMMENDATION_BEHAVIORAL_V7_STRICT_CROSSFIT' ||
  crossfit?.schemaVersion !== 2 ||
  crossfit?.strictCrossFitPassed !== true ||
  crossfit?.independentTuningPassed !== true ||
  crossfit?.trainingArtifactEligible !== true ||
  crossfit?.contracts?.futureTestEvaluated !== false ||
  crossfit?.contracts?.boundedChampionFamilyPreserved !== true ||
  !BEHAVIORAL_V7_MODEL_FAMILIES.includes(crossfit?.familyId)
) {
  throw new Error('Strict V7 cross-fit evidence does not permit full training.');
}

const familyId = crossfit.familyId;
const family = createBehavioralV7ModelFamily(familyId);
if (
  crossfit.contracts?.probabilityContract !== 'RAW_SOFTMAX_WITHIN_DECISION' ||
  crossfit.contracts?.consumesV7Observability !== true
) {
  throw new Error('Strict V7 cross-fit family contract is not production-eligible.');
}

await mkdir(outputDirectory, { recursive: true });
const model = family.createModel();
const trainingEpochs = [];
for (let epoch = 1; epoch <= epochs; epoch += 1) {
  trainingEpochs.push(await trainEpoch(model, epoch));
}
family.validate(model);

const artifact = {
  schemaVersion: 2,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_FULL_NON_FUTURE_MODEL',
  executorVersion: 'FULL_TRAIN_PLUS_TUNING_BOUND_FAMILY_NO_FUTURE_2',
  generatedAt: new Date().toISOString(),
  familyId,
  source: {
    datasetPath,
    crossfitSummaryPath,
    strictCrossFitFamily: crossfit.familyId,
  },
  contracts: {
    ...family.contracts,
    trainingRows: 'TRAIN_PLUS_TUNING_ONLY',
    futureTestUsedForTraining: false,
    futureTestUsedForModelSelection: false,
    strictCrossFitFamilyPreserved: true,
  },
  modelConfig: family.modelConfig,
  trainingConfig: {
    epochs,
    ...family.trainingOptions,
  },
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
    lossSum += family.train(targetModel, selected);
    decisionCount += 1;
  }
  if (futureRowsSkipped !== 0) {
    throw new Error(
      `Behavioral V7 full training input must exclude FUTURE_TEST rows, got ${futureRowsSkipped}.`,
    );
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
