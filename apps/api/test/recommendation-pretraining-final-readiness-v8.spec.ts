import { RecommendationPretrainingFinalReadinessV8Service } from '../src/deadlock-live/recommendation-pretraining-final-readiness-v8.service';

const DATASET_SHA = 'a'.repeat(64);
const MANIFEST_SHA = 'b'.repeat(64);
const SOURCE_COMMIT_SHA = 'c'.repeat(40);

function config(family: 'SEQUENCE_RNN' | 'SEQUENCE_TRANSFORMER') {
  return {
    contractVersion: 'recommendation-behavioral-training-launch-v1' as const,
    family,
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
    attentionHeads: family === 'SEQUENCE_TRANSFORMER' ? 8 : undefined,
    dropout: 0.1,
    earlyStoppingPatience: 4,
    supportProbabilityThreshold: 0.001,
    majorCohortMinDecisions: 100,
    majorCohortMinFraction: 0.01,
    gateMinDecisions: 10_000,
    gateMinCandidateCoverage: 0.99,
    gateMinSupport: 0.9,
    gateMinMajorCohortSupport: 0.75,
    gateMaxFloorSensitivity: 0.01,
  };
}

function currentDataGates() {
  return {
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-08-01T00:00:00.000Z',
    candidateGeneratorVersion: 'candidate-v8',
    directShopSourceApprovalKeys: ['OVERWOLF_GEP:onInfoUpdates2|match_info|match_info|shop_state'],
    directShopSourceValidationSubjectSha256: 'd'.repeat(64),
    directShopSourceValidation: 'PASS' as const,
    controlledSoulsValidation: 'PASS' as const,
    observabilityPassed: true,
    datasetStructuralPassed: true,
    datasetEmpiricalPassed: true,
    explicitFeasibilityCoverage: 0.997,
    observedActionFeasibleCoverage: 0.995,
    minimumMajorActionPhaseCohortObservedActionFeasibleCoverage: 0.985,
    rulesetEvidenceCoverage: 0.9995,
  };
}

function preflight(family: string, overrides: Record<string, unknown> = {}) {
  return {
    ready: true,
    datasetId: 'dataset-v8-final',
    datasetSha256: DATASET_SHA,
    manifestSha256: MANIFEST_SHA,
    objectBaseUri: 's3://immutable/dataset-v8-final',
    datasetRegistryStatus: 'VERIFIED' as const,
    training: {
      ready: true,
      blockers: [],
      family,
    },
    currentDataGates: currentDataGates(),
    blockers: [],
    ...overrides,
  };
}

function roadmapEvidence(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

function runner(overrides: Record<string, unknown> = {}) {
  return {
    expectedDatasetSha256: DATASET_SHA,
    expectedManifestSha256: MANIFEST_SHA,
    sourceCommitSha: SOURCE_COMMIT_SHA,
    splitIsolationPassed: true,
    immutableDatasetBytesVerified: true,
    offlineWheelhouseReady: true,
    trainingDeviceReady: true,
    ...overrides,
  };
}

function harness(options: {
  rnnPreflight?: Record<string, unknown>;
  transformerPreflight?: Record<string, unknown>;
  roadmap?: Record<string, unknown>;
} = {}) {
  const trainingLaunch = {
    preflight: jest.fn(async (_datasetId: string, trainingConfig: { family: string }) => (
      trainingConfig.family === 'SEQUENCE_RNN'
        ? preflight(trainingConfig.family, options.rnnPreflight)
        : preflight(trainingConfig.family, options.transformerPreflight)
    )),
  };
  const datasetRegistry = {
    getVerified: jest.fn(async () => ({
      datasetId: 'dataset-v8-final',
      datasetSha256: DATASET_SHA,
      manifestSha256: MANIFEST_SHA,
      manifest: {
        sourceCommitSha: SOURCE_COMMIT_SHA,
        splits: [
          { split: 'SHADOW_HOLDOUT', decisionCount: 10_000 },
        ],
      },
    })),
  };
  const roadmap = {
    report: jest.fn(async () => ({ evidence: roadmapEvidence(options.roadmap) })),
  };
  const service = new RecommendationPretrainingFinalReadinessV8Service(
    trainingLaunch as never,
    datasetRegistry as never,
    roadmap as never,
  );
  return { service, trainingLaunch, datasetRegistry, roadmap };
}

describe('RecommendationPretrainingFinalReadinessV8Service', () => {
  it('authorizes training only when server and protected-runner evidence agree', async () => {
    const { service } = harness();

    const result = await service.evaluate('dataset-v8-final', {
      rnnConfig: config('SEQUENCE_RNN'),
      transformerConfig: config('SEQUENCE_TRANSFORMER'),
      runner: runner(),
    });

    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.finalReadiness.readyToStartBehavioralTraining).toBe(true);
    expect(result.pairValidation.valid).toBe(true);
    expect(result.readinessSubjectSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.trainingPerformed).toBe(false);
    expect(result.futureTestEvaluated).toBe(false);
  });

  it('blocks a training pair whose observable contract differs between architectures', async () => {
    const { service } = harness();
    const transformer = {
      ...config('SEQUENCE_TRANSFORMER'),
      maximumHistoryEvents: 32,
    };

    const result = await service.evaluate('dataset-v8-final', {
      rnnConfig: config('SEQUENCE_RNN'),
      transformerConfig: transformer,
      runner: runner(),
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('EQUAL_OBSERVABLES_CONFIG_MISMATCH:maximumHistoryEvents');
  });

  it('blocks when the immutable dataset source commit is not the checked-out training commit', async () => {
    const { service } = harness();

    const result = await service.evaluate('dataset-v8-final', {
      rnnConfig: config('SEQUENCE_RNN'),
      transformerConfig: config('SEQUENCE_TRANSFORMER'),
      runner: runner({ sourceCommitSha: 'e'.repeat(40) }),
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('RUNNER_SOURCE_COMMIT_MISMATCH');
  });

  it('blocks when the protected runner has not proved the training device is ready', async () => {
    const { service } = harness();

    const result = await service.evaluate('dataset-v8-final', {
      rnnConfig: config('SEQUENCE_RNN'),
      transformerConfig: config('SEQUENCE_TRANSFORMER'),
      runner: runner({ trainingDeviceReady: false }),
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('TRAINING_DEVICE_NOT_READY');
  });

  it('preserves detailed model preflight blockers and fails the final gate', async () => {
    const { service } = harness({
      rnnPreflight: {
        ready: false,
        blockers: ['CURRENT_DATASET_EMPIRICAL:DECISION_COUNT_BELOW_10000'],
      },
    });

    const result = await service.evaluate('dataset-v8-final', {
      rnnConfig: config('SEQUENCE_RNN'),
      transformerConfig: config('SEQUENCE_TRANSFORMER'),
      runner: runner(),
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('RNN_API_PREFLIGHT_NOT_READY');
    expect(result.blockers).toContain('RNN_PREFLIGHT:CURRENT_DATASET_EMPIRICAL:DECISION_COUNT_BELOW_10000');
  });

  it('blocks any readiness evaluation after FUTURE_TEST has been evaluated', async () => {
    const { service } = harness({ roadmap: { futureTestEvaluation: 'PASS' } });

    const result = await service.evaluate('dataset-v8-final', {
      rnnConfig: config('SEQUENCE_RNN'),
      transformerConfig: config('SEQUENCE_TRANSFORMER'),
      runner: runner(),
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('FUTURE_TEST_ALREADY_EVALUATED');
  });
});
