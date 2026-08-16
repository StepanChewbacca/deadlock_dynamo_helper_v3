import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import {
  behavioralV7ReleaseChecks,
  createBehavioralV7Metric,
  finalizeBehavioralV7Metric,
  observeBehavioralV7Metric,
  selectBehavioralV7ChoiceSet,
} from './recommendation-behavioral-v7-evaluation.mjs';
import {
  BEHAVIORAL_V7_MODEL_FAMILIES,
  createBehavioralV7ModelFamily,
} from './recommendation-behavioral-v7-model-families.mjs';

const datasetPath = required('BEHAVIORAL_V7_VERIFICATION_DATASET_PATH');
const expectedDatasetSha256 = requiredSha256(
  'BEHAVIORAL_V7_EXPECTED_DATASET_SHA256',
);
const modelArtifactPath = required('BEHAVIORAL_V7_FULL_MODEL_PATH');
const trainSummaryPath = required('BEHAVIORAL_V7_FULL_TRAIN_SUMMARY_PATH');
const outputDirectory = required('BEHAVIORAL_V7_VERIFICATION_OUTPUT_DIR');

const EXTREME_PROBABILITY_EPSILON = 1e-6;
const MAXIMUM_EXTREME_CANDIDATE_PROBABILITY_RATE = 0.01;
const NORMALIZATION_TOLERANCE = 1e-9;

await mkdir(outputDirectory, { recursive: true });

const [datasetSha256, modelArtifactSha256, modelArtifact, trainSummary] =
  await Promise.all([
    hashFile(datasetPath),
    hashFile(modelArtifactPath),
    readJson(modelArtifactPath),
    readJson(trainSummaryPath),
  ]);

if (datasetSha256 !== expectedDatasetSha256) {
  throw new Error(
    `Dataset V7 SHA-256 mismatch: expected ${expectedDatasetSha256}, received ${datasetSha256}.`,
  );
}

validateFullTrainingArtifacts(modelArtifact, trainSummary);
const familyId = modelArtifact.familyId;
const family = createBehavioralV7ModelFamily(familyId);
family.validate(modelArtifact.model);

const metric = createBehavioralV7Metric();
let futureTestRowCount = 0;
let eligibleFutureTestRowCount = 0;
let coveredFutureTestRowCount = 0;
let predictionDecisionCount = 0;
let candidateProbabilityCount = 0;
let extremeCandidateProbabilityCount = 0;
let invalidProbabilityCount = 0;
let normalizationViolationCount = 0;
let observedProbabilityMismatchCount = 0;
let nonFutureRowCount = 0;

const input = createInterface({ input: openDataset(datasetPath), crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  assertDatasetV7Row(row);
  if (row.split !== 'FUTURE_TEST') {
    nonFutureRowCount += 1;
    continue;
  }
  futureTestRowCount += 1;
  if (row.eligibility?.behavioralModel !== true) continue;
  eligibleFutureTestRowCount += 1;
  const selected = selectBehavioralV7ChoiceSet(row);
  if (!selected) continue;
  coveredFutureTestRowCount += 1;

  const prediction = family.predict(modelArtifact.model, selected);
  predictionDecisionCount += 1;
  const probabilityByAction = new Map();
  let probabilitySum = 0;
  for (const candidate of prediction.candidates) {
    const probability = Number(candidate.probability);
    candidateProbabilityCount += 1;
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      invalidProbabilityCount += 1;
      continue;
    }
    probabilitySum += probability;
    probabilityByAction.set(candidate.actionKey, probability);
    if (
      probability <= EXTREME_PROBABILITY_EPSILON ||
      probability >= 1 - EXTREME_PROBABILITY_EPSILON
    ) {
      extremeCandidateProbabilityCount += 1;
    }
  }
  if (Math.abs(probabilitySum - 1) > NORMALIZATION_TOLERANCE) {
    normalizationViolationCount += 1;
  }
  const observedCandidateProbability = probabilityByAction.get(
    selected.observedActionKey,
  );
  if (
    observedCandidateProbability === undefined ||
    Math.abs(
      observedCandidateProbability - Number(prediction.observedActionProbability),
    ) > NORMALIZATION_TOLERANCE
  ) {
    observedProbabilityMismatchCount += 1;
  }
  observeBehavioralV7Metric(metric, selected, prediction);
}

if (futureTestRowCount === 0) {
  throw new Error('Behavioral V7 final verifier received no FUTURE_TEST rows.');
}
if (eligibleFutureTestRowCount === 0) {
  throw new Error(
    'Behavioral V7 final verifier received no eligible FUTURE_TEST decisions.',
  );
}
if (predictionDecisionCount === 0) {
  throw new Error(
    'Behavioral V7 final verifier produced no FUTURE_TEST predictions.',
  );
}

const futureTest = finalizeBehavioralV7Metric(metric);
const candidateCoverage = divide(
  coveredFutureTestRowCount,
  eligibleFutureTestRowCount,
);
const extremeCandidateProbabilityRate = divide(
  extremeCandidateProbabilityCount,
  candidateProbabilityCount,
);
const releaseChecks = behavioralV7ReleaseChecks(futureTest, candidateCoverage);
const rawPropensityAudit = {
  contract: 'RAW_SOFTMAX_WITHIN_DECISION',
  epsilon: EXTREME_PROBABILITY_EPSILON,
  normalizationTolerance: NORMALIZATION_TOLERANCE,
  candidateProbabilityCount,
  extremeCandidateProbabilityCount,
  extremeCandidateProbabilityRate,
  maximumExtremeCandidateProbabilityRate:
    MAXIMUM_EXTREME_CANDIDATE_PROBABILITY_RATE,
  invalidProbabilityCount,
  normalizationViolationCount,
  observedProbabilityMismatchCount,
  rawPropensityContractPassed:
    family.contracts.probabilityContract === 'RAW_SOFTMAX_WITHIN_DECISION' &&
    invalidProbabilityCount === 0 &&
    normalizationViolationCount === 0 &&
    observedProbabilityMismatchCount === 0,
  extremeCandidateProbabilityGatePassed:
    extremeCandidateProbabilityRate <=
    MAXIMUM_EXTREME_CANDIDATE_PROBABILITY_RATE,
};
const structuralAudit = {
  modelFamilyKnown: BEHAVIORAL_V7_MODEL_FAMILIES.includes(familyId),
  fullTrainFamilyMatchesModel: trainSummary.familyId === familyId,
  fixedFamilyContractPreserved:
    trainSummary.contracts?.strictCrossFitFamilyPreserved === true,
  v7ObservabilityConsumed: family.contracts.consumesV7Observability === true,
  rawProbabilityContractDeclared:
    family.contracts.probabilityContract === 'RAW_SOFTMAX_WITHIN_DECISION',
  modelValidationPassed: true,
  datasetShaPinned: datasetSha256 === expectedDatasetSha256,
  futureTestPresent: futureTestRowCount > 0,
  futureTestPredictionCountMatchesCoverage:
    predictionDecisionCount === coveredFutureTestRowCount,
  futureTestUsedForTraining: false,
  futureTestUsedForSelection: false,
  modelTrainingPerformedByVerifier: false,
  evaluationPassCount: 1,
};
const structuralAuditPassed = Object.entries(structuralAudit).every(
  ([key, value]) =>
    key === 'futureTestUsedForTraining' ||
    key === 'futureTestUsedForSelection' ||
    key === 'modelTrainingPerformedByVerifier'
      ? value === false
      : key === 'evaluationPassCount'
        ? value === 1
        : value === true,
);
const releaseGateChecks = {
  ...releaseChecks,
  extremeCandidateProbabilityRateAtMost001:
    rawPropensityAudit.extremeCandidateProbabilityGatePassed,
  structuralAuditPassed,
  rawPropensityContractPassed: rawPropensityAudit.rawPropensityContractPassed,
  exactDatasetV7ShaLineageRecorded: datasetSha256 === expectedDatasetSha256,
};
const releaseGatePassed = Object.values(releaseGateChecks).every(Boolean);
const reasons = Object.entries(releaseGateChecks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);

const verification = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_FINAL_FUTURE_TEST_VERIFICATION',
  executorVersion: 'SINGLE_FUTURE_TEST_PASS_RAW_PROPENSITY_1',
  generatedAt: new Date().toISOString(),
  familyId,
  source: {
    datasetPath,
    datasetSha256,
    expectedDatasetSha256,
    modelArtifactPath,
    modelArtifactSha256,
    trainSummaryPath,
    nonFutureRowCount,
    futureTestRowCount,
    eligibleFutureTestRowCount,
    coveredFutureTestRowCount,
  },
  contracts: {
    evaluationSplit: 'FUTURE_TEST_ONLY',
    evaluationPassCount: 1,
    tuningUsedForVerification: false,
    futureTestUsedForTraining: false,
    futureTestUsedForSelection: false,
    modelTrainingPerformedByVerifier: false,
    probabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION',
    extremeProbabilityDefinition:
      'RAW_CANDIDATE_PROBABILITY_LE_1E-6_OR_GE_1_MINUS_1E-6',
  },
  candidateCoverage,
  futureTest,
  rawPropensityAudit,
  structuralAudit,
  structuralAuditPassed,
  releaseGate: {
    candidateCoverage,
    minimumCandidateCoverage: 0.99,
    behaviorSupportCoverage: futureTest.supportCoverage,
    minimumBehaviorSupportCoverage: 0.9,
    minimumMajorGroupSupportCoverage: 0.75,
    probabilityFloorMaximumLogLossDelta: futureTest.floorSensitivityDelta,
    maximumProbabilityFloorLogLossDelta: 0.02,
    extremeCandidateProbabilityRate,
    maximumExtremeCandidateProbabilityRate:
      MAXIMUM_EXTREME_CANDIDATE_PROBABILITY_RATE,
    checks: releaseGateChecks,
    reasons,
    passed: releaseGatePassed,
  },
  releaseGatePassed,
  trainingArtifactEligible: releaseGatePassed,
  valueV8StageEligible: releaseGatePassed,
  valueV8TrainingAuthorized: false,
  productionRankingChanged: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
  nextEligibleOperation: releaseGatePassed
    ? 'VALUE_V8_READINESS'
    : 'STOP_OBSERVABILITY_OR_LABEL_REVIEW',
};

await writeJson(`${outputDirectory}/verification.json`, verification);
await writeJson(`${outputDirectory}/release-manifest.json`, {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_RELEASE_MANIFEST',
  generatedAt: verification.generatedAt,
  familyId,
  datasetV7Sha256: datasetSha256,
  modelArtifactSha256,
  releaseGatePassed,
  structuralAuditPassed,
  rawPropensityContractPassed: rawPropensityAudit.rawPropensityContractPassed,
  extremeCandidateProbabilityRate,
  trainingArtifactEligible: releaseGatePassed,
  valueV8StageEligible: releaseGatePassed,
  valueV8TrainingAuthorized: false,
  productionRankingChanged: false,
});
console.log(JSON.stringify(verification, null, 2));

function validateFullTrainingArtifacts(modelArtifact, trainSummary) {
  if (
    modelArtifact?.schemaVersion !== 2 ||
    modelArtifact?.operation !==
      'RECOMMENDATION_BEHAVIORAL_V7_FULL_NON_FUTURE_MODEL' ||
    modelArtifact?.trainingArtifactEligible !== false ||
    modelArtifact?.finalVerificationPending !== true ||
    modelArtifact?.contracts?.futureTestUsedForTraining !== false ||
    modelArtifact?.contracts?.futureTestUsedForModelSelection !== false ||
    !BEHAVIORAL_V7_MODEL_FAMILIES.includes(modelArtifact?.familyId)
  ) {
    throw new Error('Behavioral V7 full model artifact is not verification-ready.');
  }
  if (
    trainSummary?.schemaVersion !== 2 ||
    trainSummary?.operation !==
      'RECOMMENDATION_BEHAVIORAL_V7_FULL_NON_FUTURE_MODEL' ||
    trainSummary?.familyId !== modelArtifact.familyId ||
    trainSummary?.finalVerificationPending !== true ||
    trainSummary?.contracts?.futureTestUsedForTraining !== false ||
    trainSummary?.contracts?.futureTestUsedForModelSelection !== false ||
    trainSummary?.contracts?.strictCrossFitFamilyPreserved !== true
  ) {
    throw new Error('Behavioral V7 full training summary is not verification-ready.');
  }
}

function assertDatasetV7Row(row) {
  if (
    row?.schemaVersion !== 1 ||
    row?.datasetVersion !== 'RECOMMENDATION_PRO_DECISION_DATASET_V7_OBSERVABILITY_1' ||
    row?.observabilityVersion !==
      'RECOMMENDATION_OBSERVABILITY_V7_STRICT_PREDECISION_1' ||
    !['TRAIN', 'TUNING', 'FUTURE_TEST'].includes(row?.split) ||
    row?.choiceSet?.observedActionInjected !== false ||
    row?.choiceSet?.selectedAfterObservedAction !== false ||
    !Array.isArray(row?.candidates)
  ) {
    throw new Error('Invalid Dataset V7 row in final verifier.');
  }
}

function openDataset(path) {
  const stream = createReadStream(path);
  return path.endsWith('.gz') ? stream.pipe(createGunzip()) : stream;
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function requiredSha256(name) {
  const value = required(name).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a SHA-256 value.`);
  }
  return value;
}
