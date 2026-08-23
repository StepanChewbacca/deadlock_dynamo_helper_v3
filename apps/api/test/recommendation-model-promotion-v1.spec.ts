import { RecommendationModelPromotionV1Service } from '../src/deadlock-live/recommendation-model-promotion-v1.service';

const manifestSha256 = 'a'.repeat(64);
const evidenceSha256 = 'b'.repeat(64);

function record(gateName: string, subjectSha256 = evidenceSha256) {
  return {
    gateName,
    status: 'PASS',
    evaluator: 'recommendation-advanced-evidence-v8',
    subjectSha256,
  };
}

function harness(modelKind: 'BEHAVIORAL' | 'VALUE' | 'POLICY', options: { futureTest?: boolean } = {}) {
  const registry = {
    getVerified: jest.fn(async () => ({
      modelId: 'model-1',
      modelVersion: 'v1',
      manifestSha256,
      manifest: { modelKind },
    })),
    activate: jest.fn(async (input) => ({ status: 'ACTIVE', ...input })),
  };
  const latestEvidenceByGate: Record<string, unknown> = {};
  if (modelKind === 'BEHAVIORAL') latestEvidenceByGate.behavioralOffline = record('behavioralOffline');
  if (modelKind === 'VALUE') latestEvidenceByGate.causalValueRelease = record('causalValueRelease');
  if (modelKind === 'POLICY') latestEvidenceByGate.policyAbRelease = record('policyAbRelease');
  if (options.futureTest) {
    latestEvidenceByGate.futureTestEvaluation = {
      status: 'PASS',
      evaluator: 'recommendation-future-test-evaluator-v1',
      subjectSha256: manifestSha256,
    };
  }
  const roadmapEvidence = {
    report: jest.fn(async () => ({
      evidence: { futureTestUntouched: true },
      latestEvidenceByGate,
    })),
  };
  const report = modelKind === 'BEHAVIORAL'
    ? { manifestSha256 }
    : modelKind === 'VALUE'
      ? { model: { manifestSha256 } }
      : { policy: { manifestSha256 } };
  const snapshotRepo = {
    findOne: jest.fn(async () => ({
      subjectSha256: evidenceSha256,
      gateName: modelKind === 'BEHAVIORAL'
        ? 'behavioralOffline'
        : modelKind === 'VALUE'
          ? 'causalValueRelease'
          : 'policyAbRelease',
      evaluator: 'recommendation-advanced-evidence-v8',
      report,
    })),
  };
  const service = new RecommendationModelPromotionV1Service(
    snapshotRepo as never,
    registry as never,
    roadmapEvidence as never,
  );
  return { service, registry, roadmapEvidence, snapshotRepo, latestEvidenceByGate };
}

const input = {
  modelId: 'model-1',
  modelVersion: 'v1',
  runtime: {} as never,
};

describe('RecommendationModelPromotionV1Service', () => {
  it('activates Behavioral only when immutable behavioralOffline evidence names the exact manifest', async () => {
    const { service, registry } = harness('BEHAVIORAL');

    await expect(service.promote(input)).resolves.toEqual(expect.objectContaining({ status: 'ACTIVE' }));
    expect(registry.activate).toHaveBeenCalledWith(input);
  });

  it('blocks Value activation when causal Value release snapshot names another model', async () => {
    const { service, snapshotRepo, registry } = harness('VALUE');
    snapshotRepo.findOne.mockResolvedValueOnce({
      subjectSha256: evidenceSha256,
      gateName: 'causalValueRelease',
      evaluator: 'recommendation-advanced-evidence-v8',
      report: { model: { manifestSha256: 'c'.repeat(64) } },
    });

    await expect(service.promote(input)).rejects.toThrow('MODEL_PROMOTION_CAUSALVALUERELEASE_MODEL_MISMATCH');
    expect(registry.activate).not.toHaveBeenCalled();
  });

  it('blocks Policy activation before a matching one-shot FUTURE_TEST PASS', async () => {
    const { service, registry } = harness('POLICY');

    await expect(service.promote(input)).rejects.toThrow('POLICY_ACTIVATION_REQUIRES_MATCHING_FUTURE_TEST_PASS');
    expect(registry.activate).not.toHaveBeenCalled();
  });

  it('activates Policy only after policy A/B release and matching FUTURE_TEST PASS', async () => {
    const { service, registry } = harness('POLICY', { futureTest: true });

    await expect(service.promote(input)).resolves.toEqual(expect.objectContaining({ status: 'ACTIVE' }));
    expect(registry.activate).toHaveBeenCalledWith(input);
  });

  it('blocks every promotion after a FUTURE_TEST integrity violation', async () => {
    const { service, roadmapEvidence, registry } = harness('BEHAVIORAL');
    roadmapEvidence.report.mockResolvedValueOnce({
      evidence: { futureTestUntouched: false },
      latestEvidenceByGate: {},
    });

    await expect(service.promote(input)).rejects.toThrow('FUTURE_TEST_INTEGRITY_VIOLATION');
    expect(registry.activate).not.toHaveBeenCalled();
  });
});
