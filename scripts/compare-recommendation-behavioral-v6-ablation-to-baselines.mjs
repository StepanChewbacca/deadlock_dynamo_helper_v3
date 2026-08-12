import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const ablationSummaryPath = required('BEHAVIORAL_V6_ABLATION_SUMMARY_PATH');
const baselineReportPath = required('BEHAVIORAL_V6_BASELINE_REPORT_PATH');
const outputPath = required('BEHAVIORAL_V6_ABLATION_BASELINE_GATE_PATH');

const ablationBytes = await readFile(ablationSummaryPath);
const baselineBytes = await readFile(baselineReportPath);
const ablation = JSON.parse(ablationBytes.toString('utf8'));
const baselines = JSON.parse(baselineBytes.toString('utf8'));
validateAblation(ablation);
validateBaselines(baselines);

assertEqual(
  ablation.source.pinnedSampleSha256,
  baselines.source.sampleSha256,
  'Pinned sample SHA-256',
);
assertEqual(
  ablation.choiceSet.definition,
  baselines.choiceSet.definition,
  'Choice-set definition',
);
assertEqual(
  ablation.source.futureTestRowCount,
  0,
  'Ablation FUTURE_TEST row count',
);
assertEqual(
  baselines.source.futureTestRowCount,
  0,
  'Baseline FUTURE_TEST row count',
);

const preferred = ablation.results.find(
  (result) => result.variant === ablation.preferredVariant,
);
if (!preferred) {
  throw new Error(
    `Preferred ablation variant ${ablation.preferredVariant} is missing.`,
  );
}
const baselineSupportCeiling = Math.max(
  ...baselines.results.map((result) =>
    finite(result.supportCoverage, `${result.id}.supportCoverage`),
  ),
);
const baselineRawLogLossFloor = Math.min(
  ...baselines.results.map((result) =>
    finite(result.rawLogLoss, `${result.id}.rawLogLoss`),
  ),
);
const bestSupportBaseline = [...baselines.results].sort(
  (left, right) =>
    right.supportCoverage - left.supportCoverage ||
    left.id.localeCompare(right.id),
)[0];
const bestLogLossBaseline = [...baselines.results].sort(
  (left, right) =>
    left.rawLogLoss - right.rawLogLoss || left.id.localeCompare(right.id),
)[0];
const checks = {
  frozenChoiceSetPassed:
    ablation.choiceSet.candidateCoverage >= 0.99 &&
    ablation.choiceSet.frozenGateLowCoverageMajorGroupCount === 0 &&
    baselines.choiceSet.candidateCoverage >= 0.99,
  preferredReleaseGatePassed: preferred.releaseGatePassed === true,
  preferredSupportBeatsBaselineEnvelope:
    preferred.supportCoverage > baselineSupportCeiling,
  preferredRawLogLossBeatsBaselineEnvelope:
    preferred.rawLogLoss < baselineRawLogLossFloor,
  noFutureTestUse:
    ablation.source.futureTestRowCount === 0 &&
    baselines.source.futureTestRowCount === 0 &&
    baselines.futureTestEvaluated === false,
  streamingBaselineExecution:
    baselines.executorVersion === 'MERGED_TOP_96_BASELINES_STREAMING_2' &&
    baselines.execution?.rowsMaterializedInHeap === false &&
    baselines.execution?.singlePassStreamingEvaluation === true,
  rawPropensityContract:
    ablation.contracts?.probabilityContract === 'RAW_SOFTMAX_WITHIN_DECISION',
  aggregatedOptimizerContract:
    ablation.contracts?.optimizerContract ===
    'AGGREGATE_DATA_GRADIENT_THEN_SINGLE_L2_UPDATE_PER_PARAMETER',
};
const failedChecks = Object.entries(checks)
  .filter(([, passed]) => passed !== true)
  .map(([name]) => name);
const currentFamilyContinuationRecommended = failedChecks.length === 0;
const report = {
  schemaVersion: 2,
  operation: 'RECOMMENDATION_BEHAVIORAL_V6_ABLATION_BASELINE_GATE',
  generatedAt: new Date().toISOString(),
  trainingPerformed: false,
  valueTrainingPerformed: false,
  futureTestEvaluated: false,
  source: {
    ablationSummarySha256: sha256(ablationBytes),
    baselineReportSha256: sha256(baselineBytes),
    baselineExecutorVersion: baselines.executorVersion,
    pinnedSampleSha256: ablation.source.pinnedSampleSha256,
    choiceSetDefinition: ablation.choiceSet.definition,
  },
  preferredVariant: preferred.variant,
  preferredMetrics: {
    supportCoverage: preferred.supportCoverage,
    rawLogLoss: preferred.rawLogLoss,
    top1Rate: preferred.top1Rate,
    majorLowSupportGroupCount: preferred.majorLowSupportGroupCount,
    releaseGatePassed: preferred.releaseGatePassed,
  },
  baselineEnvelope: {
    maximumSupportCoverage: baselineSupportCeiling,
    maximumSupportBaseline: bestSupportBaseline.id,
    minimumRawLogLoss: baselineRawLogLossFloor,
    minimumRawLogLossBaseline: bestLogLossBaseline.id,
    results: baselines.results.map((result) => ({
      id: result.id,
      supportCoverage: result.supportCoverage,
      rawLogLoss: result.rawLogLoss,
      top1Rate: result.top1Rate,
      majorLowSupportGroupCount: result.majorLowSupportGroupCount,
    })),
  },
  deltas: {
    supportVsBaselineCeiling:
      preferred.supportCoverage - baselineSupportCeiling,
    rawLogLossVsBaselineFloor:
      preferred.rawLogLoss - baselineRawLogLossFloor,
  },
  checks,
  failedChecks,
  currentFamilyContinuationRecommended,
  nextFamilyRecommended: currentFamilyContinuationRecommended
    ? null
    : 'GROUPED_BOOSTED_LISTWISE',
  fullTrainingAuthorized: false,
  valueV8TrainingAuthorized: false,
  productionRankingChanged: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

function validateAblation(value) {
  if (
    value.schemaVersion !== 2 ||
    value.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_EQUAL_CAPACITY_ABLATION' ||
    value.executorVersion !==
      'MERGED_TOP_96_AGGREGATED_OPTIMIZER_STREAMING_2' ||
    value.choiceSet?.definition !== 'MERGED_TOP_96' ||
    value.fullTrainingAuthorized !== false ||
    value.valueV8TrainingAuthorized !== false ||
    !Array.isArray(value.results) ||
    value.results.length !== 2
  ) {
    throw new Error(
      'Behavioral V6 ablation summary is not eligible for baseline comparison.',
    );
  }
}

function validateBaselines(value) {
  const expectedIds = new Set([
    'HISTORICAL_PRIOR',
    'GENERATOR_PRIOR',
    'INVERSE_RANK',
  ]);
  if (
    value.schemaVersion !== 2 ||
    value.operation !== 'RECOMMENDATION_BEHAVIORAL_V6_TOP96_BASELINE_EVALUATION' ||
    value.executorVersion !== 'MERGED_TOP_96_BASELINES_STREAMING_2' ||
    value.trainingPerformed !== false ||
    value.valueTrainingPerformed !== false ||
    value.futureTestEvaluated !== false ||
    value.execution?.rowsMaterializedInHeap !== false ||
    value.execution?.singlePassStreamingEvaluation !== true ||
    value.choiceSet?.definition !== 'MERGED_TOP_96' ||
    !Array.isArray(value.results) ||
    value.results.length !== 3 ||
    value.results.some((result) => !expectedIds.delete(result.id)) ||
    expectedIds.size !== 0
  ) {
    throw new Error(
      'Behavioral V6 baseline report is not eligible for ablation comparison.',
    );
  }
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be finite.`);
  }
  return number;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected ${expected}, received ${actual}.`,
    );
  }
}
