import { buildAdaptiveRecommendationPresentation } from './adaptive-recommendation-presentation';

function recommendation(overrides: Record<string, unknown> = {}): any {
  return {
    ready: true,
    blockers: [],
    decisionId: 'decision-full-build',
    stateRevision: 'revision-full-build',
    gameState: 'BEHIND',
    nextAction: {
      actionKey: 'HOLD:1342610602',
      type: 'HOLD',
      targetItemId: 1342610602,
      reasonCodes: ['PLAN_REQUIREMENTS_BLOCKED'],
    },
    nextTargetItemId: 1342610602,
    planActions: [
      {
        planActionId: 'close-quarters:wait-current',
        sequence: 1,
        status: 'BLOCKED',
        action: {
          actionKey: 'WAIT:1342610602',
          type: 'WAIT',
          targetItemId: 1342610602,
          reasonCodes: ['WAIT_FOR_REQUIREMENTS'],
        },
        targetItemId: 1342610602,
        sourceItemIds: [],
        requirements: [
          {
            type: 'SOULS',
            requiredSouls: 800,
            currentSouls: 650,
            shortfallSouls: 150,
            evidence: 'OBSERVED',
          },
        ],
        goalId: 'close-quarters-goal',
        reasonCodes: [],
      },
      {
        planActionId: 'close-quarters:wait-for-souls',
        sequence: 2,
        status: 'PLANNED',
        action: {
          actionKey: 'WAIT_FOR_SOULS:1342610602',
          type: 'WAIT',
          targetItemId: 1342610602,
          reasonCodes: [],
        },
        targetItemId: 1342610602,
        sourceItemIds: [],
        requirements: [
          {
            type: 'SOULS',
            requiredSouls: 800,
            evidence: 'UNKNOWN',
          },
        ],
        goalId: 'close-quarters-goal',
        reasonCodes: [],
      },
      {
        planActionId: 'close-quarters:buy',
        sequence: 3,
        status: 'PLANNED',
        action: {
          actionKey: 'BUY:1342610602',
          type: 'BUY',
          buyItemId: 1342610602,
          targetItemId: 1342610602,
          reasonCodes: [],
        },
        targetItemId: 1342610602,
        sourceItemIds: [],
        requirements: [],
        goalId: 'close-quarters-goal',
        reasonCodes: [],
      },
    ],
    recommendedBuild: [
      plannedItem(1342610602, 1, 'NEXT'),
      plannedItem(3862866912, 2, 'PLANNED'),
      plannedItem(968099481, 3, 'PLANNED'),
      plannedItem(1437614329, 4, 'PLANNED'),
      plannedItem(7409189, 5, 'PLANNED'),
    ],
    changes: [],
    rankedImmediateCandidates: [],
    totalScore: 0.72,
    confidence: 0.56,
    scorerVersion: 'adaptive-evidence-scorer-v1',
    plannerVersion: 'adaptive-build-planner-v1',
    configVersion: 'statlocker-adaptive-v1.3.0',
    evidence: {
      rulesetVersion: 'ruleset-a',
      catalogSha256: 'a'.repeat(64),
      statlockerPatchId: '15-1',
      snapshotIds: ['snapshot-a'],
      families: [
        { dataset: 'hero_builds', freshness: 'FRESH', confidence: 0.9 },
      ],
      degradedReasons: [],
    },
    ...overrides,
  };
}

function plannedItem(itemId: number, position: number, status: string): any {
  return {
    itemId,
    position,
    status,
    score: 0.5,
    confidence: 0.5,
    skeletonStrength: 0.5,
    contextualSupport: 0.5,
    reasonCodes: [],
  };
}

describe('adaptive recommendation full build path', () => {
  it('renders the full semantic build once while transaction barriers stay internal', () => {
    const view = buildAdaptiveRecommendationPresentation(recommendation());

    expect(view.plan.items).toHaveLength(5);
    expect(view.plan.items.map((entry) => entry.item.id)).toEqual([
      1342610602,
      3862866912,
      968099481,
      1437614329,
      7409189,
    ]);
    expect(new Set(view.plan.items.map((entry) => entry.item.id)).size).toBe(5);

    const closeQuartersRows = view.plan.items.filter((entry) => entry.item.id === 1342610602);
    expect(closeQuartersRows).toHaveLength(1);
    expect(closeQuartersRows[0].statusLabel).toBe('Next');
    expect(closeQuartersRows[0].actionLabel).toBe('Hold');
    expect(closeQuartersRows[0].requirements).toEqual(['Save until 800 souls']);

    expect(view.plan.items.slice(1).every((entry) => entry.actionLabel === 'Planned')).toBe(true);
    expect(view.plan.items.some((entry) => entry.actionLabel === 'Buy now')).toBe(false);
    expect(view.primaryRequirements).toEqual(['Save until 800 souls']);
  });

  it('renders the semantic build when transaction-plan details are unavailable', () => {
    const view = buildAdaptiveRecommendationPresentation(recommendation({
      planActions: undefined,
      recommendedBuild: [
        plannedItem(1342610602, 1, 'NEXT'),
        plannedItem(3862866912, 2, 'PLANNED'),
      ],
    }));

    expect(view.plan.items.map((entry) => entry.item.id)).toEqual([
      1342610602,
      3862866912,
    ]);
    expect(view.plan.items.map((entry) => entry.statusLabel)).toEqual(['Next', 'Planned']);
  });
});