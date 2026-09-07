import { createRecommendationItemGraph, RecommendationCandidate } from '@deadlock-live-probe/build-domain';
import {
  BuildContractV1,
  BuildSituationalWindowStateV1,
} from '../src/statlocker-adaptive/build-contract-v1';
import {
  compileStructuredConsensusStrategyV1,
  filterRecommendationCandidatesForActiveGoalsV1,
  resolveActiveBuildStrategyGoalsV1,
} from '../src/statlocker-adaptive/build-strategy-v1';
import { ConsensusSkeletonV1 } from '../src/statlocker-adaptive/statlocker-adaptive.types';

function item(itemId: number, upgradeFrom?: number) {
  return {
    itemId,
    name: `Item ${itemId}`,
    slotType: 'weapon' as const,
    active: false,
    availableRulesetIds: ['ruleset-a'],
    ...(upgradeFrom === undefined ? { directPurchaseCost: 800 } : {}),
    upgradeRecipes: upgradeFrom === undefined
      ? []
      : [{ recipeId: `upgrade:${itemId}`, consumedItemIds: [upgradeFrom], soulsCost: 800 }],
    sellTransition: { soulsRefund: 400, returnedItemIds: [] },
    maxCopies: 1,
  };
}

function group(
  groupId: string,
  phase: 'EARLY' | 'MID' | 'LATE',
  type: 'REQUIRED' | 'CHOICE' | 'OPTIONAL',
  itemIds: readonly number[],
) {
  return {
    groupId,
    phase,
    type,
    minSelect: type === 'OPTIONAL' ? 0 : 1,
    maxSelect: 1,
    candidates: itemIds.map((itemId) => ({
      itemId,
      strength: 0.8,
      coverage: 0.8,
      purchaseRate: 0.8,
      medianBuyTimeS: phase === 'EARLY' ? 240 : phase === 'MID' ? 900 : 1800,
      timingSpreadS: 90,
      sourceProfileCount: 10,
      frequencyTier: type === 'OPTIONAL' ? 'SOMETIMES' as const : 'CORE' as const,
      rushEvidence: false,
    })),
    confidence: 0.9,
    inferred: false,
  };
}

function skeleton(): ConsensusSkeletonV1 {
  return {
    heroId: 10,
    profileCount: 10,
    groups: [
      group('early-core', 'EARLY', 'REQUIRED', [1]),
      group('mid-upgrade', 'MID', 'REQUIRED', [11]),
      group('late-branch', 'LATE', 'CHOICE', [2, 3]),
      group('situational', 'MID', 'OPTIONAL', [50]),
    ],
  };
}

function buildContract(
  currentGoalId: string,
  situationalWindowStates: readonly BuildSituationalWindowStateV1[] = [],
): BuildContractV1 {
  return {
    status: 'IN_PROGRESS',
    currentGoalId,
    completedGoalIds: new Set(),
    remainingGoalIds: ['early-core', 'mid-upgrade', 'late-branch'],
    committedChoiceItemIdsByGroup: new Map(),
    temporaryItemIds: new Set(),
    slotReservations: [],
    situationalWindowStates,
    replanReasonCodes: [],
  };
}

function candidate(action: RecommendationCandidate['action']): RecommendationCandidate {
  const targetItemId = action.type === 'BUY_ITEM' || action.type === 'UPGRADE_ITEM'
    ? action.itemId
    : action.type === 'REPLACE_ITEM'
      ? action.buyItemId
      : action.type === 'WAIT_SAVE'
        ? action.targetItemId
        : undefined;
  const actionId = action.type === 'BUY_ITEM'
    ? `BUY_ITEM:${action.itemId}`
    : action.type === 'UPGRADE_ITEM'
      ? `UPGRADE_ITEM:${action.itemId}:${action.recipeId}`
      : action.type === 'REPLACE_ITEM'
        ? `REPLACE_ITEM:${action.sellItemId}->${action.buyItemId}`
        : action.type === 'SELL_ITEM'
          ? `SELL_ITEM:${action.itemId}`
          : targetItemId === undefined
            ? 'WAIT_SAVE'
            : `WAIT_SAVE:${targetItemId}`;
  return {
    actionId,
    action,
    feasible: true,
    reasons: ['FEASIBLE'],
    recommendationEligible: true,
    recommendationSuppressionReasons: [],
    effectiveCostSouls: 0,
    resultingItemIds: [],
    evidence: {
      spendableSouls: 'OBSERVED',
      shopOpportunity: 'OBSERVED',
      ruleset: 'RECONSTRUCTED',
      inventory: 'OBSERVED',
      transaction: 'RECONSTRUCTED',
    },
  };
}

describe('build-strategy-v1', () => {
  const graph = createRecommendationItemGraph([
    item(1),
    item(2),
    item(3),
    item(11, 1),
    item(50),
    item(99),
  ]);

  it('adapts structured consensus into strategy goal semantics', () => {
    const strategy = compileStructuredConsensusStrategyV1({
      skeleton: skeleton(),
      itemGraph: graph,
      rulesetId: 'ruleset-a',
      situationalWindows: [{ windowId: 'counter-window', targetItemIds: [50] }],
    });

    expect(strategy.goals.map((goal) => [goal.goalId, goal.type])).toEqual([
      ['early-core', 'CORE'],
      ['mid-upgrade', 'UPGRADE'],
      ['late-branch', 'BRANCH'],
      ['situational:counter-window', 'SITUATIONAL_WINDOW'],
      ['terminal:mandatory-completion', 'TERMINAL'],
    ]);
  });

  it('does not expose a future MID or LATE goal to local scoring while EARLY is active', () => {
    const strategy = compileStructuredConsensusStrategyV1({
      skeleton: skeleton(),
      itemGraph: graph,
      rulesetId: 'ruleset-a',
    });
    const activeGoals = resolveActiveBuildStrategyGoalsV1(strategy, buildContract('early-core'));
    const filtered = filterRecommendationCandidatesForActiveGoalsV1([
      candidate({ type: 'BUY_ITEM', itemId: 1 }),
      candidate({ type: 'UPGRADE_ITEM', itemId: 11, recipeId: 'upgrade:11', consumedItemIds: [1] }),
      candidate({ type: 'BUY_ITEM', itemId: 3 }),
    ], activeGoals, graph);

    expect(activeGoals.map((goal) => goal.goalId)).toEqual(['early-core']);
    expect(filtered.map((entry) => entry.actionId)).toEqual(['BUY_ITEM:1']);
  });

  it('keeps a situational target outside ranking while its window is closed', () => {
    const strategy = compileStructuredConsensusStrategyV1({
      skeleton: skeleton(),
      itemGraph: graph,
      rulesetId: 'ruleset-a',
      situationalWindows: [{ windowId: 'counter-window', targetItemIds: [50] }],
    });
    const activeGoals = resolveActiveBuildStrategyGoalsV1(
      strategy,
      buildContract('early-core', [{
        windowId: 'counter-window',
        state: 'CLOSED',
        targetItemIds: [50],
        reasonCodes: ['EVIDENCE_BELOW_THRESHOLD'],
      }]),
    );
    const filtered = filterRecommendationCandidatesForActiveGoalsV1([
      candidate({ type: 'BUY_ITEM', itemId: 1 }),
      candidate({ type: 'BUY_ITEM', itemId: 50 }),
    ], activeGoals, graph);

    expect(activeGoals.map((goal) => goal.goalId)).toEqual(['early-core']);
    expect(filtered.map((entry) => entry.actionId)).toEqual(['BUY_ITEM:1']);
  });

  it('adds the situational target family only while the matching window is open', () => {
    const strategy = compileStructuredConsensusStrategyV1({
      skeleton: skeleton(),
      itemGraph: graph,
      rulesetId: 'ruleset-a',
      situationalWindows: [{ windowId: 'counter-window', targetItemIds: [50] }],
    });
    const activeGoals = resolveActiveBuildStrategyGoalsV1(
      strategy,
      buildContract('early-core', [{
        windowId: 'counter-window',
        state: 'OPEN',
        targetItemIds: [50],
        reasonCodes: ['EXACT_ENEMY_MATCHUP_SUPPORTED'],
      }]),
    );
    const filtered = filterRecommendationCandidatesForActiveGoalsV1([
      candidate({ type: 'BUY_ITEM', itemId: 1 }),
      candidate({ type: 'BUY_ITEM', itemId: 50 }),
      candidate({ type: 'BUY_ITEM', itemId: 99 }),
    ], activeGoals, graph);

    expect(activeGoals.map((goal) => goal.goalId)).toEqual(['early-core', 'situational:counter-window']);
    expect(filtered.map((entry) => entry.actionId)).toEqual(['BUY_ITEM:1', 'BUY_ITEM:50']);
  });

  it('allows component acquisition for an active upgrade goal without allowing unrelated shop items', () => {
    const strategy = compileStructuredConsensusStrategyV1({
      skeleton: skeleton(),
      itemGraph: graph,
      rulesetId: 'ruleset-a',
    });
    const activeGoals = resolveActiveBuildStrategyGoalsV1(strategy, buildContract('mid-upgrade'));
    const filtered = filterRecommendationCandidatesForActiveGoalsV1([
      candidate({ type: 'BUY_ITEM', itemId: 1 }),
      candidate({ type: 'UPGRADE_ITEM', itemId: 11, recipeId: 'upgrade:11', consumedItemIds: [1] }),
      candidate({ type: 'BUY_ITEM', itemId: 99 }),
    ], activeGoals, graph);

    expect(filtered.map((entry) => entry.actionId)).toEqual([
      'BUY_ITEM:1',
      'UPGRADE_ITEM:11:upgrade:11',
    ]);
  });
});
