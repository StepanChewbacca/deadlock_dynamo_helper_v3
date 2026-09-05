import { AdaptivePlannerServingRouterV1Service } from '../src/statlocker-adaptive/adaptive-planner-serving-router-v1.service';

const input = {
  decision: {
    state: { decisionId: 'decision-test' },
    stateRevision: 'revision-test',
  },
} as any;

function result(label: string): any {
  return {
    gameState: 'EVEN',
    nextAction: { actionKey: label, type: 'HOLD', reasonCodes: [label] },
    recommendedBuild: [],
    changes: [],
    rankedImmediateCandidates: [],
    totalScore: 0,
    confidence: 0,
    plannerVersion: 'adaptive-build-planner-v1',
  };
}

function setup(mode: 'LEGACY' | 'SHADOW' | 'STRATEGY', promotable: boolean) {
  const strategy = { plan: jest.fn(() => ({ ...result('strategy'), strategy: { strategyId: 's1' } })) } as any;
  const promotion = {
    configuredMode: jest.fn(() => mode),
    canServeStrategy: jest.fn(() => promotable),
    recordShadowSuccess: jest.fn(),
    recordShadowFailure: jest.fn(),
    recordPromotionBlocked: jest.fn(),
  } as any;
  const router = new AdaptivePlannerServingRouterV1Service(
    strategy,
    {} as any,
    {} as any,
    {} as any,
    promotion,
  );
  const legacy = { plan: jest.fn(() => result('legacy')) };
  (router as any).legacy = legacy;
  return { router, strategy, promotion, legacy };
}

describe('adaptive planner serving router v1', () => {
  it('serves only the legacy planner in LEGACY mode', () => {
    const { router, strategy, promotion, legacy } = setup('LEGACY', false);

    expect(router.plan(input).nextAction.actionKey).toBe('legacy');
    expect(legacy.plan).toHaveBeenCalledTimes(1);
    expect(strategy.plan).not.toHaveBeenCalled();
    expect(promotion.recordShadowSuccess).not.toHaveBeenCalled();
  });

  it('runs strategy in SHADOW mode but keeps legacy as the serving result', () => {
    const { router, strategy, promotion, legacy } = setup('SHADOW', false);

    expect(router.plan(input).nextAction.actionKey).toBe('legacy');
    expect(strategy.plan).toHaveBeenCalledTimes(1);
    expect(legacy.plan).toHaveBeenCalledTimes(1);
    expect(promotion.recordShadowSuccess).toHaveBeenCalledTimes(1);
  });

  it('keeps serving legacy when STRATEGY mode is configured but the promotion gate is closed', () => {
    const { router, strategy, promotion } = setup('STRATEGY', false);

    expect(router.plan(input).nextAction.actionKey).toBe('legacy');
    expect(strategy.plan).toHaveBeenCalledTimes(1);
    expect(promotion.recordShadowSuccess).toHaveBeenCalledTimes(1);
    expect(promotion.recordPromotionBlocked).toHaveBeenCalledTimes(1);
  });

  it('serves strategy only when STRATEGY mode is configured and the promotion gate is open', () => {
    const { router, promotion, legacy } = setup('STRATEGY', true);

    const served = router.plan(input);
    expect(served.nextAction.actionKey).toBe('strategy');
    expect(served.strategy?.strategyId).toBe('s1');
    expect(legacy.plan).not.toHaveBeenCalled();
    expect(promotion.recordShadowSuccess).not.toHaveBeenCalled();
  });

  it('fails safely to legacy when the shadow strategy planner throws', () => {
    const { router, strategy, promotion } = setup('STRATEGY', true);
    strategy.plan.mockImplementation(() => { throw new Error('strategy failed'); });

    expect(router.plan(input).nextAction.actionKey).toBe('legacy');
    expect(promotion.recordShadowFailure).toHaveBeenCalledTimes(1);
    expect(promotion.recordShadowSuccess).not.toHaveBeenCalled();
  });
});
