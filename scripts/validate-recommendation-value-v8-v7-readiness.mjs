import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const lineageManifestPath = required('BEHAVIORAL_V7_DATASET_LINEAGE_MANIFEST_PATH');
const releaseManifestPath = required('BEHAVIORAL_V7_RELEASE_MANIFEST_PATH');
const propensityManifestPath = required('BEHAVIORAL_V7_PROPENSITY_MANIFEST_PATH');
const propensityPath = required('BEHAVIORAL_V7_PROPENSITY_PATH');
const outputPath = required('RECOMMENDATION_VALUE_V8_V7_READINESS_OUTPUT_PATH');

const [lineage, release, propensityManifest] = await Promise.all([
  readJson(lineageManifestPath),
  readJson(releaseManifestPath),
  readJson(propensityManifestPath),
]);

validateLineage(lineage);
validateRelease(release);
validatePropensityManifest(propensityManifest);

const [fullDatasetPhysicalSha256, nonFutureDatasetPhysicalSha256, propensitySha256] =
  await Promise.all([
    hashFile(lineage.fullSource.path),
    hashFile(lineage.nonFutureView.path),
    hashFile(propensityPath),
  ]);

const lineageChecks = {
  fullDatasetPhysicalShaMatchesLineage:
    fullDatasetPhysicalSha256 === lineage.fullSource.physicalSha256,
  nonFutureDatasetPhysicalShaMatchesLineage:
    nonFutureDatasetPhysicalSha256 === lineage.nonFutureView.physicalSha256,
  finalReleaseUsesSameImmutableDatasetV7:
    release.datasetV7Sha256 === lineage.fullSource.physicalSha256,
  propensityProducerUsesLineageNonFutureView:
    propensityManifest.source?.datasetPath === lineage.nonFutureView.path,
  propensityArtifactShaMatchesManifest:
    propensitySha256 === propensityManifest.artifact?.sha256,
  behavioralFamilyMatchesRelease:
    propensityManifest.familyId === release.familyId,
};

if (!Object.values(lineageChecks).every(Boolean)) {
  throw new Error(
    `Behavioral V7 Value V8 lineage gate failed: ${JSON.stringify(lineageChecks)}.`,
  );
}

const propensityAudit = await auditPropensities(
  propensityPath,
  propensityManifest.familyId,
);
const propensityChecks = {
  rowCountMatchesManifest:
    propensityAudit.rowCount === propensityManifest.artifact.rowCount,
  candidateProbabilityCountMatchesManifest:
    propensityAudit.candidateProbabilityCount ===
    propensityManifest.artifact.candidateProbabilityCount,
  allRowsTrainOnly: propensityAudit.nonTrainRowCount === 0,
  allRowsOutOfFold: propensityAudit.nonOofRowCount === 0,
  noDuplicateDecisionIds: propensityAudit.duplicateDecisionIdCount === 0,
  noInvalidProbabilities: propensityAudit.invalidProbabilityCount === 0,
  noNormalizationViolations: propensityAudit.normalizationViolationCount === 0,
  noObservedProbabilityMismatches:
    propensityAudit.observedProbabilityMismatchCount === 0,
  noFamilyMismatch: propensityAudit.familyMismatchCount === 0,
  noProbabilityContractMismatch:
    propensityAudit.probabilityContractMismatchCount === 0,
};

const releaseChecks = {
  releaseGatePassed: release.releaseGatePassed === true,
  structuralAuditPassed: release.structuralAuditPassed === true,
  rawPropensityContractPassed: release.rawPropensityContractPassed === true,
  trainingArtifactEligible: release.trainingArtifactEligible === true,
  valueV8StageEligible: release.valueV8StageEligible === true,
  productionRankingUnchanged: release.productionRankingChanged === false,
};

const crossfitChecks = {
  propensityManifestTrainingEligible:
    propensityManifest.trainingArtifactEligible === true,
  propensityManifestValueV8InputEligible:
    propensityManifest.valueV8InputEligible === true,
  rawPropensityContractPassed:
    propensityManifest.audit?.rawPropensityContractPassed === true,
  trainOnly: propensityManifest.contracts?.split === 'TRAIN',
  outOfFold: propensityManifest.contracts?.outOfFold === true,
  inFoldPredictionUnused:
    propensityManifest.contracts?.inFoldPredictionUsed === false,
  tuningUnused: propensityManifest.contracts?.tuningUsedForPropensity === false,
  futureTestUnused:
    propensityManifest.contracts?.futureTestUsedForPropensity === false,
  rawSoftmax:
    propensityManifest.contracts?.probabilityContract ===
    'RAW_SOFTMAX_WITHIN_DECISION',
};

const valueV8InputEligible =
  Object.values(lineageChecks).every(Boolean) &&
  Object.values(propensityChecks).every(Boolean) &&
  Object.values(releaseChecks).every(Boolean) &&
  Object.values(crossfitChecks).every(Boolean);

const readiness = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_VALUE_V8_BEHAVIORAL_V7_READINESS',
  generatedAt: new Date().toISOString(),
  source: {
    lineageManifestPath,
    releaseManifestPath,
    propensityManifestPath,
    propensityPath,
    fullDatasetPhysicalSha256,
    nonFutureDatasetPhysicalSha256,
    propensitySha256,
  },
  contracts: {
    behaviorPolicy: 'BEHAVIORAL_V7_VERIFIED_RAW_OOF_PROPENSITY',
    behaviorProbabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION',
    propensitySplit: 'TRAIN',
    propensityOutOfFold: true,
    tuningUsedForBehaviorPropensity: false,
    futureTestUsedForBehaviorPropensity: false,
    finalBehaviorReleaseGateRequired: true,
    exactImmutableDatasetV7LineageRequired: true,
    valueTrainingPerformedByReadinessCheck: false,
    productionRankingChanged: false,
    randomizedCanaryAuthorized: false,
  },
  familyId: release.familyId,
  datasetV7Sha256: release.datasetV7Sha256,
  propensitySha256,
  lineageChecks,
  propensityChecks,
  releaseChecks,
  crossfitChecks,
  propensityAudit,
  valueV8InputEligible,
  valueV8TrainingAuthorized: false,
  valueTrainingPerformed: false,
  passiveShadowAuthorized: false,
  productionRankingChanged: false,
  randomizedCanaryAuthorized: false,
  nextEligibleOperation: valueV8InputEligible
    ? 'VALUE_V8_DIAGNOSTIC_AFTER_EXPLICIT_TRAINING_RESUME'
    : 'STOP_VALUE_V8',
};

await writeFile(outputPath, `${JSON.stringify(readiness, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(readiness, null, 2));

function validateLineage(value) {
  if (
    value?.schemaVersion !== 1 ||
    value?.operation !==
      'RECOMMENDATION_PRO_DECISION_DATASET_V7_IMMUTABLE_LINEAGE' ||
    value?.lineagePassed !== true ||
    value?.contracts?.immutableFullSource !== true ||
    value?.contracts?.nonFutureLogicalShaMatchesFullSourceProjection !== true ||
    value?.contracts?.futureTestExcludedFromNonFutureView !== true ||
    value?.contracts?.futureTestUsedForTraining !== false ||
    value?.contracts?.futureTestUsedForSelection !== false ||
    value?.contracts?.trainingPerformed !== false
  ) {
    throw new Error('Dataset V7 immutable lineage manifest is not eligible.');
  }
}

function validateRelease(value) {
  if (
    value?.schemaVersion !== 1 ||
    value?.operation !== 'RECOMMENDATION_BEHAVIORAL_V7_RELEASE_MANIFEST' ||
    value?.releaseGatePassed !== true ||
    value?.structuralAuditPassed !== true ||
    value?.rawPropensityContractPassed !== true ||
    value?.trainingArtifactEligible !== true ||
    value?.valueV8StageEligible !== true ||
    value?.productionRankingChanged !== false ||
    !isSha256(value?.datasetV7Sha256) ||
    !isSha256(value?.modelArtifactSha256)
  ) {
    throw new Error('Behavioral V7 release manifest does not authorize Value V8 readiness.');
  }
}

function validatePropensityManifest(value) {
  if (
    value?.schemaVersion !== 1 ||
    value?.operation !== 'RECOMMENDATION_BEHAVIORAL_V7_OOF_PROPENSITY_ARTIFACT' ||
    value?.contracts?.probabilityContract !== 'RAW_SOFTMAX_WITHIN_DECISION' ||
    value?.contracts?.split !== 'TRAIN' ||
    value?.contracts?.outOfFold !== true ||
    value?.contracts?.inFoldPredictionUsed !== false ||
    value?.contracts?.tuningUsedForPropensity !== false ||
    value?.contracts?.futureTestUsedForPropensity !== false ||
    value?.audit?.rawPropensityContractPassed !== true ||
    value?.trainingArtifactEligible !== true ||
    value?.valueV8InputEligible !== true ||
    value?.valueV8TrainingAuthorized !== false ||
    value?.productionRankingChanged !== false ||
    !isSha256(value?.artifact?.sha256)
  ) {
    throw new Error('Behavioral V7 OOF propensity manifest is not Value V8 eligible.');
  }
}

async function auditPropensities(path, expectedFamilyId) {
  let rowCount = 0;
  let candidateProbabilityCount = 0;
  let nonTrainRowCount = 0;
  let nonOofRowCount = 0;
  let duplicateDecisionIdCount = 0;
  let invalidProbabilityCount = 0;
  let normalizationViolationCount = 0;
  let observedProbabilityMismatchCount = 0;
  let familyMismatchCount = 0;
  let probabilityContractMismatchCount = 0;
  const decisionIds = new Set();
  const input = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    rowCount += 1;
    if (row?.schemaVersion !== 1 || !row?.decisionId) {
      throw new Error('Invalid Behavioral V7 OOF propensity row schema.');
    }
    if (decisionIds.has(row.decisionId)) duplicateDecisionIdCount += 1;
    decisionIds.add(row.decisionId);
    if (row.split !== 'TRAIN') nonTrainRowCount += 1;
    if (row.outOfFold !== true) nonOofRowCount += 1;
    if (row.modelFamily !== expectedFamilyId) familyMismatchCount += 1;
    if (row.probabilityContract !== 'RAW_SOFTMAX_WITHIN_DECISION') {
      probabilityContractMismatchCount += 1;
    }
    let sum = 0;
    let observed;
    if (!Array.isArray(row.candidates) || row.candidates.length < 2) {
      throw new Error(`Invalid propensity candidates for ${row.decisionId}.`);
    }
    for (const candidate of row.candidates) {
      const probability = Number(candidate.rawProbability);
      candidateProbabilityCount += 1;
      if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
        invalidProbabilityCount += 1;
        continue;
      }
      sum += probability;
      if (candidate.actionKey === row.observedActionKey) observed = probability;
    }
    if (Math.abs(sum - 1) > 1e-9) normalizationViolationCount += 1;
    if (
      observed === undefined ||
      Math.abs(observed - Number(row.observedActionRawProbability)) > 1e-9
    ) {
      observedProbabilityMismatchCount += 1;
    }
  }
  return {
    rowCount,
    candidateProbabilityCount,
    nonTrainRowCount,
    nonOofRowCount,
    duplicateDecisionIdCount,
    invalidProbabilityCount,
    normalizationViolationCount,
    observedProbabilityMismatchCount,
    familyMismatchCount,
    probabilityContractMismatchCount,
  };
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
