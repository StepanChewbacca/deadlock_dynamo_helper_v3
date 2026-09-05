import { buildAdaptiveRecommendationPresentation } from './adaptive-recommendation-presentation';

function recommendation(overrides: Record<string, unknown> = {}): any {
  return {
    ready: true,
    blockers: [],
    decisionId: 'decision-a',
    stateRevision: 'revision-a',
    gameState: 'EVEN',
    nextAction: {
      actionKey: 'BUY:3862866912',
      type: 'BUY',
      buyItemId: 3862866912,
      reasonCodes: ['CORE_TARGET_PENDING'],
    },
    nextTargetItemId: 3862866912,
    recommendedBuild: [],
    changes: [],
    rankedImmediateCandidates: [],
    totalScore: 0.72,
    confidence: 0.82,
    scorerVersion: 'adaptive-evidence-scorer-v1',
    plannerVersion: 'adaptive-build-planner-v1',
    configVersion: 'statlocker-adaptive-v1.0.0',
    evidence: {
      rulesetVersion: 'ruleset-a',
      catalogSha256: 'a'.repeat(64),
      statlockerPatchId: '15-1',
      snapshotIds: ['one', 'two'],
      families: [
        { dataset: 'hero_builds', freshness: 'FRESH', confidence: 0.9 },
        { dataset: 'matchups', freshness: 'FRESH', confidence: 0.8 },
      ],
      degradedReasons: [],
    },
    ...overrides,
  };
}

describe('adaptive recommendation presentation', () => {
  it('turns a known Statlocker action into a readable item card', () => {
    const view = buildAdaptiveRecommendationPresentation(recommendation());

    expect(view.sourceLabel).toBe('Statlocker Adaptive');
    expect(view.stateLabel).toBe('Even game');
    expect(view.headline).toBe('Buy Restorative Shot');
    expect(view.primaryItem).toMatchObject({
      id: 3862866912,
      name: 'Restorative Shot',
      slot: 'weapon',
      costLabel: '800 souls',
      tierLabel: 'Tier 1',
      known: true,
    });
    expect(view.confidence).toEqual({ label: '82% confidence', value: 82 });
    expect(view.reasons).toContain('Keep saving for the next core item');
    expect(view.evidenceLabel).toBe('2 fresh Statlocker signals');
    expect(view.strategy).toBeUndefined();
  });

  it('presents the selected strategy, progress, branches, slot pressure and investment objective', () => {
    const view = buildAdaptiveRecommendationPresentation(recommendation({
      strategy: {
        strategyId: 'hero:1:archetype:burst-spirit',
        commitment: 'COMMITTED',
        selectedAtGameTimeSec: 210,
        posterior: 0.87,
        reasonCodes: ['DISTINCTIVE_PREFIX_COMMITMENT'],
        selectedBranches: { boots: 'boots-spirit' },
        committedBranches: { boots: 'boots-spirit' },
        buildStatus: 'IN_PROGRESS',
        progress: { satisfiedHardGoals: 3, totalHardGoals: 7 },
        currentGoal: { goalId: 'mid:upgrade:2', type: 'UPGRADE', reasonCodes: ['CURRENT_GOAL'] },
        remainingGoalIds: ['mid:upgrade:2', 'late:core:3'],
        slotPlan: {
          currentUsedSlots: 9,
          currentFlexUsed: 1,
          unlockedFlexSlots: 2,
          reservedSituationalSlots: 1,
          feasible: true,
          reasonCodes: ['SLOT_PLAN_FEASIBLE'],
        },
        investmentObjectives: [{
          objectiveId: 'spirit-3200',
          type: 'spirit',
          state: 'ACTIVE',
          currentValue: 2400,
          targetValue: 3200,
          distance: 800,
          reasonCodes: ['INVESTMENT_OBJECTIVE_ACTIVE'],
        }],
      },
    }));

    expect(view.sourceLabel).toBe('Strategy-first Adaptive');
    expect(view.strategy).toEqual({
      idLabel: 'burst spirit',
      commitmentLabel: 'Committed',
      buildStatusLabel: 'In progress',
      progressLabel: '3 / 7 core goals',
      progressValue: 43,
      currentGoalLabel: 'Upgrade · mid upgrade 2',
      branchLabel: 'boots: boots spirit',
      slotLabel: '9 slots · 1/2 flex · 1 reserved',
      investmentLabel: 'Spirit 2,400 / 3,200 · 800 to objective',
      situationalLabel: undefined,
    });
  });

  it('presents an active situational window as an explicit bounded strategy deviation', () => {
    const view = buildAdaptiveRecommendationPresentation(recommendation({
      strategy: {
        strategyId: 'strategy:survival',
        commitment: 'PROVISIONAL',
        posterior: 0.61,
        reasonCodes: ['STRATEGY_SELECTION_PROVISIONAL'],
        selectedBranches: {},
        committedBranches: {},
        buildStatus: 'WAITING',
        progress: { satisfiedHardGoals: 2, totalHardGoals: 5 },
        remainingGoalIds: ['g3', 'g4', 'g5'],
        slotPlan: {
          currentUsedSlots: 8,
          currentFlexUsed: 0,
          reservedSituationalSlots: 1,
          feasible: true,
          reasonCodes: [],
        },
        investmentObjectives: [],
        situationalDecision: {
          windowId: 'anti-cc-mid',
          purpose: 'ANTI_CC',
          targetItemId: 3862866912,
          enemyHeroIds: [4, 5],
          enemyItemIds: [],
          confidence: 0.78,
          reasonCodes: ['SITUATIONAL_WINDOW_ACTIVE'],
        },
      },
    }));

    expect(view.strategy?.commitmentLabel).toBe('Provisional');
    expect(view.strategy?.buildStatusLabel).toBe('Waiting');
    expect(view.strategy?.situationalLabel).toBe('Anti CC window · Restorative Shot · 78%');
  });

  it('shows the entire sorted build path without truncating later items', () => {
    const itemIds = [
      3862866912,
      968099481,
      1342610602,
      1437614329,
      7409189,
      26002154,
      84321454,
      98582110,
    ];
    const recommendedBuild = itemIds.map((itemId, index) => ({
      itemId,
      position: itemIds.length - index,
      status: index === 6 ? 'NEXT' : index % 2 === 0 ? 'OWNED' : 'PLANNED',
      score: 0.5,
      confidence: 0.5,
      skeletonStrength: 0.5,
      contextualSupport: 0.5,
      reasonCodes: [],
    }));

    const view = buildAdaptiveRecommendationPresentation(recommendation({ recommendedBuild }));

    expect(view.plan.items).toHaveLength(8);
    expect(view.plan.items.map((item) => item.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(view.plan.remainingCount).toBe(0);
    expect(view.plan.items.every((item) => ['Owned', 'Next', 'Planned'].includes(item.statusLabel))).toBe(true);
  });

  it('limits alternatives to three and omits the primary action', () => {
    const rankedImmediateCandidates = [
      { action: { actionKey: 'UPGRADE:3862866912', type: 'UPGRADE', itemId: 3862866912, reasonCodes: [] }, score: 0.95, confidence: 0.9 },
      { action: { actionKey: 'BUY:968099481', type: 'BUY', buyItemId: 968099481, reasonCodes: [] }, score: 0.84, confidence: 0.8 },
      { action: { actionKey: 'REPLACE:1:968099481', type: 'REPLACE', sellItemId: 1437614329, buyItemId: 968099481, reasonCodes: [] }, score: 0.8, confidence: 0.75 },
      { action: { actionKey: 'BUY:1342610602', type: 'BUY', buyItemId: 1342610602, reasonCodes: [] }, score: 0.74, confidence: 0.7 },
      { action: { actionKey: 'BUY:1437614329', type: 'BUY', buyItemId: 1437614329, reasonCodes: [] }, score: 0.64, confidence: 0.6 },
      { action: { actionKey: 'BUY:7409189', type: 'BUY', buyItemId: 7409189, reasonCodes: [] }, score: 0.54, confidence: 0.5 },
    ];

    const view = buildAdaptiveRecommendationPresentation(recommendation({ rankedImmediateCandidates }));

    expect(view.alternatives).toHaveLength(3);
    expect(view.alternatives.map((item) => item.item?.name)).toEqual([
      'Extra Spirit',
      'Close Quarters',
      'Melee Lifesteal',
    ]);
    expect(view.alternatives.map((item) => item.headline)).toEqual([
      'Buy Extra Spirit',
      'Buy Close Quarters',
      'Buy Melee Lifesteal',
    ]);
  });

  it('shows both sides of an exact replacement transaction', () => {
    const view = buildAdaptiveRecommendationPresentation(recommendation({
      nextAction: {
        actionKey: 'REPLACE:1437614329:3862866912',
        type: 'REPLACE',
        sellItemId: 1437614329,
        buyItemId: 3862866912,
        reasonCodes: ['FRESH_LEGALITY_FALLBACK'],
      },
    }));

    expect(view.headline).toBe('Replace Melee Lifesteal with Restorative Shot');
    expect(view.primaryItem?.name).toBe('Restorative Shot');
    expect(view.replacedItem?.name).toBe('Melee Lifesteal');
  });

  it('humanizes internal catalog identifiers before displaying them', () => {
    const view = buildAdaptiveRecommendationPresentation(recommendation({
      nextTargetItemId: 184951197,
      nextAction: {
        actionKey: 'BUY:184951197',
        type: 'BUY',
        buyItemId: 184951197,
        reasonCodes: [],
      },
    }));

    expect(view.primaryItem?.name).toBe('Proc Tech Damage');
    expect(view.primaryItem?.name).not.toContain('_');
  });

  it('labels a zero-confidence hold as a safe hold instead of misleading confidence', () => {
    const view = buildAdaptiveRecommendationPresentation(recommendation({
      confidence: 0,
      nextAction: {
        actionKey: 'HOLD:3862866912',
        type: 'HOLD',
        targetItemId: 3862866912,
        reasonCodes: ['PLAN_HYSTERESIS', 'STATLOCKER_UNAVAILABLE_PRESERVE_PLAN'],
      },
    }));

    expect(view.headline).toBe('Hold for Restorative Shot');
    expect(view.confidence).toEqual({ label: 'Safe hold', value: 0 });
    expect(view.reasons).toEqual([
      'Current plan is still the safest choice',
      'Statlocker is updating; keeping the last safe plan',
    ]);
  });

  it('uses a quiet fallback for unknown item ids and humanizes unknown reasons', () => {
    const view = buildAdaptiveRecommendationPresentation(recommendation({
      nextTargetItemId: 999999999,
      nextAction: {
        actionKey: 'WAIT:999999999',
        type: 'WAIT',
        targetItemId: 999999999,
        reasonCodes: ['NO_USABLE_STATLOCKER_EVIDENCE', 'CUSTOM_REASON_CODE'],
      },
    }));

    expect(view.headline).toBe('Wait before buying');
    expect(view.primaryItem).toMatchObject({
      id: 999999999,
      name: 'Unknown item',
      diagnosticLabel: '#999999999',
      known: false,
    });
    expect(view.reasons).toEqual([
      'Waiting for reliable Statlocker data',
      'Custom reason code',
    ]);
    expect(view.headline).not.toContain('999999999');
  });
});
