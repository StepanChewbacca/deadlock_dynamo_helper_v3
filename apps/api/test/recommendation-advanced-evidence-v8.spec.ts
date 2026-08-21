import { RecommendationAdvancedEvidenceV8Service } from '../src/deadlock-live/recommendation-advanced-evidence-v8.service';

function snapshotRepo() {
  const rows = new Map<string, any>();
  return {
    rows,
    findOne: jest.fn(async ({ where }: any) => rows.get(where.subjectSha256)),
    create: jest.fn((value: any) => value),
    save: jest.fn(async (value: any) => {
      rows.set(value.subjectSha256, value);
      return value;
    }),
  };
}

function roadmapEvidence() {
  return {
    append: jest.fn(async (record: any) => ({ status: 'APPENDED' as const, evidenceId: record.evidenceId })),
  };
}

function modelBundle(kind: 'BEHAVIORAL' | 'VALUE', gates: any[]) {
  return {
    status: 'VERIFIED',
    manifestSha256: 'a'.repeat(64),
    verifiedAt: new Date('2026-08-22T00:00:00.000Z'),
    manifest: {
      modelKind: kind,
      futureTestEvaluated: false,
      gates,
    },
  };
}

const behavioralGates = [
  'BEHAVIORAL_OFFLINE',
  'BEHAVIORAL_SUPPORT',
  'BEHAVIORAL_MAJOR_COHORT_SUPPORT',
  'BEHAVIORAL_CANDIDATE_COVERAGE',
  'BEHAVIORAL_ILLEGAL_CANDIDATE_RATE',
  'NO_PROBABILITY_FLOOR',
  'RNN_TRANSFORMER_ABLATION',
  'FUTURE_TEST_UNTOUCHED',
].map((name) => ({ name, status: 'PASS' }));

function createService(overrides: {
  model?: any;
  shadow?: any;
  ab?: any;
  ope?: any;
} = {}) {
  const snapshots = snapshotRepo();
  const roadmap = roadmapEvidence();
  const modelRegistry = { getVerified: jest.fn(async () => overrides.model ?? modelBundle('BEHAVIORAL', behavioralGates)) };
  const shadowReports = { buildReport: jest.fn(async () => overrides.shadow) };
  const abReports = { buildReport: jest.fn(async () => overrides.ab) };
  const opeReports = { buildReport: jest.fn(async () => overrides.ope) };
  const service = new RecommendationAdvancedEvidenceV8Service(
    snapshots as never,
    modelRegistry as never,
    shadowReports as never,
    abReports as never,
    opeReports as never,
    roadmap as never,
  );
  return { service, snapshots, roadmap, modelRegistry };
}

describe('RecommendationAdvancedEvidenceV8Service', () => {
  it('materializes Behavioral PASS only from a verified bundle with every required gate', async () => {
    const { service, roadmap } = createService();

    const result = await service.materializeBehavioralModel('buildlm', 'v1');

    expect(result.gateName).toBe('behavioralOffline');
    expect(result.status).toBe('PASS');
    expect(result.subjectSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(roadmap.append).toHaveBeenCalledWith(expect.objectContaining({
      gateName: 'behavioralOffline',
      status: 'PASS',
      evaluator: 'recommendation-advanced-evidence-v8',
    }));
  });

  it('never fabricates Behavioral PASS when required immutable gate evidence is missing', async () => {
    const missingGateModel = modelBundle('BEHAVIORAL', behavioralGates.slice(0, -1));
    const { service } = createService({ model: missingGateModel });

    const result = await service.materializeBehavioralModel('buildlm', 'v1');

    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('materializes shadow as insufficient when live decisions or health evidence are absent', async () => {
    const { service } = createService({
      shadow: {
        generatedAt: '2026-08-22T00:00:00.000Z',
        evidenceSufficient: false,
        evidenceBlockers: ['NO_SHADOW_DECISIONS'],
        runtimeHealthEventCount: 0,
        rejectionCount: 0,
        acceptedTelemetryCount: 0,
        metrics: {},
      },
    });

    const result = await service.materializeShadow();

    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.gateName).toBe('shadowSafety');
  });

  it('materializes exact action propensity only when experiment evidence is complete and rate is one', async () => {
    const { service } = createService({
      ab: {
        generatedAt: '2026-08-22T00:00:00.000Z',
        experimentId: 'safe-exp',
        controlArm: 'control',
        treatmentArm: 'treatment',
        reward: 'economyDelta120s',
        matchCount: 1000,
        decisionCount: 100000,
        controlMatchCount: 500,
        treatmentMatchCount: 500,
        runtimeHealthCoverage: 1,
        abandonmentCoverage: 1,
        evidenceSufficient: true,
        blockers: [],
        metrics: { exactLoggedPropensityRate: 1 },
        gate: { passed: true, checks: [] },
      },
    });

    const results = await service.materializeExperiment({
      experimentId: 'safe-exp',
      controlArm: 'control',
      treatmentArm: 'treatment',
      reward: 'economyDelta120s',
      gateName: 'safeExplorationSafety',
    });

    expect(results.map((entry) => [entry.gateName, entry.status])).toEqual([
      ['safeExplorationSafety', 'PASS'],
      ['exactActionPropensity', 'PASS'],
    ]);
  });

  it('keeps OPE blocked when randomized evidence is incomplete', async () => {
    const { service } = createService({
      ope: {
        generatedAt: '2026-08-22T00:00:00.000Z',
        reward: 'economyDelta120s',
        randomizedDecisionCount: 0,
        outcomeDecisionCount: 0,
        evaluableDecisionCount: 0,
        excludedDecisionCount: 0,
        evidenceSufficient: false,
        blockers: ['NO_RANDOMIZED_DECISIONS'],
      },
    });

    const result = await service.materializeOpe({ reward: 'economyDelta120s' });

    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('materializes causal Value PASS only when verified action evidence and positive DR uplift CI pass', async () => {
    const valueModel = modelBundle('VALUE', [
      { name: 'VALUE_ACTION_SENSITIVITY', status: 'PASS' },
      { name: 'STATE_ONLY_ABLATION', status: 'PASS' },
      { name: 'CANDIDATE_PERMUTATION', status: 'PASS' },
      { name: 'ACTION_RESIDUAL_VARIANCE', status: 'PASS', value: 0.02 },
      { name: 'ILLEGAL_CANDIDATE_RATE', status: 'PASS', value: 0 },
    ]);
    const { service } = createService({
      model: valueModel,
      ope: {
        generatedAt: '2026-08-22T00:00:00.000Z',
        reward: 'economyDelta120s',
        randomizedDecisionCount: 5000,
        outcomeDecisionCount: 5000,
        evaluableDecisionCount: 5000,
        excludedDecisionCount: 0,
        evidenceSufficient: true,
        blockers: [],
        evaluation: {
          passedSupportGate: true,
          doublyRobustUplift: 0.03,
          doublyRobustUpliftCiLow: 0.01,
          doublyRobustUpliftCiHigh: 0.05,
          effectiveSampleSize: 2500,
        },
      },
    });

    const results = await service.materializeCausalValue({
      modelId: 'value',
      modelVersion: 'v1',
      reward: 'economyDelta120s',
    });

    expect(results.map((entry) => [entry.gateName, entry.status])).toEqual([
      ['valueActionSensitivity', 'PASS'],
      ['offPolicySupport', 'PASS'],
      ['causalValueRelease', 'PASS'],
    ]);
  });

  it('does not pass causal Value release when the DR uplift interval crosses zero', async () => {
    const valueModel = modelBundle('VALUE', [
      { name: 'VALUE_ACTION_SENSITIVITY', status: 'PASS' },
      { name: 'STATE_ONLY_ABLATION', status: 'PASS' },
      { name: 'CANDIDATE_PERMUTATION', status: 'PASS' },
      { name: 'ACTION_RESIDUAL_VARIANCE', status: 'PASS', value: 0.02 },
      { name: 'ILLEGAL_CANDIDATE_RATE', status: 'PASS', value: 0 },
    ]);
    const { service } = createService({
      model: valueModel,
      ope: {
        generatedAt: '2026-08-22T00:00:00.000Z',
        reward: 'economyDelta120s',
        randomizedDecisionCount: 5000,
        outcomeDecisionCount: 5000,
        evaluableDecisionCount: 5000,
        excludedDecisionCount: 0,
        evidenceSufficient: true,
        blockers: [],
        evaluation: {
          passedSupportGate: true,
          doublyRobustUplift: 0.01,
          doublyRobustUpliftCiLow: -0.01,
          doublyRobustUpliftCiHigh: 0.03,
          effectiveSampleSize: 2500,
        },
      },
    });

    const results = await service.materializeCausalValue({
      modelId: 'value',
      modelVersion: 'v1',
      reward: 'economyDelta120s',
    });

    expect(results.find((entry) => entry.gateName === 'causalValueRelease')?.status).toBe('FAIL');
  });
});
