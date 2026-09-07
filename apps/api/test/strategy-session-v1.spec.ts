import { resolveAdaptiveStrategySessionV1 } from '../src/statlocker-adaptive/strategy-session-v1';

function candidate(
  strategyId: string,
  score: number,
  support = 10,
  signals: {
    draftLikelihood?: number;
    purchasePrefixLikelihood?: number;
    timingLikelihood?: number;
    priorWeight?: number;
  } = {},
) {
  return {
    strategyId,
    heroId: 10,
    rulesetId: 'ruleset-a',
    catalogSha256: 'a'.repeat(64),
    score,
    confidence: 0.9,
    support,
    feasible: true,
    ...signals,
  };
}

describe('resolveAdaptiveStrategySessionV1', () => {
  it('uses draft, purchase-prefix and timing likelihoods to form the strategy posterior', () => {
    const session = resolveAdaptiveStrategySessionV1({
      decisionId: 'decision-1',
      heroId: 10,
      rulesetId: 'ruleset-a',
      catalogSha256: 'a'.repeat(64),
      candidates: [
        candidate('strategy-a', 0.7, 12, {
          draftLikelihood: 0.9,
          purchasePrefixLikelihood: 0.95,
          timingLikelihood: 0.8,
        }),
        candidate('strategy-b', 0.8, 12, {
          draftLikelihood: 0.8,
          purchasePrefixLikelihood: 0.15,
          timingLikelihood: 0.9,
        }),
      ],
    });

    expect(session.strategyId).toBe('strategy-a');
    expect(session.strategyPosterior).toBeGreaterThan(0.8);
  });

  it('keeps a committed strategy across small posterior movement', () => {
    const previous = {
      state: 'COMMITTED' as const,
      strategyId: 'strategy-a',
      strategyPosterior: 0.51,
      heroId: 10,
      rulesetId: 'ruleset-a',
      catalogSha256: 'a'.repeat(64),
      committedAtDecisionId: 'decision-1',
      divergenceCount: 0,
      lastTransitionReasonCodes: ['STRATEGY_COMMITTED'],
    };

    const next = resolveAdaptiveStrategySessionV1({
      decisionId: 'decision-2',
      heroId: 10,
      rulesetId: 'ruleset-a',
      catalogSha256: 'a'.repeat(64),
      previous,
      candidates: [candidate('strategy-a', 0.8), candidate('strategy-b', 0.84)],
    });

    expect(next.state).toBe('COMMITTED');
    expect(next.strategyId).toBe('strategy-a');
    expect(next.lastTransitionReasonCodes).toContain('STRATEGY_HYSTERESIS');
  });

  it('switches a committed strategy only when posterior evidence clears the higher threshold', () => {
    const previous = resolveAdaptiveStrategySessionV1({
      decisionId: 'decision-1',
      heroId: 10,
      rulesetId: 'ruleset-a',
      catalogSha256: 'a'.repeat(64),
      candidates: [candidate('strategy-a', 0.9, 20)],
      irreversibleBranchInvestment: true,
    });
    const switched = resolveAdaptiveStrategySessionV1({
      decisionId: 'decision-2',
      heroId: 10,
      rulesetId: 'ruleset-a',
      catalogSha256: 'a'.repeat(64),
      previous,
      candidates: [
        candidate('strategy-a', 0.8, 10, { purchasePrefixLikelihood: 0.03, timingLikelihood: 0.2 }),
        candidate('strategy-b', 0.82, 10, { purchasePrefixLikelihood: 0.99, timingLikelihood: 0.95 }),
      ],
    });

    expect(previous.state).toBe('COMMITTED');
    expect(switched.state).toBe('COMMITTED');
    expect(switched.strategyId).toBe('strategy-b');
    expect(switched.lastTransitionReasonCodes).toContain('STRATEGY_SWITCH_THRESHOLD_MET');
  });

  it('marks meaningful user divergence without silently switching strategy', () => {
    const previous = resolveAdaptiveStrategySessionV1({
      decisionId: 'decision-1',
      heroId: 10,
      rulesetId: 'ruleset-a',
      catalogSha256: 'a'.repeat(64),
      candidates: [candidate('strategy-a', 0.9, 20)],
      irreversibleBranchInvestment: true,
    });
    const diverged = resolveAdaptiveStrategySessionV1({
      decisionId: 'decision-2',
      heroId: 10,
      rulesetId: 'ruleset-a',
      catalogSha256: 'a'.repeat(64),
      previous,
      candidates: [candidate('strategy-a', 0.8), candidate('strategy-b', 0.95)],
      meaningfulUserDivergence: true,
    });

    expect(previous.state).toBe('COMMITTED');
    expect(diverged.state).toBe('DIVERGED');
    expect(diverged.strategyId).toBe('strategy-a');
    expect(diverged.divergenceCount).toBe(1);
  });

  it('goes out of distribution when no strategy is feasible for the exact scope', () => {
    const session = resolveAdaptiveStrategySessionV1({
      decisionId: 'decision-1',
      heroId: 10,
      rulesetId: 'ruleset-a',
      catalogSha256: 'a'.repeat(64),
      candidates: [],
    });

    expect(session.state).toBe('OUT_OF_DISTRIBUTION');
    expect(session.strategyId).toBeUndefined();
  });
});