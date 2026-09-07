import { AdaptivePlannerServingRouterV1Service } from '../src/statlocker-adaptive/adaptive-planner-serving-router-v1.service';

describe('transaction plan serving', () => {
  it('serves the canonical strategy result in every configured mode', () => {
    const strategy = { plan: jest.fn(() => ({ nextAction: { type: 'REPLACE', actionKey: 'replace', reasonCodes: [] }, recommendedBuild: [], changes: [], rankedImmediateCandidates: [], totalScore: 1, confidence: 1, plannerVersion: 'strategy-first' })) } as any;
    const router = new AdaptivePlannerServingRouterV1Service(strategy, {} as any, {} as any, {} as any, {} as any);
    expect(router.plan({ decision: { state: { decisionId: 'd' }, stateRevision: 'r', economyRulesEvidence: 'UNKNOWN' } } as any).nextAction.type).toBe('REPLACE');
    expect(strategy.plan).toHaveBeenCalledTimes(1);
  });

  it('surfaces strategy failure instead of silently serving a flat fallback', () => {
    const router = new AdaptivePlannerServingRouterV1Service({ plan: jest.fn(() => { throw new Error('unavailable'); }) } as any, {} as any, {} as any, {} as any, {} as any);
    expect(() => router.plan({ decision: { state: { decisionId: 'd' }, stateRevision: 'r', economyRulesEvidence: 'RECONSTRUCTED' } } as any)).toThrow('unavailable');
  });
});
