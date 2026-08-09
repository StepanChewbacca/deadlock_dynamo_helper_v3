import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  recommendationBehavioralV5DiagnosticMatchSelected,
  recommendationBehavioralV5FoldId,
  type RecommendationBehavioralV5Model,
} from '../src/deadlock-live/recommendation-behavioral-v5';
import {
  RecommendationBehavioralV5TrainingService,
  type RecommendationBehavioralV5PropensityRow,
} from '../src/deadlock-live/recommendation-behavioral-v5-training.service';
import type { RecommendationProDecisionDatasetV6Row } from '../src/deadlock-live/recommendation-pro-decision-dataset-v6';

const SOURCE_ENV = 'DEADLOCK_RECOMMENDATION_BEHAVIORAL_V5_SOURCE_DIR';
const OUTPUT_ENV = 'DEADLOCK_RECOMMENDATION_BEHAVIORAL_V5_DIR';

describe('Recommendation Behavioral V5 training', () => {
  let root: string;
  let previousSource: string | undefined;
  let previousOutput: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'recommendation-behavioral-v5-'));
    previousSource = process.env[SOURCE_ENV];
    previousOutput = process.env[OUTPUT_ENV];
  });

  afterEach(async () => {
    restoreEnvironment(SOURCE_ENV, previousSource);
    restoreEnvironment(OUTPUT_ENV, previousOutput);
    await rm(root, { recursive: true, force: true });
  });

  it('writes match-cross-fitted TRAIN propensities and train-only holdout predictions', async () => {
    const sourceDirectory = join(root, 'source');
    const outputDirectory = join(root, 'output');
    await mkdir(sourceDirectory, { recursive: true });
    const foldCount = 3;
    const trainMatchIds = matchIdsCoveringEveryFold(foldCount);
    const rows: RecommendationProDecisionDatasetV6Row[] = [
      ...trainMatchIds.map((matchId, index) =>
        row({
          decisionId: `train-${index}`,
          matchId,
          split: 'TRAIN',
          matchStartTime: `2026-07-0${index + 1}T00:00:00.000Z`,
          observedActionKey: index % 2 === 0 ? 'BUY:1002' : 'BUY:1003',
        }),
      ),
      row({
        decisionId: 'tuning-1',
        matchId: 'tuning-match-1',
        split: 'TUNING',
        matchStartTime: '2026-07-10T00:00:00.000Z',
        observedActionKey: 'BUY:1002',
      }),
      row({
        decisionId: 'future-test-1',
        matchId: 'future-test-match-1',
        split: 'FUTURE_TEST',
        matchStartTime: '2026-07-20T00:00:00.000Z',
        observedActionKey: 'BUY:1003',
      }),
    ];
    const dataset = `${rows.map((value) => JSON.stringify(value)).join('\n')}\n`;
    const datasetSha256 = sha256(dataset);
    await Promise.all([
      writeFile(join(sourceDirectory, 'dataset.ndjson'), dataset, 'utf8'),
      writeJson(join(sourceDirectory, 'manifest.json'), {
        schemaVersion: 1,
        datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2',
        generatedAt: '2026-07-21T00:00:00.000Z',
        artifact: {
          format: 'NDJSON',
          fileName: 'dataset.ndjson',
          byteLength: Buffer.byteLength(dataset),
          sha256: datasetSha256,
          rowCount: rows.length,
        },
        splitDescriptor: {
          version: 'RECOMMENDATION_DATASET_V6_CHRONOLOGICAL_SPLIT_1',
          timeField: 'matchStartTime',
          assignmentUnit: 'MATCH',
          tuningStart: '2026-07-10T00:00:00.000Z',
          futureTestStart: '2026-07-20T00:00:00.000Z',
          sha256: 'a'.repeat(64),
        },
        featureContract: {
          userLiveUsedAsInput: false,
          futureTestEligibleForSelection: false,
        },
        auditPassed: true,
        trainingArtifactEligible: true,
      }),
      writeJson(join(sourceDirectory, 'audit.json'), {
        schemaVersion: 1,
        datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2',
        passed: true,
        trainingArtifactEligible: true,
      }),
    ]);
    process.env[SOURCE_ENV] = sourceDirectory;
    process.env[OUTPUT_ENV] = outputDirectory;

    const service = new RecommendationBehavioralV5TrainingService();
    await service.onModuleInit();
    await service.start({
      foldCount,
      epochs: 2,
      learningRate: 0.2,
      l2: 0.0001,
      hashDimension: 512,
      propensityFloor: 0.01,
      supportProbability: 0.0001,
      majorGroupMinDecisions: 1_000,
      expectedSourceSha256: datasetSha256,
    });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'COMPLETE',
      trainEligibleDecisionCount: trainMatchIds.length,
      tuningEligibleDecisionCount: 1,
      futureTestEligibleDecisionCount: 1,
      predictionRowCount: rows.length,
      modelAvailable: true,
      propensitiesAvailable: true,
      evaluationAvailable: true,
      auditAvailable: true,
      manifestAvailable: true,
    });

    const propensities = gunzipSync(
      await readFile(join(outputDirectory, 'propensities.ndjson')),
    )
      .toString('utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as RecommendationBehavioralV5PropensityRow);
    expect(propensities).toHaveLength(rows.length);
    const trainPropensities = propensities.filter(
      (value) => value.split === 'TRAIN',
    );
    expect(trainPropensities).toHaveLength(trainMatchIds.length);
    for (const value of trainPropensities) {
      expect(value).toMatchObject({
        predictionSource: 'CROSS_FITTED_OOF',
        trainingMatchExcluded: true,
        foldId: recommendationBehavioralV5FoldId(value.matchId, foldCount),
        probabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION',
        propensityFloorApplied: false,
      });
      expect(value.observedActionProbability).toBeGreaterThan(0);
      expect(value.observedActionProbability).toBeCloseTo(
        value.observedActionRawProbability,
        15,
      );
      for (const candidate of value.candidates) {
        expect(candidate.probability).toBeCloseTo(candidate.rawProbability, 15);
      }
      expect(
        value.candidates.reduce(
          (sum, candidate) => sum + candidate.probability,
          0,
        ),
      ).toBeCloseTo(1, 12);
    }
    for (const value of propensities.filter(
      (entry) => entry.split !== 'TRAIN',
    )) {
      expect(value).toMatchObject({
        predictionSource: 'FULL_TRAIN_MODEL',
        trainingMatchExcluded: true,
      });
      expect(value.foldId).toBeUndefined();
    }

    const modelArtifact = JSON.parse(
      await readFile(join(outputDirectory, 'model.json'), 'utf8'),
    ) as {
      trainingDataPolicy: Record<string, unknown>;
      foldModels: Array<{
        holdoutFoldId: number;
        model: RecommendationBehavioralV5Model;
      }>;
      finalModel: RecommendationBehavioralV5Model;
    };
    expect(modelArtifact.trainingDataPolicy).toMatchObject({
      trainSplitOnly: true,
      tuningUsedForTraining: false,
      futureTestUsedForTraining: false,
      outcomeFieldsUsed: false,
      crossFittingUnit: 'MATCH',
    });
    expect(modelArtifact.foldModels).toHaveLength(foldCount);
    for (const fold of modelArtifact.foldModels) {
      expect(fold.model.trainedDecisionCount).toBe(
        (trainMatchIds.length - 1) * 2,
      );
    }
    expect(modelArtifact.finalModel.trainedDecisionCount).toBe(
      trainMatchIds.length * 2,
    );

    expect(service.getAudit()).toMatchObject({
      passed: true,
      crossFitting: {
        unit: 'MATCH',
        foldCount,
        oofPredictionCount: trainMatchIds.length,
        trainingMatchExclusionVerified: true,
        futureTestUsedForTraining: false,
        tuningUsedForTraining: false,
      },
      predictions: {
        rowCount: rows.length,
        oofPredictionCount: trainMatchIds.length,
        fullTrainPredictionCount: 2,
      },
    });
    expect(service.getManifest()).toMatchObject({
      schemaVersion: 2,
      modelVersion:
        'RECOMMENDATION_BEHAVIORAL_V5_1_HASHED_CONDITIONAL_CHOICE_2_RAW_PROPENSITY',
      featureVersion:
        'RECOMMENDATION_BEHAVIORAL_V5_1_FEATURES_4_CAPACITY_INTERACTIONS',
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
      auditPassed: true,
    });
    expect(service.getEvaluation()).toMatchObject({
      propensityContract: {
        output: 'RAW_SOFTMAX_WITHIN_DECISION',
        candidateProbabilityFloorApplied: false,
        floorSensitivity: 'OBSERVED_PROPENSITY_CLIP_ONLY',
      },
      futureTestPolicy: {
        reported: true,
        usedForTraining: false,
        usedForCalibration: false,
        usedForReleaseGate: false,
      },
    });
    const status = service.getStatus();
    const audit = service.getAudit() as {
      releaseGate: { passed: boolean };
      trainingArtifactEligible: boolean;
    };
    expect(status.releaseGatePassed).toBe(audit.releaseGate.passed);
    expect(status.trainingArtifactEligible).toBe(
      audit.trainingArtifactEligible,
    );

    const sampledOutputDirectory = join(root, 'sampled-output');
    process.env[OUTPUT_ENV] = sampledOutputDirectory;
    const sampledService = new RecommendationBehavioralV5TrainingService();
    await sampledService.onModuleInit();
    await sampledService.start({
      foldCount,
      epochs: 1,
      learningRate: 0.2,
      l2: 0.0001,
      hashDimension: 512,
      propensityFloor: 0.01,
      supportProbability: 0.0001,
      majorGroupMinDecisions: 1_000,
      expectedSourceSha256: datasetSha256,
      diagnosticMatchModulo: 2,
      diagnosticMatchRemainder: 0,
    });
    await sampledService.waitForIdle();

    expect(sampledService.getStatus()).toMatchObject({
      state: 'COMPLETE',
      trainEligibleDecisionCount: trainMatchIds.length,
      futureTestEligibleDecisionCount: 0,
      trainingArtifactEligible: false,
    });
    const sampledRows = gunzipSync(
      await readFile(join(sampledOutputDirectory, 'diagnostic-sample.ndjson.gz')),
    )
      .toString('utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RecommendationProDecisionDatasetV6Row);
    expect(sampledRows.length).toBeGreaterThanOrEqual(trainMatchIds.length);
    expect(sampledRows.every((value) => value.split !== 'FUTURE_TEST')).toBe(
      true,
    );
    expect(
      sampledRows.every((value) =>
        recommendationBehavioralV5DiagnosticMatchSelected(
          value.matchId,
          2,
          0,
        ),
      ),
    ).toBe(true);

    const sampledAudit = sampledService.getAudit() as {
      passed: boolean;
      trainingArtifactEligible: boolean;
      build: {
        fullCorpus: boolean;
        diagnosticMatchSample: {
          unit: string;
          hash: string;
          modulo: number;
          remainder: number;
          futureTestEvaluated: boolean;
          artifact: {
            fileName: string;
            rowCount: number;
            sha256: string;
          };
        };
      };
    };
    expect(sampledAudit).toMatchObject({
      passed: true,
      trainingArtifactEligible: false,
      build: {
        fullCorpus: false,
        diagnosticMatchSample: {
          unit: 'MATCH',
          hash: 'FNV1A_32',
          modulo: 2,
          remainder: 0,
          futureTestEvaluated: false,
          artifact: {
            fileName: 'diagnostic-sample.ndjson.gz',
            rowCount: sampledRows.length,
          },
        },
      },
    });
    expect(sampledAudit.build.diagnosticMatchSample.artifact.sha256).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(sampledService.getEvaluation()).toMatchObject({
      futureTestPolicy: {
        reported: false,
        usedForTraining: false,
        usedForCalibration: false,
        usedForReleaseGate: false,
      },
    });
  });
});

function matchIdsCoveringEveryFold(foldCount: number): string[] {
  const result = new Map<number, string>();
  for (let index = 1; result.size < foldCount && index < 10_000; index += 1) {
    const matchId = `train-match-${index}`;
    if (!recommendationBehavioralV5DiagnosticMatchSelected(matchId, 2, 0)) {
      continue;
    }
    const foldId = recommendationBehavioralV5FoldId(matchId, foldCount);
    if (!result.has(foldId)) {
      result.set(foldId, matchId);
    }
  }
  if (result.size !== foldCount) {
    throw new Error('Unable to construct Behavioral V5 fold fixtures.');
  }
  return [...result.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, matchId]) => matchId);
}

function row(input: {
  decisionId: string;
  matchId: string;
  split: 'TRAIN' | 'TUNING' | 'FUTURE_TEST';
  matchStartTime: string;
  observedActionKey: 'BUY:1002' | 'BUY:1003';
}): RecommendationProDecisionDatasetV6Row {
  return {
    schemaVersion: 1,
    datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2',
    dataSource: 'PRO_HISTORICAL',
    decisionSource: 'HISTORICAL_REPLAY',
    decisionId: input.decisionId,
    matchId: input.matchId,
    matchStartTime: input.matchStartTime,
    playerId: `player-${input.matchId}`,
    split: input.split,
    state: {
      heroId: 1,
      team: 0,
      phase: 'EARLY',
      gameTimeS: 600,
      inventoryStateKey: '1001x1',
      inventoryItemCounts: [{ itemId: 1001, count: 1 }],
      previousActionKeys: ['BUY:1001'],
      alliedHeroIds: [1, 2, 3, 4, 5, 6],
      enemyHeroIds: [7, 8, 9, 10, 11, 12],
      inventoryTagCounts: { COMPONENT: 1 },
      timelineJoined: true,
      timelineSnapshotLagS: 5,
      kills: 2,
      deaths: 1,
      assists: 4,
      netWorth: 5_000,
      heroDamage: 3_500,
      health: 900,
      maxHealth: 1_200,
      level: 8,
    },
    candidates: [
      candidate(1002, 'WEAPON', ['DAMAGE'], 1, 0.6, 12),
      candidate(1003, 'VITALITY', ['VITALITY'], 2, 0.4, 8),
    ],
    observedActionKey: input.observedActionKey,
    observedActionInCandidateSet: true,
    shortHorizonOutcomes: {
      threeMinutes: 0.1,
      fiveMinutes: 0.2,
      tenMinutes: 0.3,
    },
    finalOutcome: input.observedActionKey === 'BUY:1002' ? 1 : 0,
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
  itemId: 1002 | 1003,
  slotType: 'WEAPON' | 'VITALITY',
  tags: string[],
  rank: number,
  historicalProbability: number,
  historicalCount: number,
): RecommendationProDecisionDatasetV6Row['candidates'][number] {
  return {
    actionKey: `BUY:${itemId}`,
    actionType: 'BUY',
    itemId,
    rank,
    generatorScore: historicalProbability,
    historicalCount,
    historicalProbability,
    confidence: 0.8,
    predictedStateKey: `1001x1|${itemId}x1`,
    catalogMetadataAvailable: true,
    cost: 1_250,
    tier: 2,
    slotType,
    itemType: 'UPGRADE',
    isActiveItem: itemId === 1003,
    ...(itemId === 1003 ? { activationType: 'INSTANT' } : {}),
    tags,
    componentItemIds: itemId === 1002 ? [1001] : [],
    requiredComponentCount: itemId === 1002 ? 1 : 0,
    ownedComponentCount: itemId === 1002 ? 1 : 0,
    missingComponentCount: 0,
    hasAnyOwnedComponent: itemId === 1002,
    hasCompleteRecipeComponents: itemId === 1002,
    alreadyOwnedCount: 0,
    sameSlotOwnedItemCount: itemId === 1002 ? 1 : 0,
    inventoryTagOverlapCount: 0,
    previousActionCount: 0,
    currentNetWorth: 5_000,
    costToNetWorthRatio: 0.25,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8');
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
