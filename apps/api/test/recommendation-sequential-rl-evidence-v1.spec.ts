import { createHash } from 'crypto';
import {
  RECOMMENDATION_SEQUENTIAL_RL_EVIDENCE_V1,
  RECOMMENDATION_SEQUENTIAL_RL_EVALUATOR_V1,
} from '@deadlock-live-probe/shared';
import { RecommendationSequentialRlEvidenceV1Service } from '../src/deadlock-live/recommendation-sequential-rl-evidence-v1.service';

const policyManifestSha256 = 'a'.repeat(64);

function report(overrides: Record<string, unknown> = {}) {
  return {
    transitionCount: 100,
    matchCount: 10,
    terminalTransitionCount: 10,
    invalidTransitionIds: [],
    futureLeakageTransitionIds: [],
    rulesetMismatchTransitionIds: [],
    reconstructedPropensityTransitionIds: [],
    canRunSequentialRlResearch: true,
    ...overrides,
  };
}

function attestation(reportValue = report()) {
  return {
    contractVersion: RECOMMENDATION_SEQUENTIAL_RL_EVIDENCE_V1,
    evaluator: RECOMMENDATION_SEQUENTIAL_RL_EVALUATOR_V1,
    policyModelId: 'policy-v1',
    policyModelVersion: 'frozen-1',
    policyManifestSha256,
    transitionArtifactSha256: 'b'.repeat(64),
    transitionArtifactRef: 'immutable://sequential/transitions.jsonl',
    transitionReportSha256: sha256Canonical(reportValue),
    evaluatedAt: '2026-08-23T12:00:00.000Z',
    researchOnly: true as const,
    futureTestUsedForModelSelection: false as const,
    report: reportValue,
  };
}

function harness(options: { futureTestStatus?: 'PASS' | 'FAIL'; policySha?: string } = {}) {
  const snapshots = new Map<string, any>();
  const snapshotRepo = {
    findOne: jest.fn(async ({ where }: any) => snapshots.get(where.subjectSha256)),
    create: jest.fn((value: any) => value),
    save: jest.fn(async (value: any) => {
      snapshots.set(value.subjectSha256, value);
      return value;
    }),
  };
  const modelRegistry = {
    getVerified: jest.fn(async () => ({
      manifestSha256: options.policySha ?? policyManifestSha256,
      manifest: { modelKind: 'POLICY' },
    })),
  };
  const futureTestStatus = options.futureTestStatus ?? 'PASS';
  const roadmapEvidence = {
    report: jest.fn(async () => ({
      evidence: {
        futureTestUntouched: true,
        futureTestEvaluation: futureTestStatus,
        policyAbRelease: 'PASS',
      },
      latestEvidenceByGate: {
        policyAbRelease: { status: 'PASS' },
        futureTestEvaluation: {
          status: futureTestStatus,
          evaluator: 'recommendation-future-test-evaluator-v1',
          subjectSha256: policyManifestSha256,
        },
      },
    })),
    append: jest.fn(async () => ({ status: 'APPENDED' as const })),
  };
  const service = new RecommendationSequentialRlEvidenceV1Service(
    snapshotRepo as never,
    modelRegistry as never,
    roadmapEvidence as never,
  );
  return { service, snapshotRepo, modelRegistry, roadmapEvidence, snapshots };
}

describe('RecommendationSequentialRlEvidenceV1Service', () => {
  it('materializes PASS only after the matching one-shot FUTURE_TEST PASS', async () => {
    const { service, roadmapEvidence, snapshots } = harness();

    const result = await service.materialize(attestation() as never);

    expect(result.report.status).toBe('PASS');
    expect(result.report.policyManifestSha256).toBe(policyManifestSha256);
    expect(result.snapshotSubjectSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshots.get(result.snapshotSubjectSha256)?.gateName).toBe('sequentialRlResearchGate');
    expect(roadmapEvidence.append).toHaveBeenCalledWith(expect.objectContaining({
      gateName: 'sequentialRlResearchGate',
      status: 'PASS',
      evaluator: RECOMMENDATION_SEQUENTIAL_RL_EVALUATOR_V1,
      subjectSha256: policyManifestSha256,
    }));
  });

  it('blocks the research gate before FUTURE_TEST passes', async () => {
    const { service, roadmapEvidence } = harness({ futureTestStatus: 'FAIL' });

    await expect(service.materialize(attestation() as never))
      .rejects.toThrow('SEQUENTIAL_RL_REQUIRES_MATCHING_FUTURE_TEST_PASS');
    expect(roadmapEvidence.append).not.toHaveBeenCalled();
  });

  it('blocks a report whose canonical SHA does not match the submitted identity', async () => {
    const { service, roadmapEvidence } = harness();
    const input = { ...attestation(), transitionReportSha256: 'f'.repeat(64) };

    await expect(service.materialize(input as never))
      .rejects.toThrow('SEQUENTIAL_RL_TRANSITION_REPORT_SHA256_MISMATCH');
    expect(roadmapEvidence.append).not.toHaveBeenCalled();
  });

  it('records FAIL rather than fabricating PASS when sequential transitions leak future state', async () => {
    const { service, roadmapEvidence } = harness();
    const failedReport = report({
      futureLeakageTransitionIds: ['transition-1'],
      canRunSequentialRlResearch: false,
    });

    const result = await service.materialize(attestation(failedReport) as never);

    expect(result.report.status).toBe('FAIL');
    expect(result.report.blockers).toContain('SEQUENTIAL_FUTURE_LEAKAGE_PRESENT');
    expect(roadmapEvidence.append).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAIL' }));
  });
});

function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
