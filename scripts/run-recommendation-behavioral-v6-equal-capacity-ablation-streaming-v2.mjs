import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { once } from 'node:events';

const require = createRequire(import.meta.url);
const {
  createRecommendationBehavioralV6Model,
  createRecommendationBehavioralV6OptimizerAudit,
  predictRecommendationBehavioralV6,
  recommendationBehavioralV6FoldId,
  recommendationBehavioralV6OptimizerAuditSummary,
  RECOMMENDATION_BEHAVIORAL_V6_FEATURE_VERSION,
  RECOMMENDATION_BEHAVIORAL_V6_MODEL_VERSION,
  RECOMMENDATION_BEHAVIORAL_V6_OPTIMIZER_CONTRACT,
  RECOMMENDATION_BEHAVIORAL_V6_PROBABILITY_CONTRACT,
  RECOMMENDATION_BEHAVIORAL_V6_SCHEMA_VERSION,
  trainRecommendationBehavioralV6Decision,
  validateRecommendationBehavioralV6Model,
} = require('/app/apps/api/dist/src/deadlock-live/recommendation-behavioral-v6.js');

const sourceDirectory = required('DEADLOCK_RECOMMENDATION_BEHAVIORAL_V6_SOURCE_DIR');
const samplePath = required('BEHAVIORAL_V6_SAMPLE_PATH');
const choiceSetReportPath = required('BEHAVIORAL_V6_CHOICE_SET_REPORT_PATH');
const outputDirectory = required('BEHAVIORAL_V6_ABLATION_OUTPUT_DIR');
const expectedDatasetSha256 = requiredSha('EXPECTED_DATASET_SHA256');
const expectedSampleSha256 = requiredSha('EXPECTED_DIAGNOSTIC_SAMPLE_SHA256');
const choiceSetDefinition = 'MERGED_TOP_96';
const choiceSetLimit = 96;
const common = {
  foldCount: 5,
  epochs: 5,
  learningRate: 0.1,
  l2: 0.0001,
  supportProbability: 0.01,
  propensityFloors: [0.005, 0.01, 0.02],
  majorGroupMinDecisions: 100,
  linearHashDimension: 65_536,
  embeddingHashDimension: 4_096,
  latentDimension: 8,
};
const variants = [
  { id: 'L', architecture: 'LINEAR_ONLY' },
  { id: 'LT', architecture: 'LINEAR_PLUS_TOWER' },
];

const manifest = JSON.parse(await readFile(join(sourceDirectory, 'manifest.json'), 'utf8'));
const audit = JSON.parse(await readFile(join(sourceDirectory, 'audit.json'), 'utf8'));
validateDataset(manifest, audit);
const datasetPath = join(sourceDirectory, manifest.artifact.fileName);
assertEqual(await hashFile(datasetPath), expectedDatasetSha256, 'Dataset V6 artifact SHA-256');
assertEqual(manifest.artifact.sha256, expectedDatasetSha256, 'Dataset V6 manifest SHA-256');
assertEqual(await hashFile(samplePath), expectedSampleSha256, 'Pinned MATCH sample SHA-256');

const choiceSetReport = JSON.parse(await readFile(choiceSetReportPath, 'utf8'));
validateChoiceSetReport(choiceSetReport);
const selectedChoiceSet = choiceSetReport.variants.find(
  (variant) => variant.id === choiceSetDefinition,
);
if (!selectedChoiceSet?.gate?.passed) {
  throw new Error(`${choiceSetDefinition} did not pass the frozen choice-set gate.`);
}

await mkdir(outputDirectory, { recursive: true });
const spoolDirectory = join(outputDirectory, '.streaming-spool-v2');
await rm(spoolDirectory, { recursive: true, force: true });
await mkdir(spoolDirectory, { recursive: true });
const trainPath = join(spoolDirectory, 'train.ndjson');
const tuningPath = join(spoolDirectory, 'tuning.ndjson');
const foldPaths = Array.from(
  { length: common.foldCount },
  (_, fold) => join(spoolDirectory, `train-fold-${fold}.ndjson`),
);

const spool = await spoolPinnedSample();
if (spool.futureTestRowCount !== 0) {
  throw new Error(
    `Pinned Behavioral V6 sample unexpectedly contains ${spool.futureTestRowCount} FUTURE_TEST rows.`,
  );
}
const candidateCoverage = divide(
  spool.candidateCoveredSelectionRowCount,
  spool.selectionRowCount,
);
if (candidateCoverage < 0.99) {
  throw new Error(
    `Behavioral V6 ${choiceSetDefinition} coverage ${candidateCoverage} is below 0.99.`,
  );
}
if (spool.trainRowCount === 0 || spool.tuningRowCount === 0) {
  throw new Error('Behavioral V6 ablation requires non-empty TRAIN and TUNING rows.');
}
if (spool.foldDecisionCounts.some((count) => count === 0)) {
  throw new Error(
    `Behavioral V6 fold coverage is incomplete: ${spool.foldDecisionCounts.join(',')}.`,
  );
}
await writeJson(join(outputDirectory, 'streaming-spool-manifest.json'), {
  schemaVersion: 1,
  executorVersion: 'MERGED_TOP_96_AGGREGATED_OPTIMIZER_STREAMING_2',
  sourceSampleSha256: expectedSampleSha256,
  choiceSetDefinition,
  counts: spool,
  orderingContract: {
    trainFilePreservesPinnedSampleOrder: true,
    tuningFilePreservesPinnedSampleOrder: true,
    foldFilesPreservePinnedSampleOrderWithinFold: true,
    crossFitFoldIterationOrder: 'ASCENDING_FOLD_ID_EXCLUDING_HOLDOUT',
  },
});
console.log(JSON.stringify({
  progress: 'SPOOL_COMPLETE',
  pinnedSampleRowCount: spool.pinnedSampleRowCount,
  selectionRowCount: spool.selectionRowCount,
  filteredSelectionRowCount: spool.filteredSelectionRowCount,
  trainRowCount: spool.trainRowCount,
  tuningRowCount: spool.tuningRowCount,
  foldDecisionCounts: spool.foldDecisionCounts,
  candidateCoverage,
}));

const results = [];
for (const variant of variants) {
  const result = await runVariant(variant);
  results.push(result);
  await writeVariant(result);
  console.log(JSON.stringify({ progress: 'VARIANT_COMPLETE', summary: result.summary }));
}

const ranked = [...results].sort((left, right) =>
  compareSummaries(left.summary, right.summary),
);
const preferred = ranked[0].summary;
const linear = results.find((result) => result.summary.variant === 'L').summary;
const tower = results.find((result) => result.summary.variant === 'LT').summary;
const towerRecommended =
  preferred.variant === 'LT' &&
  (tower.rawLogLoss < linear.rawLogLoss ||
    tower.supportCoverage > linear.supportCoverage) &&
  tower.majorLowSupportGroupCount <= linear.majorLowSupportGroupCount;
const anyReleaseEligible = results.some(
  (result) => result.summary.releaseGatePassed,
);
const summary = {
  schemaVersion: 2,
  operation: 'RECOMMENDATION_BEHAVIORAL_V6_EQUAL_CAPACITY_ABLATION',
  executorVersion: 'MERGED_TOP_96_AGGREGATED_OPTIMIZER_STREAMING_2',
  generatedAt: new Date().toISOString(),
  source: {
    directory: sourceDirectory,
    datasetSha256: expectedDatasetSha256,
    pinnedSampleSha256: expectedSampleSha256,
    pinnedSampleRowCount: spool.pinnedSampleRowCount,
    selectionRowCount: spool.selectionRowCount,
    filteredSelectionRowCount: spool.filteredSelectionRowCount,
    trainRowCount: spool.trainRowCount,
    tuningRowCount: spool.tuningRowCount,
    futureTestRowCount: spool.futureTestRowCount,
  },
  choiceSet: {
    definition: choiceSetDefinition,
    maximumCandidates: choiceSetLimit,
    candidateCoverage,
    frozenGateOverallCoverage: selectedChoiceSet.overall.observedCoverage,
    frozenGateLowCoverageMajorGroupCount:
      selectedChoiceSet.gate.lowCoverageMajorGroupCount,
    observedActionInjected: false,
    selectedAfterObservedAction: false,
  },
  commonConfiguration: common,
  contracts: {
    modelVersion: RECOMMENDATION_BEHAVIORAL_V6_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V6_FEATURE_VERSION,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V6_PROBABILITY_CONTRACT,
    optimizerContract: RECOMMENDATION_BEHAVIORAL_V6_OPTIMIZER_CONTRACT,
  },
  execution: {
    rowsMaterializedInHeap: false,
    spoolDirectoryRemovedAfterSuccess: true,
    trainOrderPreserved: true,
    foldOrderPreserved: true,
  },
  selectionProtocol: [
    'releaseGatePassed DESC',
    'majorLowSupportGroupCount ASC',
    'supportCoverage DESC',
    'rawLogLoss ASC',
    'top1Rate DESC',
    'variant ASC',
  ],
  preferredVariant: preferred.variant,
  towerRecommended,
  anyReleaseEligible,
  nextFamilyRecommended: anyReleaseEligible ? null : 'GROUPED_BOOSTED_LISTWISE',
  fullTrainingAuthorized: false,
  valueV8TrainingAuthorized: false,
  productionRankingChanged: false,
  passiveShadowAuthorized: false,
  randomizedCanaryAuthorized: false,
  results: results.map((result) => result.summary),
};
await writeJson(join(outputDirectory, 'ablation-summary.json'), summary);
await writeFile(
  join(outputDirectory, 'ablation-report.txt'),
  renderReport(summary),
  'utf8',
);
await rm(spoolDirectory, { recursive: true, force: true });
console.log(JSON.stringify(summary, null, 2));

async function spoolPinnedSample() {
  const train = createWriteStream(trainPath, { flags: 'wx' });
  const tuning = createWriteStream(tuningPath, { flags: 'wx' });
  const folds = foldPaths.map((path) => createWriteStream(path, { flags: 'wx' }));
  const matchFolds = new Map();
  const counts = {
    pinnedSampleRowCount: 0,
    selectionRowCount: 0,
    candidateCoveredSelectionRowCount: 0,
    filteredSelectionRowCount: 0,
    trainRowCount: 0,
    tuningRowCount: 0,
    futureTestRowCount: 0,
    foldDecisionCounts: Array.from({ length: common.foldCount }, () => 0),
  };
  try {
    const input = createInterface({
      input: createReadStream(samplePath).pipe(createGunzip()),
      crlfDelay: Infinity,
    });
    for await (const line of input) {
      if (!line.trim()) continue;
      counts.pinnedSampleRowCount += 1;
      const row = JSON.parse(line);
      if (row.split === 'FUTURE_TEST') {
        counts.futureTestRowCount += 1;
        continue;
      }
      if (row.split !== 'TRAIN' && row.split !== 'TUNING') continue;
      counts.selectionRowCount += 1;
      if (observedInsideTop96(row)) {
        counts.candidateCoveredSelectionRowCount += 1;
      }
      if (
        row.eligibility?.behavioralModel !== true ||
        !observedInsideTop96(row)
      ) {
        continue;
      }
      const filtered = applyTop96ChoiceSet(row);
      if (filtered.candidates.length < 2) continue;
      counts.filteredSelectionRowCount += 1;
      const serialized = `${JSON.stringify(filtered)}\n`;
      if (filtered.split === 'TRAIN') {
        counts.trainRowCount += 1;
        const fold = recommendationBehavioralV6FoldId(
          filtered.matchId,
          common.foldCount,
        );
        const existing = matchFolds.get(filtered.matchId);
        if (existing !== undefined && existing !== fold) {
          throw new Error(`MATCH fold instability for ${filtered.matchId}.`);
        }
        matchFolds.set(filtered.matchId, fold);
        counts.foldDecisionCounts[fold] += 1;
        await writeChunk(train, serialized);
        await writeChunk(folds[fold], serialized);
      } else {
        counts.tuningRowCount += 1;
        await writeChunk(tuning, serialized);
      }
      if (counts.filteredSelectionRowCount % 5_000 === 0) {
        console.log(JSON.stringify({
          progress: 'SPOOL_ROWS',
          filteredSelectionRowCount: counts.filteredSelectionRowCount,
        }));
      }
    }
  } finally {
    await Promise.all([
      endStream(train),
      endStream(tuning),
      ...folds.map(endStream),
    ]);
  }
  return counts;
}

async function runVariant(variant) {
  const config = {
    architecture: variant.architecture,
    linearHashDimension: common.linearHashDimension,
    embeddingHashDimension: common.embeddingHashDimension,
    latentDimension: common.latentDimension,
  };
  const foldModels = [];
  const optimizerAudit = createRecommendationBehavioralV6OptimizerAudit();
  for (let holdout = 0; holdout < common.foldCount; holdout += 1) {
    const model = createRecommendationBehavioralV6Model(config);
    for (let epoch = 0; epoch < common.epochs; epoch += 1) {
      for (let fold = 0; fold < common.foldCount; fold += 1) {
        if (fold === holdout) continue;
        for await (const row of readNdjson(foldPaths[fold])) {
          trainRecommendationBehavioralV6Decision(
            model,
            row,
            { learningRate: common.learningRate, l2: common.l2 },
            optimizerAudit,
          );
        }
      }
      console.log(JSON.stringify({
        progress: 'OOF_TRAIN_EPOCH',
        variant: variant.id,
        holdout,
        epoch: epoch + 1,
        trainedDecisionCount: model.trainedDecisionCount,
      }));
      await tick();
    }
    const expectedTrainingCount =
      (spool.trainRowCount - spool.foldDecisionCounts[holdout]) * common.epochs;
    assertEqual(
      model.trainedDecisionCount,
      expectedTrainingCount,
      `${variant.id} fold ${holdout} training count`,
    );
    validateRecommendationBehavioralV6Model(model);
    foldModels.push(model);
  }

  const finalModel = createRecommendationBehavioralV6Model(config);
  for (let epoch = 0; epoch < common.epochs; epoch += 1) {
    for await (const row of readNdjson(trainPath)) {
      trainRecommendationBehavioralV6Decision(
        finalModel,
        row,
        { learningRate: common.learningRate, l2: common.l2 },
        optimizerAudit,
      );
    }
    console.log(JSON.stringify({
      progress: 'FULL_TRAIN_EPOCH',
      variant: variant.id,
      epoch: epoch + 1,
      trainedDecisionCount: finalModel.trainedDecisionCount,
    }));
    await tick();
  }
  assertEqual(
    finalModel.trainedDecisionCount,
    spool.trainRowCount * common.epochs,
    `${variant.id} final training count`,
  );
  validateRecommendationBehavioralV6Model(finalModel);

  const accumulator = createAccumulator();
  for await (const row of readNdjson(trainPath)) {
    const fold = recommendationBehavioralV6FoldId(row.matchId, common.foldCount);
    observe(
      accumulator,
      row,
      predictRecommendationBehavioralV6(foldModels[fold], row),
    );
  }
  for await (const row of readNdjson(tuningPath)) {
    observe(
      accumulator,
      row,
      predictRecommendationBehavioralV6(finalModel, row),
    );
  }
  const metrics = finalizeAccumulator(accumulator);
  const majorLowSupportGroups = metrics.groups.filter(
    (group) => group.major && group.supportCoverage < 0.75,
  );
  const releaseReasons = [];
  if (candidateCoverage < 0.99) {
    releaseReasons.push('Candidate coverage is below 99%.');
  }
  if (metrics.selection.supportCoverage < 0.9) {
    releaseReasons.push('Behavior support coverage is below 90%.');
  }
  if (majorLowSupportGroups.length > 0) {
    releaseReasons.push(
      'At least one major cohort has behavior support below 75%.',
    );
  }
  if (metrics.selection.extremeCandidateProbabilityRate > 0.01) {
    releaseReasons.push('Behavioral probabilities collapsed near 0 or 1.');
  }
  if (metrics.probabilityFloorSensitivity.maximumLogLossDelta > 0.02) {
    releaseReasons.push(
      'Observed-propensity floor sensitivity exceeds 0.02 logloss.',
    );
  }
  const releaseGatePassed = releaseReasons.length === 0;
  const optimizerSummary =
    recommendationBehavioralV6OptimizerAuditSummary(optimizerAudit);

  const modelArtifact = {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V6_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V6_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V6_FEATURE_VERSION,
    probabilityContract: RECOMMENDATION_BEHAVIORAL_V6_PROBABILITY_CONTRACT,
    optimizerContract: RECOMMENDATION_BEHAVIORAL_V6_OPTIMIZER_CONTRACT,
    diagnosticOnly: true,
    sourceDatasetSha256: expectedDatasetSha256,
    pinnedSampleSha256: expectedSampleSha256,
    choiceSetDefinition,
    configuration: { ...config, ...common },
    finalModel,
  };
  const modelBytes = Buffer.from(`${JSON.stringify(modelArtifact)}\n`);
  return {
    modelArtifact,
    evaluation: {
      schemaVersion: 2,
      operation:
        'RECOMMENDATION_BEHAVIORAL_V6_EQUAL_CAPACITY_ABLATION_VARIANT',
      executorVersion: 'MERGED_TOP_96_AGGREGATED_OPTIMIZER_STREAMING_2',
      variant: variant.id,
      metrics,
      optimizerAudit: optimizerSummary,
      releaseGate: {
        passed: releaseGatePassed,
        candidateCoverage,
        behaviorSupportCoverage: metrics.selection.supportCoverage,
        majorLowSupportGroups,
        extremeCandidateProbabilityRate:
          metrics.selection.extremeCandidateProbabilityRate,
        probabilityFloorMaximumLogLossDelta:
          metrics.probabilityFloorSensitivity.maximumLogLossDelta,
        reasons: releaseReasons,
      },
      futureTestPolicy: {
        reported: false,
        evaluated: false,
        usedForTraining: false,
        usedForSelection: false,
      },
    },
    audit: {
      schemaVersion: 2,
      passed: true,
      trainingArtifactEligible: false,
      diagnosticOnly: true,
      executorVersion: 'MERGED_TOP_96_AGGREGATED_OPTIMIZER_STREAMING_2',
      choiceSetDefinition,
      crossFitting: {
        unit: 'MATCH',
        foldCount: common.foldCount,
        foldDecisionCounts: spool.foldDecisionCounts,
        oofPredictionCount: spool.trainRowCount,
        trainingMatchExclusionVerified: true,
        foldOrderPreserved: true,
      },
      optimizerContract: RECOMMENDATION_BEHAVIORAL_V6_OPTIMIZER_CONTRACT,
      optimizerAudit: optimizerSummary,
      probabilityContract: {
        output: 'RAW_SOFTMAX_WITHIN_DECISION',
        candidateProbabilityFloorApplied: false,
        observedOnlyFloorSensitivity: true,
      },
      futureTestDecisionCount: 0,
    },
    summary: {
      variant: variant.id,
      architecture: variant.architecture,
      linearHashDimension: common.linearHashDimension,
      embeddingHashDimension: common.embeddingHashDimension,
      latentDimension: common.latentDimension,
      candidateCoverage,
      supportCoverage: metrics.selection.supportCoverage,
      rawLogLoss: metrics.selection.rawLogLoss,
      top1Rate: metrics.selection.top1Rate,
      meanObservedRawProbability: metrics.selection.meanObservedRawProbability,
      minimumObservedRawProbability:
        metrics.selection.minimumObservedRawProbability,
      floorSensitivityDelta:
        metrics.probabilityFloorSensitivity.maximumLogLossDelta,
      extremeCandidateProbabilityRate:
        metrics.selection.extremeCandidateProbabilityRate,
      majorLowSupportGroupCount: majorLowSupportGroups.length,
      releaseGatePassed,
      structuralAuditPassed: true,
      trainingArtifactEligible: false,
      modelByteLength: modelBytes.length,
      modelSha256: sha256(modelBytes),
      optimizerAudit: optimizerSummary,
      trainMetrics: metrics.bySplit.TRAIN,
      tuningMetrics: metrics.bySplit.TUNING,
      releaseReasons,
    },
  };
}

async function writeVariant(result) {
  const directory = join(outputDirectory, result.summary.variant.toLowerCase());
  await mkdir(directory, { recursive: true });
  await writeJson(join(directory, 'model.json'), result.modelArtifact);
  await writeJson(join(directory, 'evaluation.json'), result.evaluation);
  await writeJson(join(directory, 'audit.json'), result.audit);
}

function createAccumulator() {
  return {
    selection: emptyMetricGroup(),
    bySplit: new Map(),
    groups: new Map(),
    floorLossSums: new Map(
      common.propensityFloors.map((floor) => [floor, 0]),
    ),
  };
}

function emptyMetricGroup() {
  return {
    decisions: 0,
    supported: 0,
    top1: 0,
    rawLogLoss: 0,
    observedProbability: 0,
    minimumObservedProbability: 1,
    extremeCandidates: 0,
    candidateCount: 0,
  };
}

function observe(accumulator, row, prediction) {
  const observedProbability = prediction.observedActionProbability;
  const supported = observedProbability >= common.supportProbability;
  const top1 = prediction.topActionKey === row.observedActionKey;
  observeMetricGroup(
    accumulator.selection,
    prediction,
    observedProbability,
    supported,
    top1,
  );
  const splitGroup = getOrCreate(
    accumulator.bySplit,
    row.split,
    emptyMetricGroup,
  );
  observeMetricGroup(
    splitGroup,
    prediction,
    observedProbability,
    supported,
    top1,
  );

  const observedCandidate = row.candidates.find(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  const groupKeys = [
    `HERO:${row.state.heroId}`,
    `PHASE:${row.state.phase}`,
    `TIME:${timeBucket(row.state.gameTimeS)}`,
    `ECONOMY:${economyBand(row.state.netWorth)}`,
    `ACTION:${String(row.observedActionKey).split(':')[0]}`,
    `TIER:${observedCandidate?.tier ?? 'UNKNOWN'}`,
  ];
  for (const key of groupKeys) {
    const group = getOrCreate(accumulator.groups, key, emptyMetricGroup);
    observeMetricGroup(
      group,
      prediction,
      observedProbability,
      supported,
      top1,
    );
  }
  for (const floor of common.propensityFloors) {
    const clipped = Math.max(observedProbability, floor);
    accumulator.floorLossSums.set(
      floor,
      accumulator.floorLossSums.get(floor) -
        Math.log(Math.max(clipped, 1e-15)),
    );
  }
}

function observeMetricGroup(
  group,
  prediction,
  observedProbability,
  supported,
  top1,
) {
  group.decisions += 1;
  group.supported += supported ? 1 : 0;
  group.top1 += top1 ? 1 : 0;
  group.rawLogLoss += -Math.log(Math.max(observedProbability, 1e-15));
  group.observedProbability += observedProbability;
  group.minimumObservedProbability = Math.min(
    group.minimumObservedProbability,
    observedProbability,
  );
  for (const candidate of prediction.candidates) {
    group.candidateCount += 1;
    if (
      candidate.probability <= 1e-8 ||
      candidate.probability >= 1 - 1e-8
    ) {
      group.extremeCandidates += 1;
    }
  }
}

function finalizeAccumulator(accumulator) {
  const selection = finalizeMetricGroup(accumulator.selection);
  const bySplit = Object.fromEntries(
    [...accumulator.bySplit.entries()].map(([key, value]) => [
      key,
      finalizeMetricGroup(value),
    ]),
  );
  const groups = [...accumulator.groups.entries()]
    .map(([key, value]) => ({
      key,
      major: value.decisions >= common.majorGroupMinDecisions,
      ...finalizeMetricGroup(value),
    }))
    .sort((left, right) =>
      left.key.localeCompare(right.key, undefined, { numeric: true }),
    );
  const floorResults = common.propensityFloors.map((floor) => {
    const logLoss = divide(
      accumulator.floorLossSums.get(floor),
      accumulator.selection.decisions,
    );
    return {
      floor,
      logLoss,
      logLossDeltaFromRaw: Math.abs(selection.rawLogLoss - logLoss),
    };
  });
  return {
    selection,
    bySplit,
    groups,
    probabilityFloorSensitivity: {
      floors: floorResults,
      maximumLogLossDelta: Math.max(
        ...floorResults.map((value) => value.logLossDeltaFromRaw),
      ),
    },
  };
}

function finalizeMetricGroup(group) {
  return {
    decisionCount: group.decisions,
    supportCoverage: divide(group.supported, group.decisions),
    rawLogLoss: divide(group.rawLogLoss, group.decisions),
    top1Rate: divide(group.top1, group.decisions),
    meanObservedRawProbability: divide(
      group.observedProbability,
      group.decisions,
    ),
    minimumObservedRawProbability:
      group.decisions > 0 ? group.minimumObservedProbability : 0,
    extremeCandidateProbabilityRate: divide(
      group.extremeCandidates,
      group.candidateCount,
    ),
  };
}

function observedInsideTop96(row) {
  const index = row.candidates.findIndex(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  return index >= 0 && index < choiceSetLimit;
}

function applyTop96ChoiceSet(row) {
  const candidates = row.candidates
    .slice(0, choiceSetLimit)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));
  return {
    ...row,
    candidates,
    observedActionInCandidateSet: candidates.some(
      (candidate) => candidate.actionKey === row.observedActionKey,
    ),
    eligibility: {
      ...row.eligibility,
      behavioralModel: true,
    },
  };
}

function compareSummaries(left, right) {
  return (
    Number(right.releaseGatePassed) - Number(left.releaseGatePassed) ||
    left.majorLowSupportGroupCount - right.majorLowSupportGroupCount ||
    right.supportCoverage - left.supportCoverage ||
    left.rawLogLoss - right.rawLogLoss ||
    right.top1Rate - left.top1Rate ||
    left.variant.localeCompare(right.variant)
  );
}

function validateDataset(manifest, audit) {
  if (
    manifest.auditPassed !== true ||
    manifest.trainingArtifactEligible !== true
  ) {
    throw new Error(
      'Dataset V6 manifest is not eligible for Behavioral V6 ablation.',
    );
  }
  if (audit.passed !== true || audit.trainingArtifactEligible !== true) {
    throw new Error(
      'Dataset V6 audit is not eligible for Behavioral V6 ablation.',
    );
  }
}

function validateChoiceSetReport(report) {
  if (
    report.schemaVersion !== 1 ||
    report.operation !==
      'RECOMMENDATION_BEHAVIORAL_V6_CHOICE_SET_CANDIDATE_EVALUATION' ||
    report.trainingPerformed !== false ||
    report.valueTrainingPerformed !== false ||
    report.futureTestEvaluated !== false ||
    report.source?.futureTestRowCount !== 0 ||
    report.recommendation?.candidateDefinitionId !== choiceSetDefinition
  ) {
    throw new Error(
      'Behavioral V6 frozen choice-set report is not eligible for ablation.',
    );
  }
}

async function* readNdjson(path) {
  const input = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  for await (const line of input) {
    if (!line.trim()) continue;
    yield JSON.parse(line);
  }
}

async function writeChunk(stream, chunk) {
  if (stream.write(chunk)) return;
  await once(stream, 'drain');
}

async function endStream(stream) {
  if (stream.destroyed) return;
  stream.end();
  await once(stream, 'finish');
}

function renderReport(summary) {
  return [
    'Recommendation Behavioral V6 Equal-Capacity Ablation Streaming V2',
    `choiceSet=${summary.choiceSet.definition}`,
    `candidateCoverage=${summary.choiceSet.candidateCoverage}`,
    `preferredVariant=${summary.preferredVariant}`,
    `towerRecommended=${summary.towerRecommended}`,
    `anyReleaseEligible=${summary.anyReleaseEligible}`,
    `nextFamilyRecommended=${summary.nextFamilyRecommended ?? 'NONE'}`,
    ...summary.results.map(
      (result) =>
        `${result.variant}: support=${result.supportCoverage} rawLL=${result.rawLogLoss} top1=${result.top1Rate} majorLow=${result.majorLowSupportGroupCount} release=${result.releaseGatePassed}`,
    ),
  ].join('\n') + '\n';
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function requiredSha(name) {
  const value = required(name).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be SHA-256.`);
  }
  return value;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: ${actual} versus ${expected}.`);
  }
}

function getOrCreate(map, key, factory) {
  let value = map.get(key);
  if (!value) {
    value = factory();
    map.set(key, value);
  }
  return value;
}

function timeBucket(seconds) {
  const start = Math.floor(Math.max(0, Number(seconds) || 0) / 300) * 5;
  return `${start}-${start + 5}m`;
}

function economyBand(netWorth) {
  const value = Number(netWorth);
  if (!Number.isFinite(value)) return 'UNKNOWN';
  if (value < 5_000) return 'LT_5000';
  if (value < 10_000) return '5000_9999';
  if (value < 15_000) return '10000_14999';
  if (value < 20_000) return '15000_19999';
  return 'GE_20000';
}

function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}
