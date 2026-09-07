import { AdaptivePlannerServingRouterV1Service } from '../src/statlocker-adaptive/adaptive-planner-serving-router-v1.service';

function input(): any {
  return { decision: { state: { decisionId: 'decision-test' }, stateRevision: 'revision-test', economyRulesEvidence: 'RECONSTRUCTED' } };
}

function result(label: string): any {
  return { gameState: 'EVEN', nextAction: { actionKey: label, type: 'HOLD', reasonCodes: [label] }, recommendedBuild: [], changes: [], rankedImmediateCandidates: [], totalScore: 0, confidence: 0, plannerVersion: 'adaptive-build-planner-v1' };
}

describe('adaptive planner serving router v1', () => {
  it('always serves the strategy/transaction planner regardless of rollout flags', () => {
    const strategy = { plan: jest.fn(() => ({ ...result('strategy'), strategy: { strategyId: 's1' } })) } as any;
    const router = new AdaptivePlannerServingRouterV1Service(strategy, {} as any, {} as any, {} as any, {} as any);

    expect(router.plan(input()).nextAction.actionKey).toBe('strategy');
    expect(strategy.plan).toHaveBeenCalledTimes(1);
  });

  it('does not replace a strategy failure with a legacy recommendation', () => {
    const strategy = { plan: jest.fn(() => { throw new Error('strategy unavailable'); }) } as any;
    const router = new AdaptivePlannerServingRouterV1Service(strategy, {} as any, {} as any, {} as any, {} as any);

    expect(() => router.plan(input())).toThrow('strategy unavailable');
  });
});
