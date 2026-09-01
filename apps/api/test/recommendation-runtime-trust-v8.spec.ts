import { RecommendationRuntimeTrustV8Service } from '../src/deadlock-live/recommendation-runtime-trust-v8.service';

describe('RecommendationRuntimeTrustV8Service', () => {
  function roadmap(overrides: Record<string, unknown> = {}) {
    return {
      evidence: {
        observabilityCoverage: 'PASS',
        shadowSafety: 'PASS',
        matchLevelAbSafety: 'PASS',
        futureTestEvaluation: 'NOT_EVALUATED',
        futureTestUntouched: true,
        ...overrides,
      },
    };
  }

  function harness(overrides: Record<string, unknown> = {}) {
    const roadmapEvidence = { report: jest.fn(async () => roadmap(overrides)) };
    return {
      service: new RecommendationRuntimeTrustV8Service(roadmapEvidence as never),
      roadmapEvidence,
    };
  }

  it('resolves observability and shadow gates only from server-owned roadmap evidence', async () => {
    const { service } = harness({ observabilityCoverage: 'FAIL', shadowSafety: 'INSUFFICIENT_EVIDENCE' });

    const result = await service.resolve({ runtimeMode: 'SHADOW', selectionMode: 'DETERMINISTIC' });

    expect(result.observabilityGatePassed).toBe(false);
    expect(result.shadowGatePassed).toBe(false);
    expect(result.safeExplorationAuthorized).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('authorizes safe exploration only after match-level A/B and before FUTURE_TEST', async () => {
    const { service } = harness();

    const result = await service.resolve({ runtimeMode: 'LIVE', selectionMode: 'SAFE_EXPLORATION' });

    expect(result.safeExplorationAuthorized).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('blocks safe exploration in shadow mode or without match-level A/B evidence', async () => {
    const { service } = harness({ matchLevelAbSafety: 'NOT_EVALUATED' });

    const result = await service.resolve({ runtimeMode: 'SHADOW', selectionMode: 'SAFE_EXPLORATION' });

    expect(result.safeExplorationAuthorized).toBe(false);
    expect(result.blockers).toEqual([
      'SAFE_EXPLORATION_REQUIRES_LIVE_RUNTIME',
      'SAFE_EXPLORATION_REQUIRES_MATCH_LEVEL_AB_PASS',
    ]);
  });

  it('permanently blocks exploration after FUTURE_TEST evaluation begins', async () => {
    const { service } = harness({ futureTestEvaluation: 'PASS' });

    const result = await service.resolve({ runtimeMode: 'LIVE', selectionMode: 'SAFE_EXPLORATION' });

    expect(result.safeExplorationAuthorized).toBe(false);
    expect(result.blockers).toContain('SAFE_EXPLORATION_FORBIDDEN_AFTER_FUTURE_TEST');
  });
});
