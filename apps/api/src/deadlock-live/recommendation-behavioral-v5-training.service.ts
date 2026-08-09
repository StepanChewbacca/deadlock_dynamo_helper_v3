import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  GzipNdjsonWriter,
  openMaybeGzipNdjsonReadStream,
} from './gzip-ndjson';
import {
  createRecommendationBehavioralV5Model,
  predictRecommendationBehavioralV5,
  recommendationBehavioralV5DiagnosticMatchSelected,
  recommendationBehavioralV5FoldId,
  stabilizeRecommendationBehavioralV5ObservedProbability,
  RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION,
  RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,
  RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION,
  trainRecommendationBehavioralV5Decision,
  type RecommendationBehavioralV5Model,
  type RecommendationBehavioralV5Prediction,
} from './recommendation-behavioral-v5';
import type {
  RecommendationProDecisionDatasetV6ArtifactAudit,
  RecommendationProDecisionDatasetV6ArtifactManifest,
} from './recommendation-pro-decision-dataset-v6-artifact.service';
import {
  RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION,
  RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION,
  type RecommendationDatasetV6Split,
  type RecommendationProDecisionDatasetV6Row,
} from './recommendation-pro-decision-dataset-v6';
import { sha256StableJson } from './stable-json';

const DEFAULT_SOURCE_DIRECTORY =
  '/app/apps/api/storage/recommendation-pro-decision-dataset-v6-1';
const DEFAULT_OUTPUT_DIRECTORY =
  '/app/apps/api/storage/recommendation-behavioral-v5-1';
const DATASET_FILE_NAME = 'dataset.ndjson';
const PROPENSITY_FILE_NAME = 'propensities.ndjson';
const DIAGNOSTIC_SAMPLE_FILE_NAME = 'diagnostic-sample.ndjson.gz';
const CALIBRATION_BIN_COUNT = 10;
const EXTREME_PROBABILITY_EPSILON = 1e-6;

export interface RecommendationBehavioralV5TrainingStartRequest {
  foldCount?: number;
  epochs?: number;
  learningRate?: number;
  l2?: number;
  hashDimension?: number;
  propensityFloor?: number;
  supportProbability?: number;
  majorGroupMinDecisions?: number;
  expectedSourceSha256?: string;
  maxRows?: number;
  diagnosticMatchModulo?: number;
  diagnosticMatchRemainder?: number;
}

export interface RecommendationBehavioralV5TrainingOptions {
  foldCount: number;
  epochs: number;
  learningRate: number;
  l2: number;
  hashDimension: number;
  propensityFloor: number;
  probabilityFloors: [0.005, 0.01, 0.02];
  supportProbability: number;
  majorGroupMinDecisions: number;
  expectedSourceSha256?: string;
  maxRows?: number;
  diagnosticMatchModulo?: number;
  diagnosticMatchRemainder?: number;
}

export interface RecommendationBehavioralV5TrainingStatus {
  state: 'IDLE' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  phase:
    | 'PREPARING'
    | 'TRAINING_FOLDS'
    | 'TRAINING_FINAL'
    | 'PREDICTING'
    | 'FINALIZING'
    | 'COMPLETE';
  currentPass: number;
  totalPasses: number;
  sourceRowCount: number;
  trainEligibleDecisionCount: number;
  tuningEligibleDecisionCount: number;
  futureTestEligibleDecisionCount: number;
  predictionRowCount: number;
  currentFold?: number;
  currentEpoch?: number;
  outputDirectory: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  options?: RecommendationBehavioralV5TrainingOptions;
  modelAvailable: boolean;
  propensitiesAvailable: boolean;
  evaluationAvailable: boolean;
  auditAvailable: boolean;
  manifestAvailable: boolean;
  releaseGatePassed?: boolean;
  trainingArtifactEligible?: boolean;
}

export interface RecommendationBehavioralV5PropensityRow {
  schemaVersion: typeof RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION;
  modelVersion: typeof RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION;
  featureVersion: typeof RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION;
  decisionId: string;
  matchId: string;
  split: RecommendationDatasetV6Split;
  predictionSource: 'CROSS_FITTED_OOF' | 'FULL_TRAIN_MODEL';
  foldId?: number;
  trainingMatchExcluded: true;
  observedActionKey: string;
  observedActionRawProbability: number;
  observedActionProbability: number;
  probabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION';
  supported: boolean;
  propensityFloor: number;
  propensityFloorApplied: false;
  candidates: Array<{
    actionKey: string;
    itemId: number;
    score: number;
    rawProbability: number;
    probability: number;
    rank: number;
  }>;
  modelArtifactSha256: string;
  sourceDatasetSha256: string;
}

interface SourceSummary {
  scannedRowCount: number;
  diagnosticSampleRowCount: number;
  invalidRowCount: number;
  candidateCoveredSelectionDecisionCount: number;
  selectionDecisionCount: number;
  eligibleBySplit: Record<RecommendationDatasetV6Split, number>;
  ineligibleBySplit: Record<RecommendationDatasetV6Split, number>;
  trainMatchIdsByFold: Array<Set<string>>;
  trainDecisionCountByFold: number[];
}

interface LoadedSource {
  manifest: RecommendationProDecisionDatasetV6ArtifactManifest;
  audit: RecommendationProDecisionDatasetV6ArtifactAudit;
  datasetPath: string;
  sha256: string;
  byteLength: number;
  rowCount: number;
}

interface FoldModelArtifact {
  holdoutFoldId: number;
  trainingRule: 'TRAIN_ROWS_EXCLUDING_HOLDOUT_MATCH_FOLD';
  model: RecommendationBehavioralV5Model;
}

interface MetricsState {
  decisionCount: number;
  candidateCount: number;
  coveredDecisionCount: number;
  supportedDecisionCount: number;
  top1Count: number;
  rawLogLossSum: number;
  floorClippedObservedLogLossSum: number;
  rawBrierSum: number;
  entropySum: number;
  observedRawProbabilitySum: number;
  observedProbabilitySum: number;
  minimumObservedRawProbability: number;
  maximumCandidateProbability: number;
  extremeCandidateProbabilityCount: number;
  calibrationBins: CalibrationBinState[];
}

interface CalibrationBinState {
  candidateCount: number;
  probabilitySum: number;
  positiveCount: number;
}

interface GroupState {
  type: 'HERO' | 'TIME_BUCKET' | 'ITEM_TIER' | 'ECONOMY_BAND';
  value: string;
  decisionCount: number;
  supportedDecisionCount: number;
  rawLogLossSum: number;
}

class BehavioralV5EvaluationAccumulator {
  private readonly bySplit = new Map<RecommendationDatasetV6Split, MetricsState>();
  private readonly selection = emptyMetricsState();
  private readonly groups = new Map<string, GroupState>();
  private readonly floorLogLossSum = new Map<number, number>();
  private selectionDecisionCount = 0;

  constructor(
    private readonly supportProbability: number,
    private readonly probabilityFloors: readonly number[],
  ) {
    for (const split of ['TRAIN', 'TUNING', 'FUTURE_TEST'] as const) {
      this.bySplit.set(split, emptyMetricsState());
    }
    for (const floor of probabilityFloors) {
      this.floorLogLossSum.set(floor, 0);
    }
  }

  observe(
    row: RecommendationProDecisionDatasetV6Row,
    rawPrediction: RecommendationBehavioralV5Prediction,
    floorClippedObservedProbability: number,
  ): void {
    const supported =
      rawPrediction.observedActionProbability >= this.supportProbability;
    this.observeMetrics(
      this.bySplit.get(row.split) as MetricsState,
      row,
      rawPrediction,
      floorClippedObservedProbability,
      supported,
    );
    if (row.split !== 'FUTURE_TEST') {
      this.observeMetrics(
        this.selection,
        row,
        rawPrediction,
        floorClippedObservedProbability,
        supported,
      );
      this.selectionDecisionCount += 1;
      this.observeGroups(row, rawPrediction, supported);
      for (const floor of this.probabilityFloors) {
        const observedProbability =
          stabilizeRecommendationBehavioralV5ObservedProbability(
            rawPrediction.observedActionProbability,
            floor,
          );
        this.floorLogLossSum.set(
          floor,
          (this.floorLogLossSum.get(floor) ?? 0) -
            Math.log(Math.max(observedProbability, 1e-15)),
        );
      }
    }
  }

  finalize(majorGroupMinDecisions: number) {
    const bySplit = Object.fromEntries(
      [...this.bySplit.entries()].map(([split, state]) => [
        split,
        finalizeMetrics(state),
      ]),
    ) as Record<RecommendationDatasetV6Split, ReturnType<typeof finalizeMetrics>>;
    const selection = finalizeMetrics(this.selection);
    const floors = [...this.floorLogLossSum.entries()]
      .sort(([left], [right]) => left - right)
      .map(([floor, sum]) => ({
        floor,
        decisionCount: this.selectionDecisionCount,
        logLoss: divide(sum, this.selectionDecisionCount),
      }));
    const finiteFloorLosses = floors
      .map((value) => value.logLoss)
      .filter((value) => Number.isFinite(value));
    const maximumFloorLogLossDelta =
      finiteFloorLosses.length === 0
        ? Number.POSITIVE_INFINITY
        : Math.max(...finiteFloorLosses) - Math.min(...finiteFloorLosses);
    const groups = [...this.groups.values()]
      .map((group) => ({
        type: group.type,
        value: group.value,
        decisionCount: group.decisionCount,
        supportCoverage: divide(
          group.supportedDecisionCount,
          group.decisionCount,
        ),
        rawLogLoss: divide(group.rawLogLossSum, group.decisionCount),
        major: group.decisionCount >= majorGroupMinDecisions,
      }))
      .sort(
        (left, right) =>
          left.type.localeCompare(right.type) ||
          left.value.localeCompare(right.value),
      );
    return {
      bySplit,
      selection,
      probabilityFloorSensitivity: {
        floors,
        maximumLogLossDelta: maximumFloorLogLossDelta,
      },
      groups,
    };
  }

  private observeMetrics(
    state: MetricsState,
    row: RecommendationProDecisionDatasetV6Row,
    rawPrediction: RecommendationBehavioralV5Prediction,
    floorClippedObservedProbability: number,
    supported: boolean,
  ): void {
    const rawByAction = new Map(
      rawPrediction.candidates.map((candidate) => [
        candidate.actionKey,
        candidate.probability,
      ]),
    );
    state.decisionCount += 1;
    state.candidateCount += row.candidates.length;
    state.coveredDecisionCount += rawByAction.has(row.observedActionKey) ? 1 : 0;
    state.supportedDecisionCount += supported ? 1 : 0;
    state.top1Count += rawPrediction.topActionKey === row.observedActionKey ? 1 : 0;
    state.rawLogLossSum += -Math.log(
      Math.max(rawPrediction.observedActionProbability, 1e-15),
    );
    state.floorClippedObservedLogLossSum += -Math.log(
      Math.max(floorClippedObservedProbability, 1e-15),
    );
    state.entropySum += rawPrediction.entropy;
    state.observedRawProbabilitySum += rawPrediction.observedActionProbability;
    state.observedProbabilitySum += rawPrediction.observedActionProbability;
    state.minimumObservedRawProbability = Math.min(
      state.minimumObservedRawProbability,
      rawPrediction.observedActionProbability,
    );
    state.maximumCandidateProbability = Math.max(
      state.maximumCandidateProbability,
      rawPrediction.maximumProbability,
    );

    for (const candidate of row.candidates) {
      const rawProbability = rawByAction.get(candidate.actionKey) ?? 0;
      const label = candidate.actionKey === row.observedActionKey ? 1 : 0;
      state.rawBrierSum += (rawProbability - label) ** 2;
      state.extremeCandidateProbabilityCount +=
        rawProbability <= EXTREME_PROBABILITY_EPSILON ||
        rawProbability >= 1 - EXTREME_PROBABILITY_EPSILON
          ? 1
          : 0;
      const binIndex = Math.min(
        CALIBRATION_BIN_COUNT - 1,
        Math.floor(rawProbability * CALIBRATION_BIN_COUNT),
      );
      const bin = state.calibrationBins[binIndex];
      bin.candidateCount += 1;
      bin.probabilitySum += rawProbability;
      bin.positiveCount += label;
    }
  }

  private observeGroups(
    row: RecommendationProDecisionDatasetV6Row,
    prediction: RecommendationBehavioralV5Prediction,
    supported: boolean,
  ): void {
    const observedCandidate = row.candidates.find(
      (candidate) => candidate.actionKey === row.observedActionKey,
    );
    const groups: Array<[GroupState['type'], string]> = [
      ['HERO', String(row.state.heroId)],
      ['TIME_BUCKET', String(Math.floor(row.state.gameTimeS / 300))],
      ['ITEM_TIER', String(observedCandidate?.tier ?? 'UNKNOWN')],
      ['ECONOMY_BAND', economyBand(row.state.netWorth)],
    ];
    const rawLogLoss = -Math.log(
      Math.max(prediction.observedActionProbability, 1e-15),
    );
    for (const [type, value] of groups) {
      const key = `${type}:${value}`;
      const state = this.groups.get(key) ?? {
        type,
        value,
        decisionCount: 0,
        supportedDecisionCount: 0,
        rawLogLossSum: 0,
      };
      state.decisionCount += 1;
      state.supportedDecisionCount += supported ? 1 : 0;
      state.rawLogLossSum += rawLogLoss;
      this.groups.set(key, state);
    }
  }
}

@Injectable()
export class RecommendationBehavioralV5TrainingService implements OnModuleInit {
  private readonly logger = new Logger(
    RecommendationBehavioralV5TrainingService.name,
  );
  private readonly sourceDirectory =
    process.env.DEADLOCK_RECOMMENDATION_BEHAVIORAL_V5_SOURCE_DIR?.trim() ||
    DEFAULT_SOURCE_DIRECTORY;
  private readonly outputDirectory =
    process.env.DEADLOCK_RECOMMENDATION_BEHAVIORAL_V5_DIR?.trim() ||
    DEFAULT_OUTPUT_DIRECTORY;
  private readonly paths = {
    diagnosticSample: join(this.outputDirectory, DIAGNOSTIC_SAMPLE_FILE_NAME),
    propensities: join(this.outputDirectory, PROPENSITY_FILE_NAME),
    model: join(this.outputDirectory, 'model.json'),
    evaluation: join(this.outputDirectory, 'evaluation.json'),
    audit: join(this.outputDirectory, 'audit.json'),
    manifest: join(this.outputDirectory, 'manifest.json'),
  };
  private status = this.idleStatus();
  private manifest?: Record<string, unknown>;
  private audit?: Record<string, unknown>;
  private evaluation?: Record<string, unknown>;
  private model?: Record<string, unknown>;
  private runPromise: Promise<void> = Promise.resolve();

  async onModuleInit(): Promise<void> {
    await mkdir(this.outputDirectory, { recursive: true });
    this.manifest = await readJson(this.paths.manifest);
    this.audit = await readJson(this.paths.audit);
    this.evaluation = await readJson(this.paths.evaluation);
    this.model = await readJson(this.paths.model);
    if (
      this.manifest &&
      this.audit &&
      this.evaluation &&
      this.model &&
      (await exists(this.paths.propensities))
    ) {
      const source = record(this.audit.source);
      const predictions = record(this.audit.predictions);
      const releaseGate = record(this.evaluation.releaseGate);
      this.status = {
        ...this.idleStatus(),
        state: 'COMPLETE',
        phase: 'COMPLETE',
        sourceRowCount: numberValue(source.scannedRowCount),
        trainEligibleDecisionCount: numberValue(source.trainEligibleDecisionCount),
        tuningEligibleDecisionCount: numberValue(source.tuningEligibleDecisionCount),
        futureTestEligibleDecisionCount: numberValue(
          source.futureTestEligibleDecisionCount,
        ),
        predictionRowCount: numberValue(predictions.rowCount),
        completedAt: textValue(this.manifest.generatedAt),
        modelAvailable: true,
        propensitiesAvailable: true,
        evaluationAvailable: true,
        auditAvailable: true,
        manifestAvailable: true,
        releaseGatePassed: releaseGate.passed === true,
        trainingArtifactEligible:
          record(this.audit).trainingArtifactEligible === true,
      };
    }
  }

  async start(
    request: RecommendationBehavioralV5TrainingStartRequest = {},
  ): Promise<RecommendationBehavioralV5TrainingStatus> {
    if (this.status.state === 'RUNNING') {
      throw new Error('Recommendation Behavioral V5 training is already running.');
    }
    const options = normalizeOptions(request);
    const startedAt = new Date().toISOString();
    this.status = {
      ...this.idleStatus(),
      state: 'RUNNING',
      phase: 'PREPARING',
      currentPass: 0,
      totalPasses: options.foldCount * options.epochs + options.epochs + 1,
      startedAt,
      options,
    };
    this.runPromise = this.run(options, startedAt);
    return this.getStatus();
  }

  async waitForIdle(): Promise<void> {
    await this.runPromise;
  }

  getStatus(): RecommendationBehavioralV5TrainingStatus {
    return clone(this.status);
  }

  getManifest(): Record<string, unknown> | undefined {
    return this.manifest ? clone(this.manifest) : undefined;
  }

  getAudit(): Record<string, unknown> | undefined {
    return this.audit ? clone(this.audit) : undefined;
  }

  getEvaluation(): Record<string, unknown> | undefined {
    return this.evaluation ? clone(this.evaluation) : undefined;
  }

  getModel(): Record<string, unknown> | undefined {
    return this.model ? clone(this.model) : undefined;
  }

  private async run(
    options: RecommendationBehavioralV5TrainingOptions,
    startedAt: string,
  ): Promise<void> {
    try {
      const source = await loadSource(
        this.sourceDirectory,
        options.expectedSourceSha256,
      );
      await this.clearOutputs();
      this.manifest = undefined;
      this.audit = undefined;
      this.evaluation = undefined;
      this.model = undefined;

      const summary = await scanSource(
        source.datasetPath,
        source.rowCount,
        options,
        options.diagnosticMatchModulo === undefined
          ? undefined
          : this.paths.diagnosticSample,
      );
      const iterationDatasetPath =
        options.diagnosticMatchModulo === undefined
          ? source.datasetPath
          : this.paths.diagnosticSample;
      const diagnosticSampleArtifact =
        options.diagnosticMatchModulo === undefined
          ? undefined
          : {
              fileName: DIAGNOSTIC_SAMPLE_FILE_NAME,
              rowCount: summary.diagnosticSampleRowCount,
              byteLength: (await stat(this.paths.diagnosticSample)).size,
              sha256: await hashFile(this.paths.diagnosticSample),
            };
      if (summary.invalidRowCount > 0) {
        throw new Error('Recommendation Dataset V6 contains invalid rows.');
      }
      const completeSourceScan = options.maxRows === undefined;
      if (completeSourceScan && summary.scannedRowCount !== source.rowCount) {
        throw new Error(
          'Recommendation Dataset V6 row count does not match its manifest.',
        );
      }
      if (
        summary.trainMatchIdsByFold.some((matches) => matches.size === 0)
      ) {
        throw new Error(
          'Every Behavioral V5 cross-fitting fold must contain at least one TRAIN match.',
        );
      }
      this.status = {
        ...this.status,
        sourceRowCount: summary.scannedRowCount,
        trainEligibleDecisionCount: summary.eligibleBySplit.TRAIN,
        tuningEligibleDecisionCount: summary.eligibleBySplit.TUNING,
        futureTestEligibleDecisionCount:
          summary.eligibleBySplit.FUTURE_TEST,
      };

      const foldModels: FoldModelArtifact[] = [];
      let currentPass = 0;
      for (let holdoutFoldId = 0; holdoutFoldId < options.foldCount; holdoutFoldId += 1) {
        const model = createRecommendationBehavioralV5Model(
          options.hashDimension,
        );
        for (let epoch = 0; epoch < options.epochs; epoch += 1) {
          currentPass += 1;
          this.status = {
            ...this.status,
            phase: 'TRAINING_FOLDS',
            currentPass,
            currentFold: holdoutFoldId,
            currentEpoch: epoch + 1,
          };
          await eachSourceRow(
            iterationDatasetPath,
            options,
            async (row) => {
              if (
                row.split !== 'TRAIN' ||
                !isBehavioralEligible(row) ||
                recommendationBehavioralV5FoldId(
                  row.matchId,
                  options.foldCount,
                ) === holdoutFoldId
              ) {
                return;
              }
              trainRecommendationBehavioralV5Decision(model, row, options);
            },
          );
          await tick();
        }
        const expectedTrainingDecisions =
          (summary.eligibleBySplit.TRAIN -
            summary.trainDecisionCountByFold[holdoutFoldId]) *
          options.epochs;
        if (model.trainedDecisionCount !== expectedTrainingDecisions) {
          throw new Error(
            `Behavioral V5 fold ${holdoutFoldId} training count mismatch.`,
          );
        }
        foldModels.push({
          holdoutFoldId,
          trainingRule: 'TRAIN_ROWS_EXCLUDING_HOLDOUT_MATCH_FOLD',
          model,
        });
      }

      const finalModel = createRecommendationBehavioralV5Model(
        options.hashDimension,
      );
      for (let epoch = 0; epoch < options.epochs; epoch += 1) {
        currentPass += 1;
        this.status = {
          ...this.status,
          phase: 'TRAINING_FINAL',
          currentPass,
          currentFold: undefined,
          currentEpoch: epoch + 1,
        };
        await eachSourceRow(
          iterationDatasetPath,
          options,
          async (row) => {
            if (row.split === 'TRAIN' && isBehavioralEligible(row)) {
              trainRecommendationBehavioralV5Decision(finalModel, row, options);
            }
          },
        );
        await tick();
      }
      const expectedFinalTrainingDecisions =
        summary.eligibleBySplit.TRAIN * options.epochs;
      if (finalModel.trainedDecisionCount !== expectedFinalTrainingDecisions) {
        throw new Error('Behavioral V5 final model training count mismatch.');
      }

      const generatedAt = new Date().toISOString();
      const modelArtifact = {
        schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION,
        modelVersion: RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,
        featureVersion: RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION,
        generatedAt,
        sourceDatasetVersion: RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION,
        sourceDatasetSha256: source.sha256,
        trainingDataPolicy: {
          trainSplitOnly: true,
          tuningUsedForTraining: false,
          futureTestUsedForTraining: false,
          futureTestEvaluated: options.diagnosticMatchModulo === undefined,
          diagnosticMatchSample:
            options.diagnosticMatchModulo === undefined
              ? undefined
              : {
                  hash: 'FNV1A_32',
                  modulo: options.diagnosticMatchModulo,
                  remainder: options.diagnosticMatchRemainder,
                  artifact: diagnosticSampleArtifact,
                },
          outcomeFieldsUsed: false,
          crossFittingUnit: 'MATCH',
          foldAssignment: 'FNV1A_MATCH_ID_MOD_FOLD_COUNT',
        },
        options,
        foldModels,
        finalModel,
      };
      await atomicJson(this.paths.model, modelArtifact);
      const modelArtifactSha256 = await hashFile(this.paths.model);

      currentPass += 1;
      this.status = {
        ...this.status,
        phase: 'PREDICTING',
        currentPass,
        currentEpoch: undefined,
      };
      let propensityUncompressedByteLength = 0;
      const propensityWriter = await GzipNdjsonWriter.create(
        `${this.paths.propensities}.partial`,
      );
      const evaluationAccumulator = new BehavioralV5EvaluationAccumulator(
        options.supportProbability,
        options.probabilityFloors,
      );
      let predictionRowCount = 0;
      let oofPredictionCount = 0;
      let fullTrainPredictionCount = 0;
      try {
        await eachSourceRow(
          iterationDatasetPath,
          options,
          async (row) => {
            if (!isBehavioralEligible(row)) {
              return;
            }
            const foldId =
              row.split === 'TRAIN'
                ? recommendationBehavioralV5FoldId(
                    row.matchId,
                    options.foldCount,
                  )
                : undefined;
            const model =
              foldId === undefined
                ? finalModel
                : foldModels[foldId].model;
            const rawPrediction = predictRecommendationBehavioralV5(model, row);
            if (rawPrediction.observedActionProbability <= 0) {
              throw new Error('Behavioral V5 prediction lost the observed action.');
            }
            const floorClippedObservedProbability =
              stabilizeRecommendationBehavioralV5ObservedProbability(
                rawPrediction.observedActionProbability,
                options.propensityFloor,
              );
            evaluationAccumulator.observe(
              row,
              rawPrediction,
              floorClippedObservedProbability,
            );
            const propensityRow: RecommendationBehavioralV5PropensityRow = {
              schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION,
              modelVersion: RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,
              featureVersion: RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION,
              decisionId: row.decisionId,
              matchId: row.matchId,
              split: row.split,
              predictionSource:
                foldId === undefined
                  ? 'FULL_TRAIN_MODEL'
                  : 'CROSS_FITTED_OOF',
              foldId,
              trainingMatchExcluded: true,
              observedActionKey: row.observedActionKey,
              observedActionRawProbability:
                rawPrediction.observedActionProbability,
              observedActionProbability:
                rawPrediction.observedActionProbability,
              probabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION',
              supported:
                rawPrediction.observedActionProbability >=
                options.supportProbability,
              propensityFloor: options.propensityFloor,
              propensityFloorApplied: false,
              candidates: rawPrediction.candidates.map((candidate) => ({
                actionKey: candidate.actionKey,
                itemId: candidate.itemId,
                score: candidate.score,
                rawProbability: candidate.probability,
                probability: candidate.probability,
                rank: candidate.rank,
              })),
              modelArtifactSha256,
              sourceDatasetSha256: source.sha256,
            };
            await propensityWriter.write(propensityRow);
            predictionRowCount += 1;
            oofPredictionCount += foldId === undefined ? 0 : 1;
            fullTrainPredictionCount += foldId === undefined ? 1 : 0;
            if (predictionRowCount % 10_000 === 0) {
              this.status = {
                ...this.status,
                predictionRowCount,
              };
              await tick();
            }
          },
        );
        await propensityWriter.close();
        propensityUncompressedByteLength =
          propensityWriter.uncompressedByteLength;
      } catch (error) {
        await propensityWriter.abort();
        throw error;
      }
      await rename(
        `${this.paths.propensities}.partial`,
        this.paths.propensities,
      );
      if (oofPredictionCount !== summary.eligibleBySplit.TRAIN) {
        throw new Error('Behavioral V5 OOF prediction count mismatch.');
      }
      if (
        fullTrainPredictionCount !==
        summary.eligibleBySplit.TUNING +
          summary.eligibleBySplit.FUTURE_TEST
      ) {
        throw new Error('Behavioral V5 full-train prediction count mismatch.');
      }

      this.status = {
        ...this.status,
        phase: 'FINALIZING',
        predictionRowCount,
      };
      const metrics = evaluationAccumulator.finalize(
        options.majorGroupMinDecisions,
      );
      const candidateCoverage = divide(
        summary.candidateCoveredSelectionDecisionCount,
        summary.selectionDecisionCount,
      );
      const majorLowSupportGroups = metrics.groups.filter(
        (group) => group.major && group.supportCoverage < 0.75,
      );
      const releaseReasons: string[] = [];
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
      if (
        metrics.probabilityFloorSensitivity.maximumLogLossDelta > 0.02
      ) {
        releaseReasons.push(
          'Behavioral result is unstable across probability floors.',
        );
      }
      const releaseGate = {
        passed: releaseReasons.length === 0,
        candidateCoverage,
        minimumCandidateCoverage: 0.99,
        behaviorSupportCoverage: metrics.selection.supportCoverage,
        minimumBehaviorSupportCoverage: 0.9,
        minimumMajorGroupSupportCoverage: 0.75,
        majorGroupMinDecisions: options.majorGroupMinDecisions,
        majorLowSupportGroups,
        extremeCandidateProbabilityRate:
          metrics.selection.extremeCandidateProbabilityRate,
        maximumExtremeCandidateProbabilityRate: 0.01,
        probabilityFloorMaximumLogLossDelta:
          metrics.probabilityFloorSensitivity.maximumLogLossDelta,
        maximumProbabilityFloorLogLossDelta: 0.02,
        reasons: releaseReasons,
      };
      const evaluation = {
        schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION,
        modelVersion: RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,
        generatedAt,
        propensityContract: {
          output: 'RAW_SOFTMAX_WITHIN_DECISION',
          candidateProbabilityFloorApplied: false,
          floorSensitivity: 'OBSERVED_PROPENSITY_CLIP_ONLY',
        },
        metrics,
        candidateCoverage,
        releaseGate,
        futureTestPolicy: {
          reported: options.diagnosticMatchModulo === undefined,
          usedForTraining: false,
          usedForCalibration: false,
          usedForReleaseGate: false,
        },
      };
      await atomicJson(this.paths.evaluation, evaluation);

      const structuralReasons: string[] = [];
      const sourceCountMatches =
        options.maxRows === undefined
          ? summary.scannedRowCount === source.rowCount
          : summary.scannedRowCount <= source.rowCount;
      if (!sourceCountMatches) {
        structuralReasons.push('Source row count does not match Dataset V6 manifest.');
      }
      if (summary.invalidRowCount > 0) {
        structuralReasons.push('Dataset V6 contains invalid rows.');
      }
      if (summary.eligibleBySplit.TRAIN === 0) {
        structuralReasons.push('Behavioral V5 has no eligible TRAIN decisions.');
      }
      if (oofPredictionCount !== summary.eligibleBySplit.TRAIN) {
        structuralReasons.push('Cross-fitted OOF predictions are incomplete.');
      }
      if (
        foldModels.some(
          (value) =>
            value.model.trainedDecisionCount !==
            (summary.eligibleBySplit.TRAIN -
              summary.trainDecisionCountByFold[value.holdoutFoldId]) *
              options.epochs,
        )
      ) {
        structuralReasons.push('A cross-fitting model trained on its holdout fold.');
      }
      const fullCorpusEligible =
        options.maxRows === undefined &&
        options.diagnosticMatchModulo === undefined;
      const auditPassed = structuralReasons.length === 0;
      const trainingArtifactEligible =
        auditPassed && releaseGate.passed && fullCorpusEligible;
      const audit = {
        schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION,
        modelVersion: RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,
        generatedAt,
        passed: auditPassed,
        trainingArtifactEligible,
        source: {
          datasetVersion: source.manifest.datasetVersion,
          sourceAuditPassed: source.audit.passed,
          sourceTrainingArtifactEligible:
            source.audit.trainingArtifactEligible,
          expectedSha256:
            options.expectedSourceSha256 ?? source.manifest.artifact.sha256,
          actualSha256: source.sha256,
          expectedRowCount: source.rowCount,
          scannedRowCount: summary.scannedRowCount,
          invalidRowCount: summary.invalidRowCount,
          trainEligibleDecisionCount: summary.eligibleBySplit.TRAIN,
          tuningEligibleDecisionCount: summary.eligibleBySplit.TUNING,
          futureTestEligibleDecisionCount:
            summary.eligibleBySplit.FUTURE_TEST,
          trainIneligibleDecisionCount: summary.ineligibleBySplit.TRAIN,
          tuningIneligibleDecisionCount: summary.ineligibleBySplit.TUNING,
          futureTestIneligibleDecisionCount:
            summary.ineligibleBySplit.FUTURE_TEST,
        },
        crossFitting: {
          unit: 'MATCH',
          foldCount: options.foldCount,
          foldMatchCounts: summary.trainMatchIdsByFold.map(
            (matches) => matches.size,
          ),
          foldDecisionCounts: summary.trainDecisionCountByFold,
          oofPredictionCount,
          trainingMatchExclusionVerified: true,
          futureTestUsedForTraining: false,
          tuningUsedForTraining: false,
        },
        predictions: {
          fileName: PROPENSITY_FILE_NAME,
          rowCount: predictionRowCount,
          oofPredictionCount,
          fullTrainPredictionCount,
          probabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION',
          propensityFloorApplied: false,
          sha256: await hashFile(this.paths.propensities),
        },
        releaseGate,
        build: {
          fullCorpus: fullCorpusEligible,
          diagnosticMaxRows: options.maxRows,
          diagnosticMatchSample:
            options.diagnosticMatchModulo === undefined
              ? undefined
              : {
                  unit: 'MATCH',
                  hash: 'FNV1A_32',
                  modulo: options.diagnosticMatchModulo,
                  remainder: options.diagnosticMatchRemainder,
                  futureTestEvaluated: false,
                  artifact: diagnosticSampleArtifact,
                },
        },
        reasons: structuralReasons,
      };
      await atomicJson(this.paths.audit, audit);

      const manifest = {
        schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION,
        modelVersion: RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,
        featureVersion: RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION,
        generatedAt,
        source: {
          datasetVersion: source.manifest.datasetVersion,
          directory: this.sourceDirectory,
          fileName: DATASET_FILE_NAME,
          sha256: source.sha256,
          byteLength: source.byteLength,
          rowCount: source.rowCount,
          splitDescriptor: source.manifest.splitDescriptor,
        },
        trainingContract: {
          input: 'STATE_PLUS_CANDIDATE',
          target: 'OBSERVED_ACTION_WITHIN_CANDIDATE_SET',
          normalization: 'SOFTMAX_WITHIN_DECISION',
          propensityOutput: 'RAW_SOFTMAX_WITHIN_DECISION',
          candidateProbabilityFloorApplied: false,
          ipsClippingApplied: false,
          probabilityFloorSensitivity: 'OBSERVED_PROPENSITY_CLIP_ONLY',
          crossFittingUnit: 'MATCH',
          trainSplitOnly: true,
          outcomeFieldsUsed: false,
          tuningUsedForTraining: false,
          futureTestUsedForTraining: false,
        },
        options,
        artifacts: {
          model: {
            fileName: 'model.json',
            sha256: modelArtifactSha256,
            byteLength: (await stat(this.paths.model)).size,
          },
          propensities: {
            fileName: PROPENSITY_FILE_NAME,
            format: 'NDJSON',
            compression: 'GZIP',
            sha256: audit.predictions.sha256,
            byteLength: (await stat(this.paths.propensities)).size,
            uncompressedByteLength: propensityUncompressedByteLength,
            rowCount: predictionRowCount,
          },
          evaluation: {
            fileName: 'evaluation.json',
            sha256: await hashFile(this.paths.evaluation),
          },
          audit: {
            fileName: 'audit.json',
            sha256: await hashFile(this.paths.audit),
          },
        },
        releaseGatePassed: releaseGate.passed,
        auditPassed,
        trainingArtifactEligible,
      };
      await atomicJson(this.paths.manifest, manifest);
      this.manifest = manifest;
      this.audit = audit;
      this.evaluation = evaluation;
      this.model = modelArtifact;
      this.status = {
        ...this.status,
        state: 'COMPLETE',
        phase: 'COMPLETE',
        completedAt: generatedAt,
        predictionRowCount,
        modelAvailable: true,
        propensitiesAvailable: true,
        evaluationAvailable: true,
        auditAvailable: true,
        manifestAvailable: true,
        releaseGatePassed: releaseGate.passed,
        trainingArtifactEligible,
      };
      this.logger.log(
        `Recommendation Behavioral V5 completed with ${predictionRowCount} ` +
          `propensity rows; release gate ${releaseGate.passed ? 'PASS' : 'FAIL'}.`,
      );
    } catch (error) {
      const message = errorMessage(error);
      this.status = {
        ...this.status,
        state: 'FAILED',
        completedAt: new Date().toISOString(),
        error: message,
      };
      this.logger.error(`Recommendation Behavioral V5 failed: ${message}`);
    }
  }

  private async clearOutputs(): Promise<void> {
    await Promise.all([
      rm(this.paths.diagnosticSample, { force: true }),
      rm(`${this.paths.diagnosticSample}.partial`, { force: true }),
      rm(this.paths.propensities, { force: true }),
      rm(`${this.paths.propensities}.partial`, { force: true }),
      rm(this.paths.model, { force: true }),
      rm(this.paths.evaluation, { force: true }),
      rm(this.paths.audit, { force: true }),
      rm(this.paths.manifest, { force: true }),
    ]);
  }

  private idleStatus(): RecommendationBehavioralV5TrainingStatus {
    return {
      state: 'IDLE',
      phase: 'PREPARING',
      currentPass: 0,
      totalPasses: 0,
      sourceRowCount: 0,
      trainEligibleDecisionCount: 0,
      tuningEligibleDecisionCount: 0,
      futureTestEligibleDecisionCount: 0,
      predictionRowCount: 0,
      outputDirectory: this.outputDirectory,
      modelAvailable: false,
      propensitiesAvailable: false,
      evaluationAvailable: false,
      auditAvailable: false,
      manifestAvailable: false,
    };
  }
}

async function loadSource(
  directory: string,
  expectedSha256: string | undefined,
): Promise<LoadedSource> {
  const manifest = await requiredJson<RecommendationProDecisionDatasetV6ArtifactManifest>(
    join(directory, 'manifest.json'),
  );
  const audit = await requiredJson<RecommendationProDecisionDatasetV6ArtifactAudit>(
    join(directory, 'audit.json'),
  );
  if (
    manifest.schemaVersion !==
      RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION ||
    manifest.datasetVersion !== RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION ||
    manifest.auditPassed !== true ||
    manifest.trainingArtifactEligible !== true ||
    audit.passed !== true ||
    audit.trainingArtifactEligible !== true ||
    manifest.featureContract.userLiveUsedAsInput !== false ||
    manifest.featureContract.futureTestEligibleForSelection !== false
  ) {
    throw new Error('Recommendation Dataset V6 is not eligible for Behavioral V5.');
  }
  const datasetPath = join(directory, manifest.artifact.fileName);
  const sha256 = await hashFile(datasetPath);
  if (sha256 !== manifest.artifact.sha256) {
    throw new Error('Recommendation Dataset V6 SHA-256 mismatch.');
  }
  if (expectedSha256 && expectedSha256 !== sha256) {
    throw new Error(
      `Source SHA-256 mismatch: expected ${expectedSha256}, received ${sha256}.`,
    );
  }
  return {
    manifest,
    audit,
    datasetPath,
    sha256,
    byteLength: (await stat(datasetPath)).size,
    rowCount: manifest.artifact.rowCount,
  };
}

async function scanSource(
  datasetPath: string,
  expectedRowCount: number,
  options: RecommendationBehavioralV5TrainingOptions,
  diagnosticSamplePath?: string,
): Promise<SourceSummary> {
  const summary: SourceSummary = {
    scannedRowCount: 0,
    diagnosticSampleRowCount: 0,
    invalidRowCount: 0,
    candidateCoveredSelectionDecisionCount: 0,
    selectionDecisionCount: 0,
    eligibleBySplit: { TRAIN: 0, TUNING: 0, FUTURE_TEST: 0 },
    ineligibleBySplit: { TRAIN: 0, TUNING: 0, FUTURE_TEST: 0 },
    trainMatchIdsByFold: Array.from(
      { length: options.foldCount },
      () => new Set<string>(),
    ),
    trainDecisionCountByFold: Array.from(
      { length: options.foldCount },
      () => 0,
    ),
  };
  const sampleWriter = diagnosticSamplePath
    ? await GzipNdjsonWriter.create(`${diagnosticSamplePath}.partial`)
    : undefined;
  try {
    for await (const value of ndjson(datasetPath)) {
      if (
        options.maxRows !== undefined &&
        summary.scannedRowCount >= options.maxRows
      ) {
        break;
      }
      summary.scannedRowCount += 1;
      let row: RecommendationProDecisionDatasetV6Row;
      try {
        row = sourceRow(value, summary.scannedRowCount);
      } catch {
        summary.invalidRowCount += 1;
        continue;
      }
      if (!behavioralRowSelected(row, options)) {
        continue;
      }
      if (sampleWriter) {
        await sampleWriter.write(row);
        summary.diagnosticSampleRowCount += 1;
      }
      if (row.split !== 'FUTURE_TEST') {
        summary.selectionDecisionCount += 1;
        summary.candidateCoveredSelectionDecisionCount +=
          row.observedActionInCandidateSet ? 1 : 0;
      }
      if (isBehavioralEligible(row)) {
        summary.eligibleBySplit[row.split] += 1;
        if (row.split === 'TRAIN') {
          const foldId = recommendationBehavioralV5FoldId(
            row.matchId,
            options.foldCount,
          );
          summary.trainMatchIdsByFold[foldId].add(row.matchId);
          summary.trainDecisionCountByFold[foldId] += 1;
        }
      } else {
        summary.ineligibleBySplit[row.split] += 1;
      }
    }
    if (sampleWriter && diagnosticSamplePath) {
      await sampleWriter.close();
      await rename(`${diagnosticSamplePath}.partial`, diagnosticSamplePath);
    }
  } catch (error) {
    if (sampleWriter) {
      await sampleWriter.abort();
    }
    throw error;
  }
  if (options.maxRows === undefined && summary.scannedRowCount !== expectedRowCount) {
    throw new Error('Recommendation Dataset V6 source row count mismatch.');
  }
  return summary;
}

async function eachSourceRow(
  path: string,
  options: RecommendationBehavioralV5TrainingOptions,
  callback: (row: RecommendationProDecisionDatasetV6Row) => Promise<void>,
): Promise<void> {
  let count = 0;
  for await (const value of ndjson(path)) {
    if (options.maxRows !== undefined && count >= options.maxRows) {
      break;
    }
    count += 1;
    const row = sourceRow(value, count);
    if (!behavioralRowSelected(row, options)) {
      continue;
    }
    await callback(row);
    if (count % 10_000 === 0) {
      await tick();
    }
  }
}

function behavioralRowSelected(
  row: RecommendationProDecisionDatasetV6Row,
  options: RecommendationBehavioralV5TrainingOptions,
): boolean {
  if (options.diagnosticMatchModulo === undefined) {
    return true;
  }
  if (row.split === 'FUTURE_TEST') {
    return false;
  }
  return recommendationBehavioralV5DiagnosticMatchSelected(
    row.matchId,
    options.diagnosticMatchModulo,
    options.diagnosticMatchRemainder ?? 0,
  );
}

function sourceRow(
  value: unknown,
  line: number,
): RecommendationProDecisionDatasetV6Row {
  if (
    !isRecord(value) ||
    value.schemaVersion !==
      RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION ||
    value.datasetVersion !== RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION ||
    value.dataSource !== 'PRO_HISTORICAL' ||
    typeof value.decisionId !== 'string' ||
    typeof value.matchId !== 'string' ||
    !['TRAIN', 'TUNING', 'FUTURE_TEST'].includes(String(value.split)) ||
    !Array.isArray(value.candidates) ||
    !isRecord(value.state) ||
    !isRecord(value.eligibility)
  ) {
    throw new Error(`Invalid Recommendation Dataset V6 row at line ${line}.`);
  }
  return value as unknown as RecommendationProDecisionDatasetV6Row;
}

function isBehavioralEligible(
  row: RecommendationProDecisionDatasetV6Row,
): boolean {
  return (
    row.eligibility.behavioralModel &&
    row.observedActionInCandidateSet &&
    row.candidates.length >= 2 &&
    row.candidates.every(
      (candidate) => candidate.catalogMetadataAvailable,
    )
  );
}

function emptyMetricsState(): MetricsState {
  return {
    decisionCount: 0,
    candidateCount: 0,
    coveredDecisionCount: 0,
    supportedDecisionCount: 0,
    top1Count: 0,
    rawLogLossSum: 0,
    floorClippedObservedLogLossSum: 0,
    rawBrierSum: 0,
    entropySum: 0,
    observedRawProbabilitySum: 0,
    observedProbabilitySum: 0,
    minimumObservedRawProbability: Number.POSITIVE_INFINITY,
    maximumCandidateProbability: 0,
    extremeCandidateProbabilityCount: 0,
    calibrationBins: Array.from(
      { length: CALIBRATION_BIN_COUNT },
      () => ({ candidateCount: 0, probabilitySum: 0, positiveCount: 0 }),
    ),
  };
}

function finalizeMetrics(state: MetricsState) {
  const calibrationBins = state.calibrationBins.map((bin, index) => ({
    index,
    lowerBound: index / CALIBRATION_BIN_COUNT,
    upperBound: (index + 1) / CALIBRATION_BIN_COUNT,
    candidateCount: bin.candidateCount,
    meanProbability: divide(bin.probabilitySum, bin.candidateCount),
    observedFrequency: divide(bin.positiveCount, bin.candidateCount),
  }));
  const expectedCalibrationError = calibrationBins.reduce(
    (sum, bin) =>
      sum +
      divide(bin.candidateCount, state.candidateCount) *
        Math.abs(bin.meanProbability - bin.observedFrequency),
    0,
  );
  return {
    decisionCount: state.decisionCount,
    candidateCount: state.candidateCount,
    candidateCoverage: divide(
      state.coveredDecisionCount,
      state.decisionCount,
    ),
    supportCoverage: divide(
      state.supportedDecisionCount,
      state.decisionCount,
    ),
    top1Rate: divide(state.top1Count, state.decisionCount),
    rawLogLoss: divide(state.rawLogLossSum, state.decisionCount),
    floorClippedObservedLogLoss: divide(
      state.floorClippedObservedLogLossSum,
      state.decisionCount,
    ),
    rawBrierScore: divide(state.rawBrierSum, state.decisionCount),
    meanEntropy: divide(state.entropySum, state.decisionCount),
    meanObservedRawProbability: divide(
      state.observedRawProbabilitySum,
      state.decisionCount,
    ),
    meanObservedProbability: divide(
      state.observedProbabilitySum,
      state.decisionCount,
    ),
    minimumObservedRawProbability:
      state.decisionCount === 0 ? 0 : state.minimumObservedRawProbability,
    maximumCandidateProbability: state.maximumCandidateProbability,
    extremeCandidateProbabilityRate: divide(
      state.extremeCandidateProbabilityCount,
      state.candidateCount,
    ),
    calibration: {
      binCount: CALIBRATION_BIN_COUNT,
      expectedCalibrationError,
      bins: calibrationBins,
    },
  };
}

function economyBand(netWorth: number | undefined): string {
  if (netWorth === undefined || !Number.isFinite(netWorth)) {
    return 'UNKNOWN';
  }
  if (netWorth < 5_000) {
    return 'LT_5000';
  }
  if (netWorth < 10_000) {
    return '5000_9999';
  }
  if (netWorth < 20_000) {
    return '10000_19999';
  }
  return 'GE_20000';
}

function normalizeOptions(
  request: RecommendationBehavioralV5TrainingStartRequest,
): RecommendationBehavioralV5TrainingOptions {
  const maxRows = optionalPositiveInteger(request.maxRows, 'maxRows');
  const diagnosticMatchModulo = optionalPositiveInteger(
    request.diagnosticMatchModulo,
    'diagnosticMatchModulo',
  );
  let diagnosticMatchRemainder = optionalNonNegativeInteger(
    request.diagnosticMatchRemainder,
    'diagnosticMatchRemainder',
  );
  if (maxRows !== undefined && diagnosticMatchModulo !== undefined) {
    throw new Error(
      'Behavioral V5 maxRows and diagnostic match sampling are mutually exclusive.',
    );
  }
  if (diagnosticMatchModulo !== undefined) {
    if (diagnosticMatchModulo < 2 || diagnosticMatchModulo > 10_000) {
      throw new Error(
        'diagnosticMatchModulo must be between 2 and 10000.',
      );
    }
    diagnosticMatchRemainder ??= 0;
    if (diagnosticMatchRemainder >= diagnosticMatchModulo) {
      throw new Error(
        'diagnosticMatchRemainder must be smaller than diagnosticMatchModulo.',
      );
    }
  } else if (diagnosticMatchRemainder !== undefined) {
    throw new Error(
      'diagnosticMatchRemainder requires diagnosticMatchModulo.',
    );
  }
  return {
    foldCount: boundedInteger(request.foldCount, 5, 2, 10, 'foldCount'),
    epochs: boundedInteger(request.epochs, 3, 1, 20, 'epochs'),
    learningRate: boundedNumber(
      request.learningRate,
      0.2,
      0.0001,
      10,
      'learningRate',
    ),
    l2: boundedNumber(request.l2, 0.0001, 0, 1, 'l2'),
    hashDimension: boundedInteger(
      request.hashDimension,
      8_192,
      256,
      262_144,
      'hashDimension',
    ),
    propensityFloor: boundedNumber(
      request.propensityFloor,
      0.01,
      0,
      0.2,
      'propensityFloor',
    ),
    probabilityFloors: [0.005, 0.01, 0.02],
    supportProbability: boundedNumber(
      request.supportProbability,
      0.01,
      0,
      1,
      'supportProbability',
    ),
    majorGroupMinDecisions: boundedInteger(
      request.majorGroupMinDecisions,
      100,
      1,
      1_000_000,
      'majorGroupMinDecisions',
    ),
    expectedSourceSha256: optionalSha(
      request.expectedSourceSha256,
      'expectedSourceSha256',
    ),
    maxRows,
    diagnosticMatchModulo,
    diagnosticMatchRemainder,
  };
}

async function* ndjson(path: string): AsyncGenerator<unknown> {
  const lines = createInterface({
    input: await openMaybeGzipNdjsonReadStream(path),
    crlfDelay: Infinity,
  });
  let line = 0;
  for await (const value of lines) {
    line += 1;
    if (!value.trim()) {
      continue;
    }
    try {
      yield JSON.parse(value) as unknown;
    } catch {
      throw new Error(`Invalid JSON in ${path} at line ${line}.`);
    }
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const partial = `${path}.partial`;
  await writeFile(
    partial,
    `${JSON.stringify(value, undefined, 2)}\n`,
    'utf8',
  );
  await rename(partial, path);
}

async function readJson<T = Record<string, unknown>>(
  path: string,
): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

async function requiredJson<T>(path: string): Promise<T> {
  const value = await readJson<T>(path);
  if (!value) {
    throw new Error(`Required JSON artifact is unavailable at ${path}.`);
  }
  return value;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function optionalSha(value: string | undefined, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a SHA-256 value.`);
  }
  return normalized;
}

function optionalPositiveInteger(
  value: number | undefined,
  label: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function optionalNonNegativeInteger(
  value: number | undefined,
  label: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return result;
}

function boundedNumber(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return result;
}

function divide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function numberValue(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
