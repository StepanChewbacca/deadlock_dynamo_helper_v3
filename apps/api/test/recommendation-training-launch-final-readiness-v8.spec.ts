import { RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_EVALUATOR_V1 } from '@deadlock-live-probe/shared';
import { RecommendationTrainingLaunchV8Service } from '../src/deadlock-live/recommendation-training-launch-v8.service';
import {
  TEST_DIRECT_SHOP_APPROVAL_KEY,
  TEST_DIRECT_SHOP_SUBJECT_SHA256,
  createDirectShopValidationSnapshotV8,
} from './fixtures/recommendation-direct-shop-validation-v8';

const sha = (value: string) => value.repeat(64).slice(0, 64);
const SHOP_ENV = 'RECOMMENDATION_DIRECT_SHOP_SOURCE_ALLOWLIST';
const CANDIDATE_GENERATOR_VERSION = 'candidate-v8';
const DIRECT_SHOP_SOURCE_APPROVAL_KEY = TEST_DIRECT_SHOP_APPROVAL_KEY;
const DIRECT_SHOP_SUBJECT_SHA = TEST_DIRECT_SHOP_SUBJECT_SHA256;

function manifest() {
  return {
    contractVersion: 'recommendation-dataset-manifest-v1' as const,
    datasetId: 'dataset-v8-final',
    datasetSha256: sha('a'),
    createdAt: '2026-08-20T00:00:00.000Z',
    sourceCommitSha: 'b'.repeat(40),
    datasetContractVersion: 'recommendation-dataset-v8',
    featureContractVersion: 'recommendation-features-v8',
    actionContractVersion: 'recommendation-actions-v1',
    candidateGeneratorVersion: CANDIDATE_GENERATOR_VERSION,
    directShopSourceApprovalKeys: [DIRECT_SHOP_SOURCE_APPROVAL_KEY],
    directShopSourceValidationSubjectSha256: DIRECT_SHOP_SUBJECT_SHA,
    pointInTimeCorrect: true,
    observedActionInjected: false,
    futureTestTouched: false,
    supportedRulesetVersions: ['ruleset-1'],
    supportedCatalogSha256: [sha('c')],
    splits: [
      { split: 'TRAIN' as const, from: '2026-07-01T00:00:00.000Z', to: '2026-07-15T00:00:00.000Z', matchCount: 100, decisionCount: 20_000, matchSetSha256: sha('d'), sealed: false },
      { split: 'VALIDATION' as const, from: '2026-07-15T00:00:00.000Z', to: '2026-07-22T00:00:00.000Z', matchCount: 50, decisionCount: 10_000, matchSetSha256: sha('e'), sealed: false },
      { split: 'SHADOW_HOLDOUT' as const, from: '2026-07-22T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z', matchCount: 50, decisionCount: 10_000, matchSetSha256: sha('f'), sealed: false },
      { split: 'FUTURE_TEST' as const, from: '2026-08-01T00:00:00.000Z', to: '2026-08-15T00:00:00.000Z', matchCount: 0, decisionCount: 0, matchSetSha256: sha('0'), sealed: true },
    ],
    files: [
      { path: 'splits/train.jsonl.gz', sha256: sha('1'), sizeBytes: 100, rowCount: 20_000 },
      { path: 'splits/validation.jsonl.gz', sha256: sha('2'), sizeBytes: 100, rowCount: 10_000 },
      { path: 'splits/shadow_holdout.jsonl.gz', sha256: sha('3'), sizeBytes: 100, rowCount: 10_000 },
    ],
  };
}

function config() {
  return {
    contractVersion: 'recommendation-behavioral-training-launch-v1' as const,
    family: 'SEQUENCE_RNN' as const,
    seed: 17,
    deterministic: true as const,
    trainSplit: 'TRAIN' as const,
    validationSplit: 'VALIDATION' as const,
    selectionSplit: 'SHADOW_HOLDOUT' as const,
    futureTestAllowed: false as const,
    device: 'cuda',
    maxEpochs: 30,
    batchSize: 64,
    evaluationBatchSize: 128,
    learningRate: 0.0003,
    minimumLearningRate: 0.000001,
    weightDecay: 0.0001,
    gradientClip: 1,
    maximumHistoryEvents: 64,
    hashDimension: 65536,
    embeddingDimension: 128,
    hiddenDimension: 256,
    layerCount: 3,
    dropout: 0.1,
    earlyStoppingPatience: 4,
  };
}

function roadmapEvidence() {
  return {
    canonicalGepV2: 'PASS' as const,
    controlledSoulsValidation: 'PASS' as const,
    directShopSourceValidation: 'PASS' as const,
    versionedRulesetCatalog: 'PASS' as const,
    deterministicLegality: 'PASS' as const,
    recommendationTelemetryV8: 'PASS' as const,
    observabilityCoverage: 'PASS' as const,
    datasetV8Structural: 'PASS' as const,
    datasetV8Empirical: 'PASS' as const,
    behavioralOffline: 'NOT_EVALUATED' as const,
    shadowSafety: 'NOT_EVALUATED' as const,
    matchLevelAbSafety: 'NOT_EVALUATED' as const,
    exactActionPropensity: 'NOT_EVALUATED' as const,
    safeExplorationSafety: 'NOT_EVALUATED' as const,
    valueActionSensitivity: 'NOT_EVALUATED' as const,
    offPolicySupport: 'NOT_EVALUATED' as const,
    causalValueRelease: 'NOT_EVALUATED' as const,
    policyAbRelease: 'NOT_EVALUATED' as const,
    sequentialRlResearchGate: 'NOT_EVALUATED' as const,
    futureTestEvaluation: 'NOT_EVALUATED' as const,
    futureTestUntouched: true,
  };
}

function roadmapReport() {
  return {
    evidence: roadmapEvidence(),
    latestEvidenceByGate: {
      directShopSourceValidation: {
        subjectSha256: DIRECT_SHOP_SUBJECT_SHA,
        evaluator: RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_EVALUATOR_V1,
      },
    },
  };
}

function currentDataset(overrides: Record<string, unknown> = {}) {
  return {
    candidateGeneratorVersion: CANDIDATE_GENERATOR_VERSION,
    passedStructuralGate: true,
    passedEmpiricalGate: true,
    blockers: [],
    explicitFeasibilityCoverage: 0.997,
    observedActionFeasibleCoverage: 0.995,
    minimumMajorActionPhaseCohortObservedActionFeasibleCoverage: 0.985,
    rulesetEvidenceCoverage: 0.9995,
    ...overrides,
  };
}

function currentObservability() {
  return {
    candidateGeneratorVersion: CANDIDATE_GENERATOR_VERSION,
    approvedDirectShopSourceKeys: [DIRECT_SHOP_SOURCE_APPROVAL_KEY],
    gate: { passed: true, blockers: [] },
  };
}

function validationSnapshot() {
  return createDirectShopValidationSnapshotV8(DIRECT_SHOP_SUBJECT_SHA, DIRECT_SHOP_SOURCE_APPROVAL_KEY);
}

function createService(datasetOverrides: Record<string, unknown> = {}) {
  const dataset = manifest();
  const datasetRegistry = {
    getVerified: jest.fn(async () => ({
      datasetId: dataset.datasetId,
      datasetSha256: dataset.datasetSha256,
      manifestSha256: sha('9'),
      objectBaseUri: 's3://immutable/dataset-v8-final',
      manifest: dataset,
      verification: { verifiedManifestSha256: sha('9') },
    })),
  };
  const roadmap = { report: jest.fn(async () => roadmapReport()) };
  const datasetReport = { buildReport: jest.fn(async () => currentDataset(datasetOverrides)) };
  const observability = { buildReport: jest.fn(async () => currentObservability()) };
  const souls = { report: jest.fn(async () => ({ verdict: 'PASS' as const, canMarkSpendableSoulsVerified: true })) };
  const materializer = { getSnapshot: jest.fn(async () => validationSnapshot()) };
  const service = new RecommendationTrainingLaunchV8Service(
    datasetRegistry as never,
    roadmap as never,
    datasetReport as never,
    observability as never,
    souls as never,
    materializer as never,
  );
  return { service, datasetReport, observability };
}

describe('RecommendationTrainingLaunchV8Service final data readiness', () => {
  const originalShopEnv = process.env[SHOP_ENV];

  beforeEach(() => {
    process.env[SHOP_ENV] = DIRECT_SHOP_SOURCE_APPROVAL_KEY;
  });

  afterEach(() => {
    if (originalShopEnv === undefined) delete process.env[SHOP_ENV];
    else process.env[SHOP_ENV] = originalShopEnv;
  });

  it('rechecks current data over the immutable dataset development window', async () => {
    const { service, datasetReport, observability } = createService();

    const report = await service.preflight('dataset-v8-final', config());

    expect(report.ready).toBe(true);
    expect(datasetReport.buildReport).toHaveBeenCalledWith({
      from: new Date('2026-07-01T00:00:00.000Z'),
      to: new Date('2026-08-01T00:00:00.000Z'),
      candidateGeneratorVersion: CANDIDATE_GENERATOR_VERSION,
    });
    expect(observability.buildReport).toHaveBeenCalledWith({
      from: new Date('2026-07-01T00:00:00.000Z'),
      to: new Date('2026-08-01T00:00:00.000Z'),
      candidateGeneratorVersion: CANDIDATE_GENERATOR_VERSION,
    });
    expect(report.currentDataGates.candidateGeneratorVersion).toBe(CANDIDATE_GENERATOR_VERSION);
    expect(report.currentDataGates.directShopSourceApprovalKeys).toEqual([DIRECT_SHOP_SOURCE_APPROVAL_KEY]);
    expect(report.currentDataGates.directShopSourceValidation).toBe('PASS');
    expect(report.currentDataGates.explicitFeasibilityCoverage).toBe(0.997);
  });

  it('blocks a previously green roadmap when current Dataset V8 evidence no longer passes', async () => {
    const { service } = createService({
      passedEmpiricalGate: false,
      blockers: ['EXPLICIT_FEASIBILITY_COVERAGE_BELOW_0_995'],
      explicitFeasibilityCoverage: 0.99,
    });

    const report = await service.preflight('dataset-v8-final', config());

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('CURRENT_DATASET_EMPIRICAL:EXPLICIT_FEASIBILITY_COVERAGE_BELOW_0_995');
  });
});
