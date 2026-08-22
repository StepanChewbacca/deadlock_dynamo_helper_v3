import { MODEL_BUNDLE_CONTRACT_VERSION } from '@deadlock-live-probe/shared';
import { RecommendationPolicyBuildV1Service } from '../src/deadlock-live/recommendation-policy-build-v1.service';

const behavioralManifestSha256 = 'a'.repeat(64);
const valueManifestSha256 = 'b'.repeat(64);
const behavioralEvidenceSha256 = 'c'.repeat(64);
const valueEvidenceSha256 = 'd'.repeat(64);

function manifest(kind: 'BEHAVIORAL' | 'VALUE', modelId: string, modelVersion: string) {
  return {
    contractVersion: MODEL_BUNDLE_CONTRACT_VERSION,
    modelId,
    modelVersion,
    modelKind: kind,
    createdAt: '2026-08-22T00:00:00.000Z',
    sourceCommitSha: '1'.repeat(40),
    datasetId: `${kind.toLowerCase()}-dataset`,
    datasetSha256: kind === 'BEHAVIORAL' ? '2'.repeat(64) : '3'.repeat(64),
    featureContractVersion: 'recommendation-features-v8',
    actionContractVersion: 'recommendation-actions-v1',
    candidateGeneratorVersion: 'candidate-v8',
    supportedRulesetVersions: ['ruleset-v1'],
    supportedCatalogSha256: ['4'.repeat(64)],
    trainingConfigSha256: '5'.repeat(64),
    files: [{ path: 'model.bin', sha256: '6'.repeat(64), sizeBytes: 10 }],
    gates: [{ name: 'FUTURE_TEST_UNTOUCHED', status: 'PASS' as const }],
    futureTestEvaluated: false,
  };
}

function createService(valueEvidenceManifestSha = valueManifestSha256) {
  const snapshots = {
    findOne: jest.fn(async ({ where }: any) => {
      if (where.subjectSha256 === behavioralEvidenceSha256) {
        return {
          subjectSha256: behavioralEvidenceSha256,
          gateName: 'behavioralOffline',
          evaluator: 'recommendation-advanced-evidence-v8',
          report: { manifestSha256: behavioralManifestSha256 },
        };
      }
      if (where.subjectSha256 === valueEvidenceSha256) {
        return {
          subjectSha256: valueEvidenceSha256,
          gateName: 'causalValueRelease',
          evaluator: 'recommendation-advanced-evidence-v8',
          report: { model: { manifestSha256: valueEvidenceManifestSha } },
        };
      }
      return undefined;
    }),
  };
  const registry = {
    getVerified: jest.fn(async (modelId: string) => modelId === 'behavioral-v8'
      ? {
          status: 'VERIFIED',
          manifestSha256: behavioralManifestSha256,
          manifest: manifest('BEHAVIORAL', 'behavioral-v8', 'b1'),
        }
      : {
          status: 'VERIFIED',
          manifestSha256: valueManifestSha256,
          manifest: manifest('VALUE', 'value-v8', 'v1'),
        }),
  };
  const roadmap = {
    report: jest.fn(async () => ({
      evidence: { futureTestUntouched: true, futureTestEvaluation: 'NOT_EVALUATED' },
      state: { phases: [{ phase: 'CAUSAL_VALUE', unlocked: true, blockers: [] }] },
      latestEvidenceByGate: {
        behavioralOffline: { status: 'PASS', subjectSha256: behavioralEvidenceSha256 },
        causalValueRelease: { status: 'PASS', subjectSha256: valueEvidenceSha256 },
      },
    })),
  };
  return new RecommendationPolicyBuildV1Service(snapshots as never, registry as never, roadmap as never);
}

describe('RecommendationPolicyBuildV1Service', () => {
  it('builds an immutable support-constrained POLICY bundle from the exact released upstream models', async () => {
    const service = createService();

    const result = await service.build({
      modelId: 'deadlock-policy-v1',
      modelVersion: 'p1',
      sourceCommitSha: '7'.repeat(40),
      behavioralModelId: 'behavioral-v8',
      behavioralModelVersion: 'b1',
      valueModelId: 'value-v8',
      valueModelVersion: 'v1',
      policyConfig: {
        temperature: 1,
        behaviorRegularization: 0.1,
        minimumBehaviorSupport: 0.01,
      },
    });

    expect(result.ready).toBe(true);
    expect(result.manifest.modelKind).toBe('POLICY');
    expect(result.manifest.futureTestEvaluated).toBe(false);
    expect(result.policyArtifact.behavioral.manifestSha256).toBe(behavioralManifestSha256);
    expect(result.policyArtifact.value.manifestSha256).toBe(valueManifestSha256);
    expect(result.policyArtifact.policyConfig.minimumBehaviorSupport).toBe(0.01);
    expect(result.policyArtifactContent.endsWith('\n')).toBe(true);
    expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a VALUE dependency different from the model that passed causal Value release', async () => {
    const service = createService('f'.repeat(64));

    await expect(service.build({
      modelId: 'deadlock-policy-v1',
      modelVersion: 'p1',
      sourceCommitSha: '7'.repeat(40),
      behavioralModelId: 'behavioral-v8',
      behavioralModelVersion: 'b1',
      valueModelId: 'value-v8',
      valueModelVersion: 'v1',
      policyConfig: {
        temperature: 1,
        behaviorRegularization: 0.1,
        minimumBehaviorSupport: 0.01,
      },
    })).rejects.toThrow('POLICY_BUILD_CAUSALVALUERELEASE_MODEL_MISMATCH');
  });
});
