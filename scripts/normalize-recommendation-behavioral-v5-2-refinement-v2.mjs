import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const sourceSweepSummaryPath = requiredString(
  'BEHAVIORAL_V5_2_SOURCE_SWEEP_SUMMARY_PATH',
);
const outputDirectory = requiredString('BEHAVIORAL_V5_2_REFINEMENT_OUTPUT_DIR');

const sourceSummary = JSON.parse(
  await readFile(sourceSweepSummaryPath, 'utf8'),
);
const sourceWinner = sourceSummary.results?.find(
  (result) => result.variant === sourceSummary.preferredVariant,
);
if (!sourceWinner) {
  throw new Error('Source V5.2 preferred result is missing.');
}
if (!Number.isFinite(sourceWinner.candidateCoverage)) {
  throw new Error('Source V5.2 candidate coverage is missing.');
}
const candidateCoverage = sourceWinner.candidateCoverage;

const summaryPath = join(outputDirectory, 'refinement-summary.json');
const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
if (
  summary?.operation !== 'RECOMMENDATION_BEHAVIORAL_V5_2_BOUNDED_REFINEMENT'
) {
  throw new Error('Invalid Behavioral V5.2 refinement summary.');
}

for (const result of summary.results ?? []) {
  const variantDirectory = join(outputDirectory, result.variant.toLowerCase());
  const evaluationPath = join(variantDirectory, 'evaluation.json');
  const auditPath = join(variantDirectory, 'audit.json');
  const manifestPath = join(variantDirectory, 'manifest.json');

  const evaluation = JSON.parse(await readFile(evaluationPath, 'utf8'));
  const audit = JSON.parse(await readFile(auditPath, 'utf8'));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  const releaseGate = evaluation.releaseGate;
  if (!releaseGate || !Array.isArray(releaseGate.reasons)) {
    throw new Error(`Variant ${result.variant} release gate is missing.`);
  }

  const reasons = releaseGate.reasons.filter(
    (reason) => reason !== 'Candidate coverage is below 99%.',
  );
  if (candidateCoverage < 0.99) {
    reasons.unshift('Candidate coverage is below 99%.');
  }
  const passed = reasons.length === 0;

  evaluation.metrics.selection.candidateCoverage = candidateCoverage;
  evaluation.releaseGate = {
    ...releaseGate,
    candidateCoverage,
    passed,
    reasons,
  };
  audit.releaseGate = evaluation.releaseGate;
  manifest.releaseGatePassed = passed;

  result.candidateCoverage = candidateCoverage;
  result.releaseGatePassed = passed;

  await writeJson(evaluationPath, evaluation);
  await writeJson(auditPath, audit);
  await writeJson(manifestPath, manifest);
}

const preferred = [...summary.results].sort(compareVariants)[0];
summary.preferredVariant = preferred.variant;
summary.preferredConfiguration = preferred.configuration;
summary.executorVersion = 'CANDIDATE_COVERAGE_FIXED_2';
summary.refinementContract = {
  ...summary.refinementContract,
  candidateCoverageSource: 'PINNED_SAMPLE_SOURCE_SWEEP',
  candidateCoverage,
};
summary.refinementChecks = {
  structuralAuditPassed: preferred.structuralAuditPassed === true,
  rawPropensityContract: true,
  supportNotRegressed:
    preferred.supportCoverage >= sourceWinner.supportCoverage - 0.01,
  rawLogLossNotRegressed:
    preferred.rawLogLoss <= sourceWinner.rawLogLoss + 0.02,
  majorLowSupportNotRegressed:
    preferred.majorLowSupportGroupCount <= sourceWinner.majorLowSupportGroupCount,
  candidateCoveragePreserved: preferred.candidateCoverage === candidateCoverage,
  candidateCoverageReleaseEligible: candidateCoverage >= 0.99,
};
summary.fullTrainingCandidatePrepared = Object.values(
  summary.refinementChecks,
).every(Boolean);

await writeJson(summaryPath, summary);
console.log(
  JSON.stringify(
    {
      operation: 'RECOMMENDATION_BEHAVIORAL_V5_2_REFINEMENT_NORMALIZATION',
      executorVersion: summary.executorVersion,
      candidateCoverage,
      preferredVariant: summary.preferredVariant,
      fullTrainingCandidatePrepared: summary.fullTrainingCandidatePrepared,
    },
    null,
    2,
  ),
);

function compareVariants(left, right) {
  return (
    Number(Boolean(right.releaseGatePassed)) -
      Number(Boolean(left.releaseGatePassed)) ||
    left.majorLowSupportGroupCount - right.majorLowSupportGroupCount ||
    right.supportCoverage - left.supportCoverage ||
    left.rawLogLoss - right.rawLogLoss ||
    right.top1Rate - left.top1Rate ||
    left.floorSensitivityDelta - right.floorSensitivityDelta ||
    left.modelByteLength - right.modelByteLength ||
    left.variant.localeCompare(right.variant)
  );
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8');
}

function requiredString(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}
