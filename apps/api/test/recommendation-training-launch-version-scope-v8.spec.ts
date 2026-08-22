import {
  RECOMMENDATION_BEHAVIORAL_TRAINING_LAUNCH_V1,
  RECOMMENDATION_DATASET_MANIFEST_VERSION,
  RECOMMENDATION_FEATURE_CONTRACT_VERSION,
} from '@deadlock-live-probe/shared';
import { RecommendationTrainingLaunchV8Service } from '../src/deadlock-live/recommendation-training-launch-v8.service';

const candidateGeneratorVersion = 'candidate-v8.4';

function manifest() {
  return {
    contractVersion: RECOMMENDATION_DATASET_MANIFEST_VERSION,
    datasetId: 'dataset-v8-ready',
    datasetSha256: 'a'.repeat(64),
    createdAt: '2026-08-22T00:00:00.000Z',
    sourceCommitSha: 'b'.repeat(40),
    datasetContractVersion: 'recommendation-dataset-v8',
    featureContractVersion: RECOMMENDATION_FEATURE_CONTRACT_VERSION,
    actionContractVersion: 'recommendation-actions-v1',
    candidateGeneratorVersion,
    pointInTimeCorrect: true,
    observedActionInjected: false,
    futureTestTouched: false,
    supportedRulesetVersions: ['ruleset-1'],
    supportedCatalogSha256: ['c'.repeat(64)],
    splits: [
      {
        split: 'TRAIN', from: '2026-08-01T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z',
        matchCount: 100, decisionCount: 20_000, matchSetSha256: '1'.repeat(64), sealed: false,
      },
      {
        split: 'VALIDATION', from: '2026-08-08T00:00:00.000Z', to: '2026-08-12T00:00:00.000Z',
        matchCount: 50, decisionCount: 5_000, matchSetSha256: '2'.repeat(64), sealed: false,
      },
      {
        split: 'SHADOW_HOLDOUT', from: '2026-08-12T00:00:00.000Z', to: '2026-08-16T00:00:00.000Z',
        matchCount: 80, decisionCount: 10_000, matchSetSha256: '3'.repeat(64), sealed: false,
      },
      {
        split: 'FUTURE_TEST', from: '2026-08-16T00:00:00.000Z', to: '2026-08-22T00:00:00.000Z',
        matchCount: 0, decisionCount: 0, matchSetSha256: '4'.repeat(64), sealed: true,
      },
    ],
    files: [
      { path: 'splits/train.jsonl.gz', sha256: '5'.repeat(64), sizeBytes: 1000, rowCount: 20_000 },
      { path: 'splits/validation.jsonl.gz', sha256: '6'.repeat(64), sizeBytes: 500, rowCount: 5_000 },
      { path: 'splits/shadow_holdout.jsonl.gz', sha256: '7'.repeat(64), sizeBytes: 800, rowCount: 10_000 },
    ],
  };
}

function config() {
  return {
    contractVersion: RECOMMENDATION_BEHAVIORAL_TRAINING_LAUNCH_V1,
    family: 'SEQUENCE_TRANSFORMER',
    seed: 17,
    deterministic: true,
    trainSplit: 'TRAIN',
    validationSplit: 'VALIDATION',
    selectionSplit: 'SHADOW_HOLDOUT',
    futureTestAllowed: false,
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
    attentionHeads: 8,
    dropout: 0.1,
    earlyStoppingPatience: 4,
    earlyStoppingMinDelta: 0.000001,
    lrPlateauPatience: 1,
    lrPlateauFactor: 0.5,
    shuffleBufferDecisions: 8192,
    supportProbabilityThreshold: 0.0001,
    majorCohortMinDecisions: 50,
    majorCohortMinFraction: 0.005,
    gateMinDecisions: 10_000,
    gateMinCandidateCoverage: 0.99,
    gateMinSupport: 0.9,
    gateMinMajorCohortSupport: 0.75,
    gateMaxFloorSensitivity: 0.02,
  };
}

function roadmap() {
  return {
    generatedAt: '2026-08-22T00:00:00.000Z',
    evidence: {
      canonicalGepV2: 'PASS',
      controlledSoulsValidation: 'PASS',
      versionedRulesetCatalog: 'PASS',
      deterministicLegality: 'PASS',
      recommendationTelemetryV8: 'PASS',
      observabilityCoverage: 'PASS',
      datasetV8Structural: 'PASS',
      datasetV8Empirical: 'PASS',
      behavioralOffline: 'NOT_EVALUATED',
      shadowSafety: 'NOT_EVALUATED',
      matchLevelAbSafety: 'NOT_EVALUATED',
      exactActionPropensity: 'NOT_EVALUATED',
      safeExplorationSafety: 'NOT_EVALUATED',
      valueActionSensitivity: 'NOT_EVALUATED',
      offPolicySupport: 'NOT_EVALUATED',
      causalValueRelease: 'NOT_EVALUATED',
      policyAbRelease: 'NOT_EVALUATED',
      sequentialRlResearchGate: 'NOT_EVALUATED',
      futureTestEvaluation: 'NOT_EVALUATED',
      futureTestUntouched: true,
    },
  };
}

function currentDataset(version = candidateGeneratorVersion) {
  return {
    candidateGeneratorVersion: version,
    passedStructuralGate: true,
    passedEmpiricalGate: true,
    blockers: [],
    explicitFeasibilityCoverage: 1,
    observedActionFeasibleCoverage: 1,
    minimumMajorActionPhaseCohortObservedActionFeasibleCoverage: 1,
    rulesetEvidenceCoverage: 1,
  };
}

function currentObservability(version = candidateGeneratorVersion) {
  return {
    candidateGeneratorVersion: version,
    gate: { passed: true, blockers: [] },
  };
}

function harness(datasetVersion = candidateGeneratorVersion, observabilityVersion = candidateGeneratorVersion) {
  const datasetManifest = manifest();
  const datasetRegistry = {
    getVerified: jest.fn(async () => ({
      datasetId: datasetManifest.datasetId,
      datasetSha256: datasetManifest.datasetSha256,
      manifestSha256: 'd'.repeat(64),
      objectBaseUri: 's3://immutable/dataset-v8-ready',
      manifest: datasetManifest,
      status: 'VERIFIED',
      verification: { verifiedManifestSha256: 'd'.repeat(64) },
    })),
  };
  const roadmapEvidence = { report: jest.fn(async () => roadmap()) };
  const datasetReport = { buildReport: jest.fn(async () => currentDataset(datasetVersion)) };
  const observabilityReport = { buildReport: jest.fn(async () => currentObservability(observabilityVersion)) };
  const soulsEvidence = {
    report: jest.fn(async () => ({ verdict: 'PASS', canMarkSpendableSoulsVerified: true })),
  };
  const service = new RecommendationTrainingLaunchV8Service(
    datasetRegistry as never,
    roadmapEvidence as never,
    datasetReport as never,
    observabilityReport as never,
    soulsEvidence as never,
  );
  return { service, datasetReport, observabilityReport };
}

describe('RecommendationTrainingLaunchV8Service generator scope', () => {
  it('recomputes final data gates on the exact generator version embedded in the verified dataset', async () => {
    const { service, datasetReport, observabilityReport } = harness();

    const report = await service.preflight('dataset-v8-ready', config() as never);

    expect(report.ready).toBe(true);
    expect(report.currentDataGates.candidateGeneratorVersion).toBe(candidateGeneratorVersion);
    expect(datasetReport.buildReport).toHaveBeenCalledWith({
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-16T00:00:00.000Z'),
      candidateGeneratorVersion,
    });
    expect(observabilityReport.buildReport).toHaveBeenCalledWith({
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-16T00:00:00.000Z'),
      candidateGeneratorVersion,
    });
  });

  it('fails closed if either current gate report is not actually scoped to the dataset generator', async () => {
    const { service } = harness('other-generator', 'other-generator');

    const report = await service.preflight('dataset-v8-ready', config() as never);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('CURRENT_DATASET_CANDIDATE_GENERATOR_SCOPE_MISMATCH');
    expect(report.blockers).toContain('CURRENT_OBSERVABILITY_CANDIDATE_GENERATOR_SCOPE_MISMATCH');
  });
});
