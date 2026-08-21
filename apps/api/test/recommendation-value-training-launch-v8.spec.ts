import { RecommendationValueTrainingLaunchV8Service } from '../src/deadlock-live/recommendation-value-training-launch-v8.service';

describe('RecommendationValueTrainingLaunchV8Service', () => {
  function roadmap(overrides: Record<string, unknown> = {}) {
    return {
      evidence: {
        exactActionPropensity: 'PASS',
        safeExplorationSafety: 'PASS',
        futureTestUntouched: true,
        futureTestEvaluation: 'NOT_EVALUATED',
        ...overrides,
      },
      state: {
        phases: [{ phase: 'SAFE_EXPLORATION', unlocked: true, blockers: [] }],
      },
    };
  }

  function ope(overrides: Record<string, unknown> = {}) {
    return {
      generatedAt: '2026-08-22T00:00:00.000Z',
      reward: 'economyDelta120s',
      randomizedDecisionCount: 1000,
      outcomeDecisionCount: 1000,
      evaluableDecisionCount: 1000,
      excludedDecisionCount: 0,
      evidenceSufficient: true,
      blockers: [],
      evaluation: {
        passedSupportGate: true,
        effectiveSampleSize: 800,
        effectiveSampleSizeRatio: 0.8,
        clippedDecisionRate: 0,
      },
      ...overrides,
    };
  }

  it('authorizes Value training only after safe exploration and complete OPE support', async () => {
    const roadmapEvidence = { report: jest.fn(async () => roadmap()) };
    const opeReports = { buildReport: jest.fn(async () => ope()) };
    const service = new RecommendationValueTrainingLaunchV8Service(
      roadmapEvidence as never,
      opeReports as never,
    );

    const result = await service.preflight({ reward: 'economyDelta120s' });

    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.futureTestEvaluated).toBe(false);
  });

  it('fails closed when randomized/OPE evidence is absent', async () => {
    const roadmapEvidence = {
      report: jest.fn(async () => ({
        ...roadmap(),
        state: {
          phases: [{
            phase: 'SAFE_EXPLORATION',
            unlocked: false,
            blockers: ['safeExplorationSafety:NOT_EVALUATED'],
          }],
        },
      })),
    };
    const opeReports = {
      buildReport: jest.fn(async () => ope({
        randomizedDecisionCount: 0,
        outcomeDecisionCount: 0,
        evaluableDecisionCount: 0,
        evidenceSufficient: false,
        blockers: ['NO_RANDOMIZED_DECISIONS'],
        evaluation: undefined,
      })),
    };
    const service = new RecommendationValueTrainingLaunchV8Service(
      roadmapEvidence as never,
      opeReports as never,
    );

    const result = await service.preflight({ reward: 'economyDelta120s' });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('SAFE_EXPLORATION_PHASE_NOT_UNLOCKED');
    expect(result.blockers).toContain('OPE:NO_RANDOMIZED_DECISIONS');
    expect(result.blockers).toContain('NO_RANDOMIZED_DECISIONS');
  });

  it('blocks Value training after FUTURE_TEST evaluation', async () => {
    const roadmapEvidence = {
      report: jest.fn(async () => roadmap({ futureTestEvaluation: 'PASS' })),
    };
    const opeReports = { buildReport: jest.fn(async () => ope()) };
    const service = new RecommendationValueTrainingLaunchV8Service(
      roadmapEvidence as never,
      opeReports as never,
    );

    const result = await service.preflight({ reward: 'economyDelta120s' });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('FUTURE_TEST_ALREADY_EVALUATED');
  });
});
