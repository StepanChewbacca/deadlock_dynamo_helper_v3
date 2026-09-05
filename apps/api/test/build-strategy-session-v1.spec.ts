import { BuildStrategySessionV1Service } from '../src/statlocker-adaptive/build-strategy-session-v1.service';
import { BuildStrategySelectionV1 } from '../src/statlocker-adaptive/build-strategy-v1';

function selection(options: {
  selectedStrategyId?: string;
  commitment?: BuildStrategySelectionV1['commitment'];
  a?: number;
  b?: number;
  reasonCodes?: readonly string[];
}): BuildStrategySelectionV1 {
  const entries = [
    { strategyId: 'a', probability: options.a ?? 0.5, conformance: 0.7, evidenceCount: 2 },
    { strategyId: 'b', probability: options.b ?? 0.5, conformance: 0.7, evidenceCount: 2 },
  ].sort((left, right) => right.probability - left.probability || left.strategyId.localeCompare(right.strategyId));
  return {
    selectedStrategyId: options.selectedStrategyId,
    commitment: options.commitment ?? 'PROVISIONAL',
    posteriors: entries,
    reasonCodes: [...(options.reasonCodes ?? [])],
  };
}

describe('build strategy session v1', () => {
  const service = new BuildStrategySessionV1Service();

  it('creates a new session from the selected strategy', () => {
    const session = service.reconcile({
      selection: selection({ selectedStrategyId: 'a', a: 0.8, b: 0.2, reasonCodes: ['BEST_POSTERIOR'] }),
      gameTimeSec: 120,
    });

    expect(session).toEqual({
      strategyId: 'a',
      commitment: 'PROVISIONAL',
      posterior: 0.8,
      selectedAtGameTimeSec: 120,
      replanReasons: ['BEST_POSTERIOR'],
    });
  });

  it('keeps a committed strategy when switch improvement is below hysteresis threshold', () => {
    const session = service.reconcile({
      previous: {
        strategyId: 'a',
        commitment: 'COMMITTED',
        posterior: 0.7,
        selectedAtGameTimeSec: 100,
        replanReasons: [],
      },
      selection: selection({ selectedStrategyId: 'b', commitment: 'COMMITTED', a: 0.35, b: 0.60 }),
      gameTimeSec: 300,
      committedSwitchMinImprovement: 0.28,
    });

    expect(session.strategyId).toBe('a');
    expect(session.commitment).toBe('COMMITTED');
    expect(session.posterior).toBe(0.35);
    expect(session.selectedAtGameTimeSec).toBe(100);
    expect(session.replanReasons).toContain('SWITCH_IMPROVEMENT_BELOW_COMMITTED_THRESHOLD');
  });

  it('switches a committed strategy only after a strong enough improvement', () => {
    const session = service.reconcile({
      previous: {
        strategyId: 'a',
        commitment: 'COMMITTED',
        posterior: 0.7,
        selectedAtGameTimeSec: 100,
        replanReasons: [],
      },
      selection: selection({ selectedStrategyId: 'b', commitment: 'COMMITTED', a: 0.20, b: 0.70 }),
      gameTimeSec: 300,
      committedSwitchMinImprovement: 0.28,
    });

    expect(session.strategyId).toBe('b');
    expect(session.commitment).toBe('COMMITTED');
    expect(session.posterior).toBe(0.70);
    expect(session.selectedAtGameTimeSec).toBe(300);
    expect(session.replanReasons).toContain('COMMITTED_STRATEGY_SWITCH');
  });

  it('rebases OOD state to one nearest strategy without merging archetypes', () => {
    const session = service.reconcile({
      previous: {
        strategyId: 'a',
        commitment: 'COMMITTED',
        posterior: 0.7,
        selectedAtGameTimeSec: 100,
        replanReasons: [],
      },
      selection: selection({
        selectedStrategyId: 'b',
        commitment: 'OOD',
        a: 0.30,
        b: 0.45,
        reasonCodes: ['NO_STRATEGY_CONFORMANCE', 'NEAREST_STRATEGY_REBASE'],
      }),
      gameTimeSec: 500,
    });

    expect(session.strategyId).toBe('b');
    expect(session.commitment).toBe('OOD');
    expect(session.selectedAtGameTimeSec).toBe(500);
    expect(session.replanReasons).toEqual(expect.arrayContaining([
      'CURRENT_STATE_OUT_OF_DISTRIBUTION',
      'OOD_NEAREST_STRATEGY_REBASE',
    ]));
  });

  it('marks a committed session diverged when OOD has no feasible rebase target', () => {
    const session = service.reconcile({
      previous: {
        strategyId: 'a',
        commitment: 'COMMITTED',
        posterior: 0.7,
        selectedAtGameTimeSec: 100,
        replanReasons: [],
      },
      selection: {
        commitment: 'OOD',
        posteriors: [],
        reasonCodes: ['NO_STRATEGIES_AVAILABLE_FOR_LIVE_SCOPE'],
      },
      gameTimeSec: 500,
    });

    expect(session.strategyId).toBe('a');
    expect(session.commitment).toBe('DIVERGED');
    expect(session.replanReasons).toContain('CURRENT_STATE_OUT_OF_DISTRIBUTION');
  });
});
