import {
  RECOMMENDATION_FUTURE_TEST_EVALUATION_V1,
  RECOMMENDATION_FUTURE_TEST_EVALUATOR_V1,
  RECOMMENDATION_ROADMAP_EVIDENCE_VERSION,
} from '@deadlock-live-probe/shared';
import { RecommendationFutureTestEvaluationV1Service } from '../src/deadlock-live/recommendation-future-test-evaluation-v1.service';
import { RecommendationRoadmapEvidenceService } from '../src/deadlock-live/recommendation-roadmap-evidence.service';

describe('FUTURE_TEST final evaluation control plane', () => {
  const policyManifestSha256 = 'a'.repeat(64);
  const artifact = {
    contractVersion: RECOMMENDATION_FUTURE_TEST_EVALUATION_V1,
    policyModelId: 'deadlock-policy-v1',
    policyModelVersion: 'policy-frozen-1',
    policyManifestSha256,
    evaluationPlanSha256: 'b'.repeat(64),
    evaluationArtifactSha256: 'c'.repeat(64),
    evaluationArtifactRef: 's3://deadlock-immutable/future-test/evaluation-1.json',
    evaluatedAt: '2026-08-22T00:00:00.000Z',
    gateStatus: 'PASS' as const,
    modelSelectionFrozen: true as const,
    hyperparametersFrozen: true as const,
    candidateGeneratorFrozen: true as const,
    featureContractFrozen: true as const,
    futureTestAccessCount: 1 as const,
  };

  it('rejects direct FUTURE_TEST evidence that did not come from the frozen-artifact evaluator', async () => {
    const repo = {
      findOne: jest.fn(async () => undefined),
    };
    const service = new RecommendationRoadmapEvidenceService(repo as never);

    await expect(service.append({
      contractVersion: RECOMMENDATION_ROADMAP_EVIDENCE_VERSION,
      evidenceId: `manual:${policyManifestSha256}`,
      gateName: 'futureTestEvaluation',
      status: 'PASS',
      evidenceRef: 'manual://not-allowed',
      evaluator: 'manual',
      evaluatedAt: artifact.evaluatedAt,
      subjectSha256: policyManifestSha256,
    })).rejects.toThrow('FUTURE_TEST_EVALUATION_REQUIRES_FROZEN_ARTIFACT_EVALUATOR');
  });

  it('materializes the one-time final evaluation only for the exact verified frozen POLICY bundle', async () => {
    const snapshotRepo = {
      findOne: jest.fn(async () => undefined),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const modelRegistry = {
      getVerified: jest.fn(async () => ({
        manifestSha256: policyManifestSha256,
        status: 'VERIFIED',
        verifiedAt: new Date('2026-08-21T23:00:00.000Z'),
        manifest: {
          modelKind: 'POLICY',
          futureTestEvaluated: false,
        },
      })),
    };
    const roadmapEvidence = {
      report: jest.fn(async () => ({
        evidence: {
          futureTestUntouched: true,
          futureTestEvaluation: 'NOT_EVALUATED',
          policyAbRelease: 'PASS',
        },
        state: {
          phases: [{ phase: 'POLICY_V1', unlocked: true, blockers: [] }],
        },
      })),
      append: jest.fn(async () => ({ status: 'APPENDED', evidenceId: 'future-test-evidence' })),
    };
    const service = new RecommendationFutureTestEvaluationV1Service(
      snapshotRepo as never,
      modelRegistry as never,
      roadmapEvidence as never,
    );

    const result = await service.materialize(artifact);

    expect(result.status).toBe('PASS');
    expect(result.policyManifestSha256).toBe(policyManifestSha256);
    expect(snapshotRepo.save).toHaveBeenCalledTimes(1);
    expect(roadmapEvidence.append).toHaveBeenCalledWith(expect.objectContaining({
      gateName: 'futureTestEvaluation',
      status: 'PASS',
      evaluator: RECOMMENDATION_FUTURE_TEST_EVALUATOR_V1,
      subjectSha256: policyManifestSha256,
    }));
  });

  it('rejects a final evaluation that targets a different policy manifest SHA', async () => {
    const snapshotRepo = { findOne: jest.fn() };
    const modelRegistry = {
      getVerified: jest.fn(async () => ({
        manifestSha256: 'd'.repeat(64),
        status: 'VERIFIED',
        verifiedAt: new Date('2026-08-21T23:00:00.000Z'),
        manifest: { modelKind: 'POLICY', futureTestEvaluated: false },
      })),
    };
    const roadmapEvidence = { report: jest.fn() };
    const service = new RecommendationFutureTestEvaluationV1Service(
      snapshotRepo as never,
      modelRegistry as never,
      roadmapEvidence as never,
    );

    await expect(service.materialize(artifact)).rejects.toThrow(
      'FUTURE_TEST policy manifest SHA does not match the verified registry artifact',
    );
  });
});
