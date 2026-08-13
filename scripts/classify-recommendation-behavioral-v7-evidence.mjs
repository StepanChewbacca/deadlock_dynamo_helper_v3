import { readFile, writeFile } from 'node:fs/promises';

const mode = required('BEHAVIORAL_V7_EVIDENCE_MODE');
const outputPath = required('BEHAVIORAL_V7_EVIDENCE_OUTPUT_PATH');
const sourcePath = required('BEHAVIORAL_V7_EVIDENCE_SOURCE_PATH');
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const checks = {};

if (mode === 'BOUNDED_PREREQUISITE') {
  checks.stageEPassed = source.stageEGatePassed === true;
  checks.futureTestExcluded = source.futureTestEvaluated === false && source.source?.futureTestRowCount === 0;
  checks.diagnosticOnly = source.trainingArtifactEligible === false;
} else if (mode === 'CROSSFIT_PREREQUISITE') {
  Object.assign(checks, boundedChecks(source));
} else if (mode === 'FULL_PREREQUISITE') {
  checks.strictCrossFitPassed = source.strictCrossFitPassed === true;
  checks.independentTuningPassed = source.independentTuningPassed === true;
  checks.futureTestExcluded = source.futureTestEvaluated === false;
  checks.trainingArtifactEligible = source.trainingArtifactEligible === true;
} else if (mode === 'VALUE_PREREQUISITE') {
  checks.fullBehavioralSucceeded = source.state === 'SUCCEEDED' || source.fullTrainingSucceeded === true;
  checks.candidateCoverageAtLeast099 = Number(source.candidateCoverage) >= 0.99;
  checks.supportAtLeast090 = Number(source.supportCoverage) >= 0.90;
  checks.noMajorLowSupportGroups = Number(source.majorLowSupportGroupCount) === 0;
  checks.floorSensitivityAtMost002 = Number(source.floorSensitivityDelta) <= 0.02;
  checks.structuralAuditPassed = source.structuralAuditPassed === true;
  checks.trainingArtifactEligible = source.trainingArtifactEligible === true;
  checks.finalVerificationPassed = source.futureTestVerificationPassed === true;
} else {
  throw new Error(`Unsupported evidence mode ${mode}.`);
}

const eligible = Object.values(checks).every(Boolean);
const report = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_EVIDENCE_CLASSIFICATION',
  mode,
  generatedAt: new Date().toISOString(),
  sourcePath,
  classifierPerformedTraining: false,
  classifierEvaluatedFutureTest: false,
  checks,
  eligible,
  reasons: eligible ? [] : Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => `FAILED:${name}`),
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

function boundedChecks(summary) {
  const support = Number(summary.supportCoverage ?? summary.tuning?.supportCoverage);
  const rawLogLoss = Number(summary.rawLogLoss ?? summary.tuning?.rawLogLoss);
  const floor = Number(summary.floorSensitivityDelta ?? summary.tuning?.floorSensitivityDelta);
  const lowGroups = Number(summary.majorLowSupportGroupCount ?? summary.tuning?.majorLowSupportGroupCount);
  const late = Number(summary.lateSupportCoverage ?? summary.tuning?.lateSupportCoverage);
  const economy = Number(summary.highEconomySupportCoverage ?? summary.tuning?.highEconomySupportCoverage);
  const coverage = Number(summary.candidateCoverage ?? summary.choiceSet?.candidateCoverage);
  return {
    boundedScreenPassed: summary.screenPassed === true,
    candidateCoverageAtLeast099: coverage >= 0.99,
    supportAtLeast086: support >= 0.86,
    supportGainAtLeast001: support >= 0.845920177383592,
    rawLogLossBeatsV6Sequence: rawLogLoss < 2.747655053608051,
    floorSensitivityBelow028: floor < 0.28,
    majorLowSupportGroupsAtMost2: lowGroups <= 2,
    lateSupportBeatsV6: late > 0.7670886075949367,
    highEconomySupportBeatsV6: economy > 0.7611583421891605,
    futureTestExcluded: summary.futureTestEvaluated === false || summary.source?.futureTestRowCount === 0,
  };
}
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
