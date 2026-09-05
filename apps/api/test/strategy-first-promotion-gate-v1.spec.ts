import { StrategyFirstPromotionGateV1Service } from '../src/statlocker-adaptive/strategy-first-promotion-gate-v1.service';

const zeroRelease = {
  evaluatedDecisions: 100,
  illegalActionRate: 0,
  slotViolationRate: 0,
  unreachablePlanRate: 0,
  redundantAncestorRate: 0,
  falseBuildCompleteRate: 0,
  mandatoryGoalLostRate: 0,
  branchContradictionRate: 0,
  archetypeUnexpectedSwitchRate: 0,
  coreWithoutExitSlotRate: 0,
  unexplainedSituationalRate: 0,
  nextActionBuildMismatchRate: 0,
};

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function gate(release = zeroRelease) {
  return new StrategyFirstPromotionGateV1Service({
    getStatus: () => ({ strategyFirstRelease: release }),
  } as any);
}

describe('strategy-first promotion gate v1', () => {
  it('defaults to SHADOW and requires enough clean shadow observations before promotion', () => {
    delete process.env.ADAPTIVE_STRATEGY_PLANNER_MODE;
    delete process.env.ADAPTIVE_STRATEGY_PROMOTION_APPROVED;
    process.env.ADAPTIVE_STRATEGY_PROMOTION_MIN_DECISIONS = '2';
    const service = gate({ ...zeroRelease, evaluatedDecisions: 2 });

    expect(service.status()).toMatchObject({
      configuredMode: 'SHADOW',
      effectiveMode: 'SHADOW',
      promotable: false,
    });
    service.recordShadowSuccess();
    service.recordShadowSuccess();
    expect(service.status().promotable).toBe(true);
  });

  it('allows explicit promotion approval only when every hard release rate remains zero', () => {
    process.env.ADAPTIVE_STRATEGY_PLANNER_MODE = 'STRATEGY';
    process.env.ADAPTIVE_STRATEGY_PROMOTION_APPROVED = 'true';
    const service = gate({ ...zeroRelease, evaluatedDecisions: 1 });

    expect(service.status()).toMatchObject({
      configuredMode: 'STRATEGY',
      effectiveMode: 'STRATEGY',
      promotable: true,
      externallyApproved: true,
    });
  });

  it('keeps STRATEGY configuration in shadow when a hard release metric is non-zero', () => {
    process.env.ADAPTIVE_STRATEGY_PLANNER_MODE = 'STRATEGY';
    process.env.ADAPTIVE_STRATEGY_PROMOTION_APPROVED = 'true';
    const service = gate({ ...zeroRelease, illegalActionRate: 0.01 });

    expect(service.status()).toMatchObject({
      effectiveMode: 'SHADOW',
      promotable: false,
    });
    expect(service.status().blockers).toContain('HARD_RELEASE_METRIC_NON_ZERO');
  });

  it('blocks promotion after any shadow runtime failure', () => {
    process.env.ADAPTIVE_STRATEGY_PLANNER_MODE = 'STRATEGY';
    process.env.ADAPTIVE_STRATEGY_PROMOTION_APPROVED = 'true';
    const service = gate();
    service.recordShadowFailure();

    expect(service.canServeStrategy()).toBe(false);
    expect(service.status().blockers).toContain('SHADOW_RUNTIME_FAILURE');
  });
});
