import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RecommendationBehavioralV5PropensityRow } from '../src/deadlock-live/recommendation-behavioral-v5-training.service';
import {
  RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION,
  RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,
  RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION,
} from '../src/deadlock-live/recommendation-behavioral-v5';
import type {
  RecommendationDatasetV6CandidateFeatures,
  RecommendationDatasetV6Split,
  RecommendationProDecisionDatasetV6Row,
} from '../src/deadlock-live/recommendation-pro-decision-dataset-v6';
import { RecommendationValueV8DiagnosticTrainingService } from '../src/deadlock-live/recommendation-value-v8-diagnostic-training.service';
import {
  recommendationValueV8FoldId,
  RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
} from '../src/deadlock-live/recommendation-value-v8-diagnostic';

const DATASET_ENV = 'DEADLOCK_RECOMMENDATION_VALUE_V8_DATASET_DIR';
const BEHAVIORAL_ENV = 'DEADLOCK_RECOMMENDATION_VALUE_V8_BEHAVIORAL_DIR';
const OUTPUT_ENV = 'DEADLOCK_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_DIR';

describe('Recommendation Value V8 diagnostic training service', () => {
  let root: string;
  let previousDataset: string | undefined;
  let previousBehavioral: string | undefined;
  let previousOutput: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'recommendation-value-v8-diagnostic-'));
    previousDataset = process.env[DATASET_ENV];
    previousBehavioral = process.env[BEHAVIORAL_ENV];
    previousOutput = process.env[OUTPUT_ENV];
  });

  afterEach(async () => {
    restoreEnvironment(DATASET_ENV, previousDataset);
    restoreEnvironment(BEHAVIORAL_ENV, previousBehavioral);
    restoreEnvironment(OUTPUT_ENV, previousOutput);
    await rm(root, { recursive: true, force: true });
  });

  it('builds OOF state residuals and passes the synthetic diagnostic gate', async () => {
    const datasetDirectory = join(root, 'dataset');
    const behavioralDirectory = join(root, 'behavioral');
    const outputDirectory = join(root, 'output');
    await Promise.all([
      mkdir(datasetDirectory, { recursive: true }),
      mkdir(behavioralDirectory, { recursive: true }),
    ]);

    const rows = syntheticRows();
    const datasetSha256 = await writeDatasetArtifact(datasetDirectory, rows);
    await writeBehavioralArtifact(
      behavioralDirectory,
      rows,
      datasetSha256,
      2,
    );
    process.env[DATASET_ENV] = datasetDirectory;
    process.env[BEHAVIORAL_ENV] = behavioralDirectory;
    process.env[OUTPUT_ENV] = outputDirectory;

    const service = new RecommendationValueV8DiagnosticTrainingService();
    await service.onModuleInit();
    await service.start({
      foldCount: 2,
      stateEpochs: 3,
      actionEpochs: 18,
      stateLearningRate: 0.03,
      actionLearningRate: 0.08,
      stateL2: 0.0001,
      actionL2: 0.0001,
      hashDimension: 1_024,
      propensityFloor: 0.01,
      maximumImportanceWeight: 10,
      maxRows: 100,
      expectedDatasetSha256: datasetSha256,
      thresholds: {
        minimumTuningDecisionCount: 8,
        minimumStateRmseImprovement: 0,
        minimumCandidateSensitiveDecisionRate: 0.75,
        minimumAverageCandidateSeparation: 0.001,
        minimumCandidatePermutationRmseIncrease: 0,
        minimumMetadataPermutationRmseIncrease: 0,
        maximumAbsoluteCenteredMean: 1e-9,
      },
    });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'COMPLETE',
      phase: 'COMPLETE',
      trainDecisionCount: 24,
      tuningDecisionCount: 12,
      futureTestDecisionCount: 4,
      propensityJoinCount: 36,
      modelAvailable: true,
      stateOofAvailable: true,
      predictionsAvailable: true,
      evaluationAvailable: true,
      auditAvailable: true,
      manifestAvailable: true,
      diagnosticGatePassed: true,
      fullTrainingRecommended: true,
    });

    const evaluation = service.getEvaluation() as Record<string, unknown>;
    const metrics = evaluation.metrics as Record<string, number>;
    const gate = evaluation.diagnosticGate as Record<string, unknown>;
    expect(metrics.actionRmse).toBeLessThan(metrics.stateRmse);
    expect(metrics.candidatePermutationRmse).toBeGreaterThan(
      metrics.actionRmse,
    );
    expect(metrics.metadataPermutationRmse).toBeGreaterThan(
      metrics.actionRmse,
    );
    expect(gate).toMatchObject({
      passed: true,
      fullTrainingRecommended: true,
    });

    const audit = service.getAudit() as Record<string, unknown>;
    expect(audit).toMatchObject({
      passed: true,
      diagnosticArtifactEligible: true,
      fullTrainingRecommended: true,
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
        maxRows: 100,
        fullCorpus: false,
      },
    });

    const stateOof = await readNdjson(
      join(outputDirectory, 'state-oof.ndjson'),
    );
    expect(stateOof).toHaveLength(24);
    expect(stateOof.every((value) => value.trainingMatchExcluded === true)).toBe(
      true,
    );
    expect(
      stateOof.every(
        (value) => value.behavioralPredictionSource === 'CROSS_FITTED_OOF',
      ),
    ).toBe(true);

    const manifest = service.getManifest() as Record<string, unknown>;
    expect(manifest).toMatchObject({
      diagnosticOnly: true,
      futureTestUsed: false,
      auditPassed: true,
      diagnosticGatePassed: true,
      fullTrainingRecommended: true,
    });
  });
});

function syntheticRows(): RecommendationProDecisionDatasetV6Row[] {
  const rows: RecommendationProDecisionDatasetV6Row[] = [];
  for (let index = 0; index < 24; index += 1) {
    const observedGood = index % 2 === 0;
    rows.push(
      decisionRow({
        decisionId: `train-${index}`,
        matchId: trainMatchId(index, 2),
        split: 'TRAIN',
        observedGood,
        goodItemId: 100,
        badItemId: 200,
        matchStartTime: `2026-06-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
  }
  for (let index = 0; index < 12; index += 1) {
    const observedGood = index % 2 === 0;
    rows.push(
      decisionRow({
        decisionId: `tuning-${index}`,
        matchId: `tuning-match-${index}`,
        split: 'TUNING',
        observedGood,
        goodItemId: 300,
        badItemId: 400,
        matchStartTime: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
  }
  for (let index = 0; index < 4; index += 1) {
    rows.push(
      decisionRow({
        decisionId: `future-${index}`,
        matchId: `future-match-${index}`,
        split: 'FUTURE_TEST',
        observedGood: index % 2 === 0,
        goodItemId: 500,
        badItemId: 600,
        matchStartTime: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
  }
  return rows;
}

function trainMatchId(index: number, foldCount: number): string {
  for (let candidate = index; candidate < index + 10_000; candidate += 1) {
    const value = `train-match-${candidate}`;
    if (recommendationValueV8FoldId(value, foldCount) === index % foldCount) {
      return value;
    }
  }
  throw new Error('Unable to create a deterministic fold-balanced match ID.');
}

function decisionRow(input: {
  decisionId: string;
  matchId: string;
  split: RecommendationDatasetV6Split;
  observedGood: boolean;
  goodItemId: number;
  badItemId: number;
  matchStartTime: string;
}): RecommendationProDecisionDatasetV6Row {
  const goodActionKey = `BUY:${input.goodItemId}`;
  const badActionKey = `BUY:${input.badItemId}`;
  const outcome = input.observedGood ? 0.8 : -0.8;
  return {
    schemaVersion: 1,
    datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2',
    dataSource: 'PRO_HISTORICAL',
    decisionSource: 'HISTORICAL_REPLAY',
    decisionId: input.decisionId,
    matchId: input.matchId,
    matchStartTime: input.matchStartTime,
    playerId: input.decisionId,
    split: input.split,
    state: {
      heroId: 1,
      team: 0,
      phase: 'MID',
      gameTimeS: 900,
      inventoryStateKey: '50x1',
      inventoryItemCounts: [{ itemId: 50, count: 1 }],
      previousActionKeys: ['BUY:50'],
      alliedHeroIds: [1, 2, 3, 4, 5, 6],
      enemyHeroIds: [7, 8, 9, 10, 11, 12],
      inventoryTagCounts: { WEAPON: 1 },
      timelineJoined: true,
      timelineSnapshotLagS: 1,
      kills: 2,
      deaths: 2,
      assists: 4,
      netWorth: 8_000,
      heroDamage: 5_000,
      health: 900,
      maxHealth: 1_000,
      level: 10,
    },
    candidates: [
      candidate(input.goodItemId, 'GOOD_VALUE', 3, 3_000, 2, 0),
      candidate(input.badItemId, 'BAD_VALUE', 1, 500, 0, 2),
    ],
    observedActionKey: input.observedGood ? goodActionKey : badActionKey,
    observedActionInCandidateSet: true,
    shortHorizonOutcomes: {
      threeMinutes: outcome,
      fiveMinutes: outcome,
      tenMinutes: outcome,
    },
    finalOutcome: input.observedGood ? 1 : 0,
    versions: {
      catalog: 'catalog-1',
      catalogSha256: 'a'.repeat(64),
      candidateGenerator: 'generator-1',
      candidateGeneratorPolicy: 'policy-1',
      candidateGeneratorPolicySha256: 'b'.repeat(64),
      stateFeatures: 'RECOMMENDATION_STATE_FEATURES_V6_2_FUTURE_TIMELINE_FALLBACK',
      replay: 'RECOMMENDATION_HISTORICAL_PRO_REPLAY_2',
    },
    eligibility: {
      stateModel: true,
      behavioralModel: true,
      actionModel: true,
      exclusionReasons: [],
    },
  };
}

function candidate(
  itemId: number,
  valueTag: string,
  tier: number,
  cost: number,
  ownedComponentCount: number,
  missingComponentCount: number,
): RecommendationDatasetV6CandidateFeatures {
  return {
    actionKey: `BUY:${itemId}`,
    actionType: 'BUY',
    itemId,
    rank: 1,
    generatorScore: 0.5,
    historicalCount: 50,
    historicalProbability: 0.5,
    confidence: 0.8,
    predictedStateKey: `50x1|${itemId}x1`,
    catalogMetadataAvailable: true,
    cost,
    tier,
    slotType: 'WEAPON',
    itemType: 'UPGRADE',
    isActiveItem: false,
    activationType: 'PASSIVE',
    tags: ['WEAPON', valueTag],
    componentItemIds: [50, 51],
    requiredComponentCount: 2,
    ownedComponentCount,
    missingComponentCount,
    hasAnyOwnedComponent: ownedComponentCount > 0,
    hasCompleteRecipeComponents: missingComponentCount === 0,
    alreadyOwnedCount: 0,
    sameSlotOwnedItemCount: 1,
    inventoryTagOverlapCount: valueTag === 'GOOD_VALUE' ? 1 : 0,
    previousActionCount: 0,
    currentNetWorth: 8_000,
    costToNetWorthRatio: cost / 8_000,
  };
}

async function writeDatasetArtifact(
  directory: string,
  rows: RecommendationProDecisionDatasetV6Row[],
): Promise<string> {
  const dataset = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
  const datasetSha256 = sha256(dataset);
  await Promise.all([
    writeFile(join(directory, 'dataset.ndjson'), dataset, 'utf8'),
    writeJson(join(directory, 'manifest.json'), {
      schemaVersion: 1,
      datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2',
      generatedAt: '2026-08-10T00:00:00.000Z',
      source: {
        kind: 'HISTORICAL_REPLAY',
        replayVersion: 'RECOMMENDATION_HISTORICAL_PRO_REPLAY_2',
        directory: '/source',
        fileName: 'dataset.ndjson',
        sha256: 'c'.repeat(64),
        byteLength: 1,
        manifestRowCount: rows.length,
        scannedRowCount: rows.length,
      },
      candidateGeneratorSnapshots: {
        registryPath: '/registry.json',
        registrySha256: 'd'.repeat(64),
        snapshotCount: 1,
        snapshotIds: ['snapshot-1'],
      },
      timelineSource: {
        directory: '/timeline',
        decisionSnapshotStalenessS: 120,
        featureCutoff: 'LATEST_PLAYER_SNAPSHOT_AT_OR_BEFORE_DECISION',
      },
      splitDescriptor: {
        version: 'RECOMMENDATION_DATASET_V6_CHRONOLOGICAL_SPLIT_1',
        timeField: 'matchStartTime',
        assignmentUnit: 'MATCH',
        tuningStart: '2026-07-01T00:00:00.000Z',
        futureTestStart: '2026-08-01T00:00:00.000Z',
        rule: {
          train: 'matchStartTime < tuningStart',
          tuning: 'tuningStart <= matchStartTime < futureTestStart',
          futureTest: 'matchStartTime >= futureTestStart',
        },
        sha256: 'e'.repeat(64),
      },
      artifact: {
        format: 'NDJSON',
        fileName: 'dataset.ndjson',
        byteLength: Buffer.byteLength(dataset),
        sha256: datasetSha256,
        rowCount: rows.length,
      },
      build: { fullCorpus: true },
      featureContract: {
        featureCutoff: 'DECISION_TIME_PRE_ACTION',
        stateFeatureVersion: 'RECOMMENDATION_STATE_FEATURES_V6_2_FUTURE_TIMELINE_FALLBACK',
        decisionSource: 'HISTORICAL_REPLAY',
        candidateSpecificFeatures: true,
        observedActionInjectedIntoCandidates: false,
        currentGoldAvailable: false,
        netWorthUsedAsCurrentGold: false,
        v5_3UsedAsInput: false,
        userLiveUsedAsInput: false,
        futureTestEligibleForSelection: false,
        finalOutcomeAuxiliary: true,
        shortHorizonTargets: ['3m', '5m', '10m'],
      },
      auditPassed: true,
      trainingArtifactEligible: true,
    }),
    writeJson(join(directory, 'audit.json'), {
      schemaVersion: 1,
      datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2',
      generatedAt: '2026-08-10T00:00:00.000Z',
      passed: true,
      trainingArtifactEligible: true,
    }),
  ]);
  return datasetSha256;
}

async function writeBehavioralArtifact(
  directory: string,
  rows: RecommendationProDecisionDatasetV6Row[],
  datasetSha256: string,
  foldCount: number,
): Promise<void> {
  const propensityRows = rows.map((row) =>
    propensityRow(row, datasetSha256, foldCount),
  );
  const propensities = `${propensityRows
    .map((row) => JSON.stringify(row))
    .join('\n')}\n`;
  const propensitySha256 = sha256(propensities);
  await Promise.all([
    writeFile(
      join(directory, 'propensities.ndjson'),
      propensities,
      'utf8',
    ),
    writeJson(join(directory, 'manifest.json'), {
      schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION,
      modelVersion: RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,
      featureVersion: RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION,
      generatedAt: '2026-08-11T00:00:00.000Z',
      source: {
        datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2',
        directory: '/dataset',
        fileName: 'dataset.ndjson',
        sha256: datasetSha256,
        byteLength: 1,
        rowCount: rows.length,
      },
      artifacts: {
        propensities: {
          fileName: 'propensities.ndjson',
          sha256: propensitySha256,
          byteLength: Buffer.byteLength(propensities),
          rowCount: propensityRows.length,
        },
      },
      releaseGatePassed: true,
      auditPassed: true,
      trainingArtifactEligible: true,
    }),
    writeJson(join(directory, 'audit.json'), {
      schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION,
      modelVersion: RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,
      passed: true,
      trainingArtifactEligible: true,
    }),
    writeJson(join(directory, 'evaluation.json'), {
      schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION,
      releaseGate: { passed: true },
    }),
  ]);
}

function propensityRow(
  row: RecommendationProDecisionDatasetV6Row,
  datasetSha256: string,
  foldCount: number,
): RecommendationBehavioralV5PropensityRow {
  const foldId =
    row.split === 'TRAIN'
      ? recommendationValueV8FoldId(row.matchId, foldCount)
      : undefined;
  return {
    schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,
    featureVersion: RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION,
    decisionId: row.decisionId,
    matchId: row.matchId,
    split: row.split,
    predictionSource:
      row.split === 'TRAIN' ? 'CROSS_FITTED_OOF' : 'FULL_TRAIN_MODEL',
    foldId,
    trainingMatchExcluded: true,
    observedActionKey: row.observedActionKey,
    observedActionRawProbability: 0.5,
    observedActionProbability: 0.5,
    probabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION',
    supported: true,
    propensityFloor: 0.01,
    propensityFloorApplied: false,
    candidates: row.candidates.map((candidate, index) => ({
      actionKey: candidate.actionKey,
      itemId: candidate.itemId,
      score: 0,
      rawProbability: 0.5,
      probability: 0.5,
      rank: index + 1,
    })),
    modelArtifactSha256: 'f'.repeat(64),
    sourceDatasetSha256: datasetSha256,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8');
}

async function readNdjson(path: string): Promise<Record<string, unknown>[]> {
  const raw = await readFile(path, 'utf8');
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
