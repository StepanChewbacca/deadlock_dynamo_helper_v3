import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { openMaybeGzipNdjsonReadStream } from './gzip-ndjson';
import type { RecommendationBehavioralV5PropensityRow } from './recommendation-behavioral-v5-training.service';
import {
  RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,
  RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION,
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
import {
  buildRecommendationValueV8DiagnosticGate,
  createRecommendationValueV8ActionModel,
  createRecommendationValueV8DiagnosticMetricsAccumulator,
  createRecommendationValueV8StateModel,
  DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS,
  finalizeRecommendationValueV8DiagnosticMetrics,
  observeRecommendationValueV8DiagnosticDecision,
  permuteRecommendationValueV8CandidateMetadata,
  permuteRecommendationValueV8CandidatePayloads,
  predictRecommendationValueV8CandidateSet,
  predictRecommendationValueV8State,
  recommendationValueV8FoldId,
  recommendationValueV8Targets,
  RECOMMENDATION_VALUE_V8_ACTION_MODEL_VERSION,
  RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
  RECOMMENDATION_VALUE_V8_FEATURE_VERSION,
  RECOMMENDATION_VALUE_V8_HORIZONS,
  RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION,
  trainRecommendationValueV8ActionDecision,
  trainRecommendationValueV8StateDecision,
  type RecommendationValueV8ActionModel,
  type RecommendationValueV8DiagnosticThresholds,
  type RecommendationValueV8HorizonValues,
  type RecommendationValueV8StateModel,
} from './recommendation-value-v8-diagnostic';

const DEFAULT_DATASET_DIRECTORY =
  '/app/apps/api/storage/recommendation-pro-decision-dataset-v6-1';
const DEFAULT_BEHAVIORAL_DIRECTORY =
  '/app/apps/api/storage/recommendation-behavioral-v5-1';
const DEFAULT_OUTPUT_DIRECTORY =
  '/app/apps/api/storage/recommendation-value-v8-diagnostic-1';
const DATASET_FILE_NAME = 'dataset.ndjson';
const PROPENSITY_FILE_NAME = 'propensities.ndjson';
const STATE_OOF_FILE_NAME = 'state-oof.ndjson';
const DIAGNOSTIC_PREDICTION_FILE_NAME = 'diagnostic-predictions.ndjson';

export interface RecommendationValueV8DiagnosticTrainingStartRequest {
  foldCount?: number;
  stateEpochs?: number;
  actionEpochs?: number;
  stateLearningRate?: number;
  actionLearningRate?: number;
  stateL2?: number;
  actionL2?: number;
  hashDimension?: number;
  propensityFloor?: number;
  maximumImportanceWeight?: number;
  maximumAbsolutePrediction?: number;
  maximumAbsoluteResidual?: number;
  maxRows?: number;
  expectedDatasetSha256?: string;
  expectedBehavioralPropensitySha256?: string;
  thresholds?: Partial<RecommendationValueV8DiagnosticThresholds>;
}

export interface RecommendationValueV8DiagnosticTrainingOptions {
  foldCount: number;
  stateEpochs: number;
  actionEpochs: number;
  stateLearningRate: number;
  actionLearningRate: number;
  stateL2: number;
  actionL2: number;
  hashDimension: number;
  propensityFloor: number;
  maximumImportanceWeight: number;
  maximumAbsolutePrediction: number;
  maximumAbsoluteResidual: number;
  maxRows: number;
  expectedDatasetSha256?: string;
  expectedBehavioralPropensitySha256?: string;
  thresholds: RecommendationValueV8DiagnosticThresholds;
}

export interface RecommendationValueV8DiagnosticTrainingStatus {
  state: 'IDLE' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  phase:
    | 'PREPARING'
    | 'TRAINING_STATE_FOLDS'
    | 'TRAINING_STATE_FINAL'
    | 'TRAINING_ACTION'
    | 'WRITING_OOF'
    | 'EVALUATING'
    | 'FINALIZING'
    | 'COMPLETE';
  currentPass: number;
  totalPasses: number;
  trainDecisionCount: number;
  tuningDecisionCount: number;
  futureTestDecisionCount: number;
  propensityJoinCount: number;
  outputDirectory: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  options?: RecommendationValueV8DiagnosticTrainingOptions;
  modelAvailable: boolean;
  stateOofAvailable: boolean;
  predictionsAvailable: boolean;
  evaluationAvailable: boolean;
  auditAvailable: boolean;
  manifestAvailable: boolean;
  diagnosticGatePassed?: boolean;
  fullTrainingRecommended?: boolean;
}

interface LoadedDataset {
  manifest: RecommendationProDecisionDatasetV6ArtifactManifest;
  audit: RecommendationProDecisionDatasetV6ArtifactAudit;
  datasetPath: string;
  sha256: string;
  byteLength: number;
}

interface LoadedBehavioral {
  manifest: Record<string, unknown>;
  audit: Record<string, unknown>;
  evaluation: Record<string, unknown>;
  propensityPath: string;
  propensitySha256: string;
  propensityByteLength: number;
}

interface DiagnosticRows {
  train: RecommendationProDecisionDatasetV6Row[];
  tuning: RecommendationProDecisionDatasetV6Row[];
  futureTestDecisionCount: number;
  scannedRowCount: number;
  invalidRowCount: number;
  excludedRowCount: number;
  trainMatchIdsByFold: Array<Set<string>>;
}

interface PropensityJoin {
  byDecisionId: Map<string, RecommendationBehavioralV5PropensityRow>;
  scannedRowCount: number;
  invalidRowCount: number;
}

interface OofStateRow {
  schemaVersion: typeof RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION;
  stateModelVersion: typeof RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION;
  decisionId: string;
  matchId: string;
  foldId: number;
  trainingMatchExcluded: true;
  targets: RecommendationValueV8HorizonValues;
  statePredictions: RecommendationValueV8HorizonValues;
  residualTargets: RecommendationValueV8HorizonValues;
  observedActionProbability: number;
  behavioralPredictionSource: 'CROSS_FITTED_OOF';
}

@Injectable()
export class RecommendationValueV8DiagnosticTrainingService
  implements OnModuleInit
{
  private readonly logger = new Logger(
    RecommendationValueV8DiagnosticTrainingService.name,
  );
  private readonly datasetDirectory =
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_DATASET_DIR?.trim() ||
    DEFAULT_DATASET_DIRECTORY;
  private readonly behavioralDirectory =
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_BEHAVIORAL_DIR?.trim() ||
    DEFAULT_BEHAVIORAL_DIRECTORY;
  private readonly outputDirectory =
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_DIR?.trim() ||
    DEFAULT_OUTPUT_DIRECTORY;
  private readonly paths = {
    model: join(this.outputDirectory, 'model.json'),
    stateOof: join(this.outputDirectory, STATE_OOF_FILE_NAME),
    predictions: join(
      this.outputDirectory,
      DIAGNOSTIC_PREDICTION_FILE_NAME,
    ),
    evaluation: join(this.outputDirectory, 'evaluation.json'),
    audit: join(this.outputDirectory, 'audit.json'),
    manifest: join(this.outputDirectory, 'manifest.json'),
  };
  private status = this.idleStatus();
  private model?: Record<string, unknown>;
  private evaluation?: Record<string, unknown>;
  private audit?: Record<string, unknown>;
  private manifest?: Record<string, unknown>;
  private runPromise: Promise<void> = Promise.resolve();

  async onModuleInit(): Promise<void> {
    await mkdir(this.outputDirectory, { recursive: true });
    this.model = await readJson(this.paths.model);
    this.evaluation = await readJson(this.paths.evaluation);
    this.audit = await readJson(this.paths.audit);
    this.manifest = await readJson(this.paths.manifest);
    if (
      this.model &&
      this.evaluation &&
      this.audit &&
      this.manifest &&
      (await exists(this.paths.stateOof)) &&
      (await exists(this.paths.predictions))
    ) {
      const source = record(this.audit.source);
      const gate = record(this.evaluation.diagnosticGate);
      this.status = {
        ...this.idleStatus(),
        state: 'COMPLETE',
        phase: 'COMPLETE',
        trainDecisionCount: numberValue(source.trainDecisionCount),
        tuningDecisionCount: numberValue(source.tuningDecisionCount),
        futureTestDecisionCount: numberValue(source.futureTestDecisionCount),
        propensityJoinCount: numberValue(source.propensityJoinCount),
        completedAt: textValue(this.manifest.generatedAt),
        modelAvailable: true,
        stateOofAvailable: true,
        predictionsAvailable: true,
        evaluationAvailable: true,
        auditAvailable: true,
        manifestAvailable: true,
        diagnosticGatePassed: gate.passed === true,
        fullTrainingRecommended: gate.fullTrainingRecommended === true,
      };
    }
  }

  async start(
    request: RecommendationValueV8DiagnosticTrainingStartRequest = {},
  ): Promise<RecommendationValueV8DiagnosticTrainingStatus> {
    if (this.status.state === 'RUNNING') {
      throw new Error('Recommendation Value V8 diagnostic is already running.');
    }
    const options = normalizeOptions(request);
    const startedAt = new Date().toISOString();
    this.status = {
      ...this.idleStatus(),
      state: 'RUNNING',
      phase: 'PREPARING',
      totalPasses:
        options.stateEpochs * 2 + options.actionEpochs + 3,
      startedAt,
      options,
    };
    this.runPromise = this.run(options, startedAt);
    return this.getStatus();
  }

  async waitForIdle(): Promise<void> {
    await this.runPromise;
  }

  getStatus(): RecommendationValueV8DiagnosticTrainingStatus {
    return clone(this.status);
  }

  getModel(): Record<string, unknown> | undefined {
    return this.model ? clone(this.model) : undefined;
  }

  getEvaluation(): Record<string, unknown> | undefined {
    return this.evaluation ? clone(this.evaluation) : undefined;
  }

  getAudit(): Record<string, unknown> | undefined {
    return this.audit ? clone(this.audit) : undefined;
  }

  getManifest(): Record<string, unknown> | undefined {
    return this.manifest ? clone(this.manifest) : undefined;
  }

  private async run(
    options: RecommendationValueV8DiagnosticTrainingOptions,
    startedAt: string,
  ): Promise<void> {
    try {
      const dataset = await loadDataset(
        this.datasetDirectory,
        options.expectedDatasetSha256,
      );
      const behavioral = await loadBehavioral(
        this.behavioralDirectory,
        dataset.sha256,
        options.expectedBehavioralPropensitySha256,
      );
      await this.clearOutputs();
      this.model = undefined;
      this.evaluation = undefined;
      this.audit = undefined;
      this.manifest = undefined;

      const rows = await loadDiagnosticRows(
        dataset.datasetPath,
        options.maxRows,
        options.foldCount,
      );
      if (rows.invalidRowCount > 0) {
        throw new Error('Recommendation Dataset V6 contains invalid diagnostic rows.');
      }
      if (rows.train.length === 0 || rows.tuning.length === 0) {
        throw new Error('Value V8 diagnostic requires TRAIN and TUNING rows.');
      }
      if (rows.trainMatchIdsByFold.some((matches) => matches.size === 0)) {
        throw new Error('Every Value V8 state cross-fitting fold needs a TRAIN match.');
      }
      const selectedDecisionIds = new Set(
        [...rows.train, ...rows.tuning].map((row) => row.decisionId),
      );
      const propensities = await loadPropensities(
        behavioral.propensityPath,
        selectedDecisionIds,
      );
      validatePropensityJoins(
        rows,
        propensities.byDecisionId,
        dataset.sha256,
        options.foldCount,
      );
      this.status = {
        ...this.status,
        trainDecisionCount: rows.train.length,
        tuningDecisionCount: rows.tuning.length,
        futureTestDecisionCount: rows.futureTestDecisionCount,
        propensityJoinCount: propensities.byDecisionId.size,
      };

      let currentPass = 0;
      const foldStateModels = Array.from(
        { length: options.foldCount },
        () => createRecommendationValueV8StateModel(options.hashDimension),
      );
      for (let epoch = 0; epoch < options.stateEpochs; epoch += 1) {
        currentPass += 1;
        this.status = {
          ...this.status,
          phase: 'TRAINING_STATE_FOLDS',
          currentPass,
        };
        for (const row of rows.train) {
          const holdoutFoldId = recommendationValueV8FoldId(
            row.matchId,
            options.foldCount,
          );
          for (let foldId = 0; foldId < foldStateModels.length; foldId += 1) {
            if (foldId !== holdoutFoldId) {
              trainRecommendationValueV8StateDecision(
                foldStateModels[foldId],
                row,
                stateOptions(options),
              );
            }
          }
        }
        await tick();
      }

      const finalStateModel = createRecommendationValueV8StateModel(
        options.hashDimension,
      );
      for (let epoch = 0; epoch < options.stateEpochs; epoch += 1) {
        currentPass += 1;
        this.status = {
          ...this.status,
          phase: 'TRAINING_STATE_FINAL',
          currentPass,
        };
        for (const row of rows.train) {
          trainRecommendationValueV8StateDecision(
            finalStateModel,
            row,
            stateOptions(options),
          );
        }
        await tick();
      }

      const actionModel = createRecommendationValueV8ActionModel(
        options.hashDimension,
      );
      for (let epoch = 0; epoch < options.actionEpochs; epoch += 1) {
        currentPass += 1;
        this.status = {
          ...this.status,
          phase: 'TRAINING_ACTION',
          currentPass,
        };
        for (const row of rows.train) {
          const foldId = recommendationValueV8FoldId(
            row.matchId,
            options.foldCount,
          );
          const statePredictions = predictRecommendationValueV8State(
            foldStateModels[foldId],
            row,
            options.maximumAbsolutePrediction,
          );
          const propensity = propensities.byDecisionId.get(row.decisionId);
          if (!propensity) {
            throw new Error(`Missing Behavioral V5 propensity for ${row.decisionId}.`);
          }
          trainRecommendationValueV8ActionDecision(
            actionModel,
            row,
            statePredictions,
            propensity.observedActionProbability,
            actionOptions(options),
          );
        }
        await tick();
      }

      currentPass += 1;
      this.status = {
        ...this.status,
        phase: 'WRITING_OOF',
        currentPass,
      };
      const oofWriter = await LineWriter.create(`${this.paths.stateOof}.partial`);
      try {
        for (const row of rows.train) {
          const foldId = recommendationValueV8FoldId(
            row.matchId,
            options.foldCount,
          );
          const statePredictions = predictRecommendationValueV8State(
            foldStateModels[foldId],
            row,
            options.maximumAbsolutePrediction,
          );
          const propensity = propensities.byDecisionId.get(row.decisionId);
          if (!propensity) {
            throw new Error(`Missing Behavioral V5 propensity for ${row.decisionId}.`);
          }
          const targets = recommendationValueV8Targets(row);
          const residualTargets = subtractHorizons(targets, statePredictions);
          const oofRow: OofStateRow = {
            schemaVersion: RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
            stateModelVersion: RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION,
            decisionId: row.decisionId,
            matchId: row.matchId,
            foldId,
            trainingMatchExcluded: true,
            targets,
            statePredictions,
            residualTargets,
            observedActionProbability: propensity.observedActionProbability,
            behavioralPredictionSource: 'CROSS_FITTED_OOF',
          };
          await oofWriter.write(oofRow);
        }
        await oofWriter.close();
        await promote(this.paths.stateOof);
      } catch (error) {
        await oofWriter.abort();
        throw error;
      }

      currentPass += 1;
      this.status = {
        ...this.status,
        phase: 'EVALUATING',
        currentPass,
      };
      const accumulator =
        createRecommendationValueV8DiagnosticMetricsAccumulator();
      const predictionWriter = await LineWriter.create(
        `${this.paths.predictions}.partial`,
      );
      try {
        for (const row of rows.tuning) {
          const statePredictions = predictRecommendationValueV8State(
            finalStateModel,
            row,
            options.maximumAbsolutePrediction,
          );
          const candidatePrediction = predictRecommendationValueV8CandidateSet(
            actionModel,
            row,
            row.candidates,
            options.maximumAbsoluteResidual,
          );
          const candidatePermutationPrediction =
            predictRecommendationValueV8CandidateSet(
              actionModel,
              row,
              permuteRecommendationValueV8CandidatePayloads(row.candidates),
              options.maximumAbsoluteResidual,
            );
          const metadataPermutationPrediction =
            predictRecommendationValueV8CandidateSet(
              actionModel,
              row,
              permuteRecommendationValueV8CandidateMetadata(row.candidates),
              options.maximumAbsoluteResidual,
            );
          observeRecommendationValueV8DiagnosticDecision({
            accumulator,
            row,
            statePredictions,
            candidatePrediction,
            candidatePermutationPrediction,
            metadataPermutationPrediction,
            sensitivityThreshold:
              options.thresholds.minimumAverageCandidateSeparation,
          });
          await predictionWriter.write({
            schemaVersion: RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
            decisionId: row.decisionId,
            matchId: row.matchId,
            split: row.split,
            targets: recommendationValueV8Targets(row),
            statePredictions,
            observedActionKey: row.observedActionKey,
            candidatePrediction,
            candidatePermutationPrediction,
            metadataPermutationPrediction,
            futureTestUsed: false,
          });
        }
        await predictionWriter.close();
        await promote(this.paths.predictions);
      } catch (error) {
        await predictionWriter.abort();
        throw error;
      }

      const metrics = finalizeRecommendationValueV8DiagnosticMetrics(accumulator);
      const diagnosticGate = buildRecommendationValueV8DiagnosticGate(
        metrics,
        options.thresholds,
      );
      const generatedAt = new Date().toISOString();
      const modelArtifact = {
        schemaVersion: RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
        generatedAt,
        featureVersion: RECOMMENDATION_VALUE_V8_FEATURE_VERSION,
        sourceDatasetSha256: dataset.sha256,
        behavioralPropensitySha256: behavioral.propensitySha256,
        diagnosticOnly: true,
        trainingContract: {
          stateInput: 'STATE_ONLY',
          stateTargets: [...RECOMMENDATION_VALUE_V8_HORIZONS],
          stateCrossFittingUnit: 'MATCH',
          actionInput: 'STATE_PLUS_OBSERVED_CANDIDATE',
          actionTarget: 'SHORT_HORIZON_OUTCOME_MINUS_OOF_STATE_PREDICTION',
          actionObservedCandidateOnly: true,
          candidateCentering: 'SUBTRACT_DECISION_CANDIDATE_MEAN',
          behavioralWeighting: 'STABILIZED_INVERSE_PROPENSITY',
          tuningUsedForTraining: false,
          futureTestUsedForTraining: false,
          futureTestUsedForSelection: false,
        },
        options,
        foldStateModels,
        finalStateModel,
        actionModel,
      };
      await atomicJson(this.paths.model, modelArtifact);

      const meanImportanceWeight = divide(
        actionModel.totalImportanceWeight,
        actionModel.trainedDecisionCount,
      );
      const clippedImportanceWeightRate = divide(
        actionModel.clippedImportanceWeightCount,
        actionModel.trainedDecisionCount,
      );
      const evaluation = {
        schemaVersion: RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
        generatedAt,
        diagnosticSplit: 'TUNING',
        metrics,
        importanceWeights: {
          mean: meanImportanceWeight,
          maximum: options.maximumImportanceWeight,
          clippedDecisionCount: actionModel.clippedImportanceWeightCount,
          clippedRate: clippedImportanceWeightRate,
        },
        diagnosticGate,
        futureTest: {
          usedForTraining: false,
          usedForSelection: false,
          evaluated: false,
        },
      };
      await atomicJson(this.paths.evaluation, evaluation);

      currentPass += 1;
      this.status = {
        ...this.status,
        phase: 'FINALIZING',
        currentPass,
      };
      const structuralReasons: string[] = [];
      if (rows.excludedRowCount > 0) {
        structuralReasons.push(
          `${rows.excludedRowCount} rows were excluded as Value V8 ineligible.`,
        );
      }
      if (propensities.invalidRowCount > 0) {
        structuralReasons.push('Behavioral V5 propensity artifact has invalid rows.');
      }
      const structuralPassed = propensities.invalidRowCount === 0;
      const audit = {
        schemaVersion: RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
        generatedAt,
        passed: structuralPassed,
        diagnosticArtifactEligible: structuralPassed,
        fullTrainingRecommended:
          structuralPassed && diagnosticGate.fullTrainingRecommended,
        source: {
          datasetVersion: dataset.manifest.datasetVersion,
          datasetAuditPassed: dataset.audit.passed,
          datasetTrainingArtifactEligible:
            dataset.audit.trainingArtifactEligible,
          datasetSha256: dataset.sha256,
          behavioralModelVersion: RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,
          behavioralAuditPassed: record(behavioral.audit).passed === true,
          behavioralTrainingArtifactEligible:
            record(behavioral.audit).trainingArtifactEligible === true,
          behavioralPropensitySha256: behavioral.propensitySha256,
          scannedDatasetRowCount: rows.scannedRowCount,
          trainDecisionCount: rows.train.length,
          tuningDecisionCount: rows.tuning.length,
          futureTestDecisionCount: rows.futureTestDecisionCount,
          invalidDatasetRowCount: rows.invalidRowCount,
          excludedRowCount: rows.excludedRowCount,
          propensityJoinCount: propensities.byDecisionId.size,
        },
        crossFitting: {
          unit: 'MATCH',
          foldCount: options.foldCount,
          foldMatchCounts: rows.trainMatchIdsByFold.map(
            (matches) => matches.size,
          ),
          trainingMatchExclusionVerified: true,
          stateOofRowCount: rows.train.length,
        },
        leakage: {
          stateModelCandidateFeaturesUsed: false,
          actionModelObservedCandidateOnly: true,
          tuningUsedForTraining: false,
          futureTestUsedForTraining: false,
          futureTestUsedForSelection: false,
          finalOutcomeUsedForTraining: false,
        },
        build: {
          diagnosticOnly: true,
          maxRows: options.maxRows,
          fullCorpus: false,
        },
        diagnosticGate,
        reasons: structuralReasons,
      };
      await atomicJson(this.paths.audit, audit);

      const manifest = {
        schemaVersion: RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
        generatedAt,
        diagnosticVersion: 'RECOMMENDATION_VALUE_V8_DIAGNOSTIC_1',
        stateModelVersion: RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION,
        actionModelVersion: RECOMMENDATION_VALUE_V8_ACTION_MODEL_VERSION,
        featureVersion: RECOMMENDATION_VALUE_V8_FEATURE_VERSION,
        source: {
          dataset: {
            directory: this.datasetDirectory,
            fileName: DATASET_FILE_NAME,
            version: dataset.manifest.datasetVersion,
            sha256: dataset.sha256,
            byteLength: dataset.byteLength,
            splitDescriptor: dataset.manifest.splitDescriptor,
          },
          behavioral: {
            directory: this.behavioralDirectory,
            fileName: PROPENSITY_FILE_NAME,
            modelVersion: RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,
            sha256: behavioral.propensitySha256,
            byteLength: behavioral.propensityByteLength,
          },
        },
        artifacts: {
          model: artifactDescriptor(this.paths.model),
          stateOof: artifactDescriptor(this.paths.stateOof, rows.train.length),
          predictions: artifactDescriptor(
            this.paths.predictions,
            rows.tuning.length,
          ),
          evaluation: artifactDescriptor(this.paths.evaluation),
          audit: artifactDescriptor(this.paths.audit),
        },
        diagnosticOnly: true,
        futureTestUsed: false,
        auditPassed: structuralPassed,
        diagnosticGatePassed: diagnosticGate.passed,
        fullTrainingRecommended:
          structuralPassed && diagnosticGate.fullTrainingRecommended,
      };
      const resolvedManifest = {
        ...manifest,
        artifacts: {
          model: await manifest.artifacts.model,
          stateOof: await manifest.artifacts.stateOof,
          predictions: await manifest.artifacts.predictions,
          evaluation: await manifest.artifacts.evaluation,
          audit: await manifest.artifacts.audit,
        },
      };
      await atomicJson(this.paths.manifest, resolvedManifest);
      this.model = modelArtifact;
      this.evaluation = evaluation;
      this.audit = audit;
      this.manifest = resolvedManifest;
      this.status = {
        ...this.status,
        state: 'COMPLETE',
        phase: 'COMPLETE',
        completedAt: generatedAt,
        modelAvailable: true,
        stateOofAvailable: true,
        predictionsAvailable: true,
        evaluationAvailable: true,
        auditAvailable: true,
        manifestAvailable: true,
        diagnosticGatePassed: diagnosticGate.passed,
        fullTrainingRecommended:
          structuralPassed && diagnosticGate.fullTrainingRecommended,
      };
      this.logger.log(
        `Recommendation Value V8 diagnostic completed with ` +
          `${rows.train.length} TRAIN and ${rows.tuning.length} TUNING rows; ` +
          `gate ${diagnosticGate.passed ? 'PASS' : 'FAIL'}.`,
      );
    } catch (error) {
      const message = errorMessage(error);
      this.status = {
        ...this.status,
        state: 'FAILED',
        completedAt: new Date().toISOString(),
        error: message,
      };
      this.logger.error(`Recommendation Value V8 diagnostic failed: ${message}`);
    }
  }

  private async clearOutputs(): Promise<void> {
    await Promise.all([
      rm(this.paths.model, { force: true }),
      rm(this.paths.stateOof, { force: true }),
      rm(`${this.paths.stateOof}.partial`, { force: true }),
      rm(this.paths.predictions, { force: true }),
      rm(`${this.paths.predictions}.partial`, { force: true }),
      rm(this.paths.evaluation, { force: true }),
      rm(this.paths.audit, { force: true }),
      rm(this.paths.manifest, { force: true }),
    ]);
  }

  private idleStatus(): RecommendationValueV8DiagnosticTrainingStatus {
    return {
      state: 'IDLE',
      phase: 'PREPARING',
      currentPass: 0,
      totalPasses: 0,
      trainDecisionCount: 0,
      tuningDecisionCount: 0,
      futureTestDecisionCount: 0,
      propensityJoinCount: 0,
      outputDirectory: this.outputDirectory,
      modelAvailable: false,
      stateOofAvailable: false,
      predictionsAvailable: false,
      evaluationAvailable: false,
      auditAvailable: false,
      manifestAvailable: false,
    };
  }
}

async function loadDataset(
  directory: string,
  expectedSha256: string | undefined,
): Promise<LoadedDataset> {
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
    manifest.featureContract.futureTestEligibleForSelection !== false ||
    manifest.featureContract.userLiveUsedAsInput !== false
  ) {
    throw new Error('Recommendation Dataset V6 is not eligible for Value V8.');
  }
  const datasetPath = join(directory, manifest.artifact.fileName);
  const sha256 = await hashFile(datasetPath);
  if (sha256 !== manifest.artifact.sha256) {
    throw new Error('Recommendation Dataset V6 SHA-256 mismatch.');
  }
  if (expectedSha256 && expectedSha256 !== sha256) {
    throw new Error(
      `Dataset SHA-256 mismatch: expected ${expectedSha256}, received ${sha256}.`,
    );
  }
  return {
    manifest,
    audit,
    datasetPath,
    sha256,
    byteLength: (await stat(datasetPath)).size,
  };
}

async function loadBehavioral(
  directory: string,
  datasetSha256: string,
  expectedPropensitySha256: string | undefined,
): Promise<LoadedBehavioral> {
  const manifest = await requiredJson<Record<string, unknown>>(
    join(directory, 'manifest.json'),
  );
  const audit = await requiredJson<Record<string, unknown>>(
    join(directory, 'audit.json'),
  );
  const evaluation = await requiredJson<Record<string, unknown>>(
    join(directory, 'evaluation.json'),
  );
  if (
    manifest.schemaVersion !== RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION ||
    manifest.modelVersion !== RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION ||
    manifest.auditPassed !== true ||
    manifest.releaseGatePassed !== true ||
    manifest.trainingArtifactEligible !== true ||
    audit.passed !== true ||
    audit.trainingArtifactEligible !== true ||
    record(evaluation.releaseGate).passed !== true
  ) {
    throw new Error('Recommendation Behavioral V5 is not eligible for Value V8.');
  }
  const source = record(manifest.source);
  if (source.sha256 !== datasetSha256) {
    throw new Error('Behavioral V5 source Dataset V6 SHA-256 mismatch.');
  }
  const artifacts = record(manifest.artifacts);
  const propensityArtifact = record(artifacts.propensities);
  const fileName = textValue(propensityArtifact.fileName) || PROPENSITY_FILE_NAME;
  const propensityPath = join(directory, fileName);
  const propensitySha256 = await hashFile(propensityPath);
  if (propensitySha256 !== textValue(propensityArtifact.sha256)) {
    throw new Error('Behavioral V5 propensity SHA-256 mismatch.');
  }
  if (
    expectedPropensitySha256 &&
    expectedPropensitySha256 !== propensitySha256
  ) {
    throw new Error(
      `Behavioral propensity SHA-256 mismatch: expected ` +
        `${expectedPropensitySha256}, received ${propensitySha256}.`,
    );
  }
  return {
    manifest,
    audit,
    evaluation,
    propensityPath,
    propensitySha256,
    propensityByteLength: (await stat(propensityPath)).size,
  };
}

async function loadDiagnosticRows(
  path: string,
  maxRows: number,
  foldCount: number,
): Promise<DiagnosticRows> {
  const trainLimit = Math.max(foldCount * 2, Math.floor(maxRows * 0.8));
  const tuningLimit = Math.max(1, maxRows - trainLimit);
  const result: DiagnosticRows = {
    train: [],
    tuning: [],
    futureTestDecisionCount: 0,
    scannedRowCount: 0,
    invalidRowCount: 0,
    excludedRowCount: 0,
    trainMatchIdsByFold: Array.from(
      { length: foldCount },
      () => new Set<string>(),
    ),
  };
  for await (const value of ndjson(path)) {
    result.scannedRowCount += 1;
    let row: RecommendationProDecisionDatasetV6Row;
    try {
      row = datasetRow(value, result.scannedRowCount);
    } catch {
      result.invalidRowCount += 1;
      continue;
    }
    if (row.split === 'FUTURE_TEST') {
      result.futureTestDecisionCount += 1;
      continue;
    }
    if (!isValueV8Eligible(row)) {
      result.excludedRowCount += 1;
      continue;
    }
    if (row.split === 'TRAIN' && result.train.length < trainLimit) {
      result.train.push(row);
      const foldId = recommendationValueV8FoldId(row.matchId, foldCount);
      result.trainMatchIdsByFold[foldId].add(row.matchId);
    } else if (row.split === 'TUNING' && result.tuning.length < tuningLimit) {
      result.tuning.push(row);
    }
  }
  return result;
}

async function loadPropensities(
  path: string,
  selectedDecisionIds: ReadonlySet<string>,
): Promise<PropensityJoin> {
  const result: PropensityJoin = {
    byDecisionId: new Map(),
    scannedRowCount: 0,
    invalidRowCount: 0,
  };
  for await (const value of ndjson(path)) {
    result.scannedRowCount += 1;
    let row: RecommendationBehavioralV5PropensityRow;
    try {
      row = propensityRow(value, result.scannedRowCount);
    } catch {
      result.invalidRowCount += 1;
      continue;
    }
    if (!selectedDecisionIds.has(row.decisionId)) {
      continue;
    }
    if (result.byDecisionId.has(row.decisionId)) {
      throw new Error(`Duplicate Behavioral V5 propensity ${row.decisionId}.`);
    }
    result.byDecisionId.set(row.decisionId, row);
  }
  return result;
}

function validatePropensityJoins(
  rows: DiagnosticRows,
  byDecisionId: ReadonlyMap<string, RecommendationBehavioralV5PropensityRow>,
  datasetSha256: string,
  foldCount: number,
): void {
  for (const row of [...rows.train, ...rows.tuning]) {
    const propensity = byDecisionId.get(row.decisionId);
    if (!propensity) {
      throw new Error(`Missing Behavioral V5 propensity ${row.decisionId}.`);
    }
    if (
      propensity.matchId !== row.matchId ||
      propensity.split !== row.split ||
      propensity.sourceDatasetSha256 !== datasetSha256 ||
      propensity.trainingMatchExcluded !== true ||
      propensity.observedActionKey !== row.observedActionKey ||
      propensity.probabilityContract !== 'RAW_SOFTMAX_WITHIN_DECISION' ||
      propensity.propensityFloorApplied !== false ||
      !Number.isFinite(propensity.observedActionRawProbability) ||
      propensity.observedActionRawProbability <= 0 ||
      !Number.isFinite(propensity.observedActionProbability) ||
      propensity.observedActionProbability <= 0 ||
      Math.abs(
        propensity.observedActionProbability -
          propensity.observedActionRawProbability,
      ) > 1e-12 ||
      !isRawSoftmaxCandidateDistribution(propensity)
    ) {
      throw new Error(`Invalid Behavioral V5 propensity join ${row.decisionId}.`);
    }
    if (row.split === 'TRAIN') {
      const foldId = recommendationValueV8FoldId(row.matchId, foldCount);
      if (
        propensity.predictionSource !== 'CROSS_FITTED_OOF' ||
        propensity.foldId !== foldId
      ) {
        throw new Error(
          `Behavioral V5 TRAIN propensity is not matching OOF for ${row.decisionId}.`,
        );
      }
    } else if (propensity.predictionSource !== 'FULL_TRAIN_MODEL') {
      throw new Error(
        `Behavioral V5 TUNING propensity is not from full TRAIN for ${row.decisionId}.`,
      );
    }
  }
}

function isRawSoftmaxCandidateDistribution(
  propensity: RecommendationBehavioralV5PropensityRow,
): boolean {
  if (propensity.candidates.length < 2) {
    return false;
  }
  let total = 0;
  for (const candidate of propensity.candidates) {
    if (
      !Number.isFinite(candidate.rawProbability) ||
      candidate.rawProbability <= 0 ||
      !Number.isFinite(candidate.probability) ||
      candidate.probability <= 0 ||
      Math.abs(candidate.probability - candidate.rawProbability) > 1e-12
    ) {
      return false;
    }
    total += candidate.probability;
  }
  return Math.abs(total - 1) <= 1e-9;
}

function datasetRow(
  value: unknown,
  line: number,
): RecommendationProDecisionDatasetV6Row {
  if (
    !isRecord(value) ||
    value.schemaVersion !== RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION ||
    value.datasetVersion !== RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION ||
    value.dataSource !== 'PRO_HISTORICAL' ||
    typeof value.decisionId !== 'string' ||
    typeof value.matchId !== 'string' ||
    !['TRAIN', 'TUNING', 'FUTURE_TEST'].includes(String(value.split)) ||
    !isRecord(value.state) ||
    !Array.isArray(value.candidates) ||
    !isRecord(value.eligibility)
  ) {
    throw new Error(`Invalid Recommendation Dataset V6 row at line ${line}.`);
  }
  return value as unknown as RecommendationProDecisionDatasetV6Row;
}

function propensityRow(
  value: unknown,
  line: number,
): RecommendationBehavioralV5PropensityRow {
  if (
    !isRecord(value) ||
    value.schemaVersion !== RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION ||
    value.modelVersion !== RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION ||
    typeof value.decisionId !== 'string' ||
    typeof value.matchId !== 'string' ||
    !['TRAIN', 'TUNING', 'FUTURE_TEST'].includes(String(value.split)) ||
    !['CROSS_FITTED_OOF', 'FULL_TRAIN_MODEL'].includes(
      String(value.predictionSource),
    ) ||
    !Array.isArray(value.candidates)
  ) {
    throw new Error(`Invalid Behavioral V5 propensity row at line ${line}.`);
  }
  return value as unknown as RecommendationBehavioralV5PropensityRow;
}

function isValueV8Eligible(row: RecommendationProDecisionDatasetV6Row): boolean {
  return (
    row.eligibility.stateModel &&
    row.eligibility.actionModel &&
    row.observedActionInCandidateSet &&
    row.candidates.length >= 2 &&
    row.candidates.every(
      (candidate) => candidate.catalogMetadataAvailable,
    ) &&
    Object.keys(recommendationValueV8Targets(row)).length > 0
  );
}

function stateOptions(options: RecommendationValueV8DiagnosticTrainingOptions) {
  return {
    learningRate: options.stateLearningRate,
    l2: options.stateL2,
    maximumAbsolutePrediction: options.maximumAbsolutePrediction,
  };
}

function actionOptions(options: RecommendationValueV8DiagnosticTrainingOptions) {
  return {
    learningRate: options.actionLearningRate,
    l2: options.actionL2,
    maximumAbsoluteResidual: options.maximumAbsoluteResidual,
    propensityFloor: options.propensityFloor,
    maximumImportanceWeight: options.maximumImportanceWeight,
  };
}

function subtractHorizons(
  targets: RecommendationValueV8HorizonValues,
  predictions: RecommendationValueV8HorizonValues,
): RecommendationValueV8HorizonValues {
  return Object.fromEntries(
    RECOMMENDATION_VALUE_V8_HORIZONS.flatMap((horizon) => {
      const target = targets[horizon];
      const prediction = predictions[horizon];
      return target === undefined || prediction === undefined
        ? []
        : [[horizon, target - prediction]];
    }),
  ) as RecommendationValueV8HorizonValues;
}

function normalizeOptions(
  request: RecommendationValueV8DiagnosticTrainingStartRequest,
): RecommendationValueV8DiagnosticTrainingOptions {
  const maxRows = boundedInteger(request.maxRows, 10_000, 100, 50_000, 'maxRows');
  return {
    foldCount: boundedInteger(request.foldCount, 5, 2, 10, 'foldCount'),
    stateEpochs: boundedInteger(request.stateEpochs, 3, 1, 20, 'stateEpochs'),
    actionEpochs: boundedInteger(request.actionEpochs, 5, 1, 30, 'actionEpochs'),
    stateLearningRate: boundedNumber(
      request.stateLearningRate,
      0.03,
      0.000001,
      1,
      'stateLearningRate',
    ),
    actionLearningRate: boundedNumber(
      request.actionLearningRate,
      0.02,
      0.000001,
      1,
      'actionLearningRate',
    ),
    stateL2: boundedNumber(request.stateL2, 0.0001, 0, 1, 'stateL2'),
    actionL2: boundedNumber(request.actionL2, 0.0001, 0, 1, 'actionL2'),
    hashDimension: boundedInteger(
      request.hashDimension,
      4_096,
      256,
      65_536,
      'hashDimension',
    ),
    propensityFloor: boundedNumber(
      request.propensityFloor,
      0.01,
      0.000001,
      0.5,
      'propensityFloor',
    ),
    maximumImportanceWeight: boundedNumber(
      request.maximumImportanceWeight,
      20,
      1,
      1_000,
      'maximumImportanceWeight',
    ),
    maximumAbsolutePrediction: boundedNumber(
      request.maximumAbsolutePrediction,
      1,
      0.01,
      10,
      'maximumAbsolutePrediction',
    ),
    maximumAbsoluteResidual: boundedNumber(
      request.maximumAbsoluteResidual,
      1,
      0.01,
      10,
      'maximumAbsoluteResidual',
    ),
    maxRows,
    expectedDatasetSha256: optionalSha(
      request.expectedDatasetSha256,
      'expectedDatasetSha256',
    ),
    expectedBehavioralPropensitySha256: optionalSha(
      request.expectedBehavioralPropensitySha256,
      'expectedBehavioralPropensitySha256',
    ),
    thresholds: {
      minimumTuningDecisionCount: boundedInteger(
        request.thresholds?.minimumTuningDecisionCount,
        DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS.minimumTuningDecisionCount,
        1,
        maxRows,
        'minimumTuningDecisionCount',
      ),
      minimumStateRmseImprovement: boundedNumber(
        request.thresholds?.minimumStateRmseImprovement,
        DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS.minimumStateRmseImprovement,
        0,
        10,
        'minimumStateRmseImprovement',
      ),
      minimumCandidateSensitiveDecisionRate: boundedNumber(
        request.thresholds?.minimumCandidateSensitiveDecisionRate,
        DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS.minimumCandidateSensitiveDecisionRate,
        0,
        1,
        'minimumCandidateSensitiveDecisionRate',
      ),
      minimumAverageCandidateSeparation: boundedNumber(
        request.thresholds?.minimumAverageCandidateSeparation,
        DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS.minimumAverageCandidateSeparation,
        0,
        10,
        'minimumAverageCandidateSeparation',
      ),
      minimumCandidatePermutationRmseIncrease: boundedNumber(
        request.thresholds?.minimumCandidatePermutationRmseIncrease,
        DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS.minimumCandidatePermutationRmseIncrease,
        0,
        10,
        'minimumCandidatePermutationRmseIncrease',
      ),
      minimumMetadataPermutationRmseIncrease: boundedNumber(
        request.thresholds?.minimumMetadataPermutationRmseIncrease,
        DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS.minimumMetadataPermutationRmseIncrease,
        0,
        10,
        'minimumMetadataPermutationRmseIncrease',
      ),
      maximumAbsoluteCenteredMean: boundedNumber(
        request.thresholds?.maximumAbsoluteCenteredMean,
        DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS.maximumAbsoluteCenteredMean,
        0,
        1,
        'maximumAbsoluteCenteredMean',
      ),
    },
  };
}

async function artifactDescriptor(path: string, rowCount?: number) {
  return {
    fileName: path.split('/').pop() as string,
    sha256: await hashFile(path),
    byteLength: (await stat(path)).size,
    ...(rowCount === undefined ? {} : { rowCount }),
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

async function promote(path: string): Promise<void> {
  await rm(path, { force: true });
  await rename(`${path}.partial`, path);
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < minimum ||
    resolved > maximum
  ) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return resolved;
}

function boundedNumber(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return resolved;
}

function optionalSha(value: string | undefined, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${name} must be a SHA-256 hex string.`);
  }
  return value.toLowerCase();
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function divide(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : numerator / denominator;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

class LineWriter {
  private buffer = '';
  private closed = false;

  private constructor(
    private readonly handle: FileHandle,
    private readonly path: string,
  ) {}

  static async create(path: string): Promise<LineWriter> {
    await mkdir(dirname(path), { recursive: true });
    return new LineWriter(await open(path, 'w'), path);
  }

  async write(value: unknown): Promise<void> {
    if (this.closed) {
      throw new Error(`LineWriter is closed for ${this.path}.`);
    }
    this.buffer += `${JSON.stringify(value)}\n`;
    if (this.buffer.length >= 1024 * 1024) {
      await this.flush();
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    await this.flush();
    await this.handle.close();
    this.closed = true;
  }

  async abort(): Promise<void> {
    if (!this.closed) {
      await this.handle.close();
      this.closed = true;
    }
    await rm(this.path, { force: true });
  }

  private async flush(): Promise<void> {
    if (!this.buffer) {
      return;
    }
    await this.handle.write(this.buffer);
    this.buffer = '';
  }
}
