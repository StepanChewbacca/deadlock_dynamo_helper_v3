import {
  buildInventoryInstancesForRecommendation,
  createRecommendationItemGraph,
  observedFact,
} from '@deadlock-live-probe/build-domain';
import { deriveAdaptiveSlotStateV1, unknownAdaptiveInvestmentStateV1 } from '../src/statlocker-adaptive/adaptive-economy-v1';
import {
  evaluateStrategyFirstInvariantsV1,
  summarizeStrategyFirstInvariantChecksV1,
} from '../src/statlocker-adaptive/strategy-first-invariants-v1';

const graph = createRecommendationItemGraph([
  {
    itemId: 1, name: 'Component', slotType: 'weapon', active: false, availableRulesetIds: ['r1'],
    directPurchaseCost: 500, upgradeRecipes: [], sellTransition: { soulsRefund: 250, returnedItemIds: [] },
  },
  {
    itemId: 2, name: 'Upgrade', slotType: 'weapon', active: false, availableRulesetIds: ['r1'],
    upgradeRecipes: [{ recipeId: 'u2', consumedItemIds: [1], soulsCost: 500 }],
    sellTransition: { soulsRefund: 500, returnedItemIds: [1] },
  },
  {
    itemId: 3, name: 'Branch A', slotType: 'vitality', active: false, availableRulesetIds: ['r1'],
    directPurchaseCost: 800, upgradeRecipes: [], sellTransition: { soulsRefund: 400, returnedItemIds: [] },
  },
  {
    itemId: 4, name: 'Branch B', slotType: 'spirit', active: false, availableRulesetIds: ['r1'],
    directPurchaseCost: 800, upgradeRecipes: [], sellTransition: { soulsRefund: 400, returnedItemIds: [] },
  },
]);
const slotRules = { baseSlots: 12, baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 } as const, maxFlexSlots: 4, maxActiveItems: 4 };
const owned = [2];
const held = buildInventoryInstancesForRecommendation(owned, graph);
const decision: any = {
  state: {
    decisionId: 'd', matchId: 'm', playerSlot: 0, gameTimeSec: 500, rulesetId: 'r1', heroId: 1,
    inventory: { initializedFromSnapshot: true, heldByItemId: held, lifecycleCountByItemId: new Map([[2, 1]]), nextInstanceSequence: 2 },
    economy: { spendableSouls: observedFact(5000, 'test'), shopOpportunity: observedFact('AVAILABLE', 'test') },
  },
  itemGraph: graph,
  slots: deriveAdaptiveSlotStateV1(owned, graph, slotRules, { unlockedFlexSlots: 0, evidence: 'OBSERVED' }),
  investment: unknownAdaptiveInvestmentStateV1(),
};
const strategy: any = {
  schemaVersion: 1, strategyId: 's', heroId: 1, rulesetId: 'r1', sourcePatchId: 'p', support: 1, stability: 1,
  representativeTraceId: 't',
  goals: [
    { goalId: 'component', type: 'CORE', phase: 'EARLY', targetItemIds: [1], minSelect: 1, maxSelect: 1, prerequisiteGoalIds: [], hard: true, lifecycleByItemId: { 1: 'UPGRADE_COMPONENT' }, rationaleCodes: ['CORE'] },
    { goalId: 'branch-a', type: 'BRANCH', phase: 'MID', targetItemIds: [3], minSelect: 1, maxSelect: 1, prerequisiteGoalIds: [], hard: true, lifecycleByItemId: { 3: 'PERMANENT_CORE' }, rationaleCodes: ['BRANCH'] },
    { goalId: 'branch-b', type: 'BRANCH', phase: 'MID', targetItemIds: [4], minSelect: 1, maxSelect: 1, prerequisiteGoalIds: [], hard: true, lifecycleByItemId: { 4: 'PERMANENT_CORE' }, rationaleCodes: ['BRANCH'] },
  ],
  branchGroups: [{ branchGroupId: 'branch', optionGoalIds: ['branch-a', 'branch-b'], minSelect: 1, maxSelect: 1 }],
  situationalWindows: [], investmentPolicy: { objectives: [], preferredWeights: { weapon: 1, vitality: 0, spirit: 0 } },
  slotPolicy: { reservedSituationalSlots: 0, maxTemporarySlots: 0 }, terminalPolicy: { requiredGoalIds: ['component'], allowWaiveSoftGoals: true },
};

function baseResult(): any {
  return {
    strategy,
    strategySession: { strategyId: 's', commitment: 'COMMITTED', posterior: 1, selectedAtGameTimeSec: 0, replanReasons: [] },
    contract: {
      strategyId: 's', status: 'IN_PROGRESS', commitment: 'COMMITTED', currentGoalId: 'branch-a',
      goalStates: { component: 'SATISFIED', 'branch-a': 'ACTIVE', 'branch-b': 'SKIPPED' },
      selectedBranches: { branch: 'branch-a' }, committedBranches: { branch: 'branch-a' }, temporaryItemIds: [],
      reservedSituationalWindowIds: [], remainingHardGoalIds: ['branch-a'], completionReasonCodes: ['MANDATORY_GOALS_REMAIN'],
    },
    strategyPlan: {
      strategyId: 's', buildStatus: 'IN_PROGRESS', progress: { satisfiedHardGoals: 1, totalHardGoals: 2 },
      currentGoal: { goalId: 'branch-a', type: 'BRANCH', reasonCodes: ['BRANCH'] }, remainingGoalIds: ['branch-a'],
      remainingHardInvestmentObjectiveIds: [],
      slotPlan: { currentUsedSlots: 1, currentFlexUsed: 0, unlockedFlexSlots: 0, reservedSituationalSlots: 0, futureTransitions: [], feasible: true, reasonCodes: [] },
      investmentPlan: { objectives: [], activeObjectiveIds: [] },
    },
    nextAction: { actionKey: 'HOLD', type: 'HOLD', reasonCodes: ['TEST'] },
    recommendedBuild: [{ itemId: 2, position: 1, status: 'OWNED', score: 0, confidence: 1, skeletonStrength: 0, contextualSupport: 1, reasonCodes: [] }],
  };
}

describe('strategy-first runtime invariants v1', () => {
  it('rejects an already-satisfied ancestor from NEXT/PLANNED output', () => {
    const result = baseResult();
    result.recommendedBuild.push({ itemId: 1, position: 2, status: 'NEXT', score: 1, confidence: 1, skeletonStrength: 1, contextualSupport: 1, reasonCodes: [] });

    expect(evaluateStrategyFirstInvariantsV1({ decision, result }).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'REDUNDANT_ANCESTOR_IN_PLAN', itemId: 1 }),
    ]));
  });

  it('rejects false COMPLETE and losing branch rows', () => {
    const result = baseResult();
    result.contract.status = 'COMPLETE';
    result.strategyPlan.buildStatus = 'COMPLETE';
    result.recommendedBuild.push({ itemId: 4, position: 2, status: 'PLANNED', score: 1, confidence: 1, skeletonStrength: 1, contextualSupport: 1, reasonCodes: [] });

    const codes = evaluateStrategyFirstInvariantsV1({ decision, result }).violations.map((entry) => entry.code);
    expect(codes).toContain('FALSE_BUILD_COMPLETE');
    expect(codes).toContain('BRANCH_CONTRADICTION');
  });

  it('rejects an impossible transaction not present in the canonical legal candidate set', () => {
    const result = baseResult();
    result.nextAction = { actionKey: 'BUY_ITEM:999', type: 'BUY', itemId: 999, targetItemId: 999, reasonCodes: [] };

    expect(evaluateStrategyFirstInvariantsV1({ decision, result }).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ILLEGAL_NEXT_ACTION' }),
    ]));
  });

  it('rejects an unexplained committed strategy switch', () => {
    const result = baseResult();
    result.strategy.strategyId = 'new-strategy';
    result.strategySession.strategyId = 'new-strategy';

    expect(evaluateStrategyFirstInvariantsV1({
      decision,
      result,
      previousStrategy: { strategyId: 'old-strategy', commitment: 'COMMITTED' },
    }).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNEXPECTED_COMMITTED_STRATEGY_SWITCH' }),
    ]));
  });

  it('allows a committed strategy to rebase only through the explicit nearest OOD path', () => {
    const result = baseResult();
    result.strategy.strategyId = 'nearest-strategy';
    result.strategySession = {
      ...result.strategySession,
      strategyId: 'nearest-strategy',
      commitment: 'OOD',
      replanReasons: ['CURRENT_STATE_OUT_OF_DISTRIBUTION', 'OOD_NEAREST_STRATEGY_REBASE'],
    };
    result.contract.status = 'OUT_OF_DISTRIBUTION';
    result.contract.commitment = 'OOD';
    result.strategyPlan.buildStatus = 'OUT_OF_DISTRIBUTION';

    const codes = evaluateStrategyFirstInvariantsV1({
      decision,
      result,
      previousStrategy: { strategyId: 'old-strategy', commitment: 'COMMITTED' },
    }).violations.map((entry) => entry.code);
    expect(codes).not.toContain('UNEXPECTED_COMMITTED_STRATEGY_SWITCH');
  });

  it('rejects a WAIT target that disagrees with the first NEXT build row', () => {
    const result = baseResult();
    result.nextAction = { actionKey: 'WAIT_SAVE:4', type: 'WAIT', targetItemId: 4, reasonCodes: [] };
    result.recommendedBuild.push({ itemId: 3, position: 2, status: 'NEXT', score: 1, confidence: 1, skeletonStrength: 1, contextualSupport: 1, reasonCodes: [] });

    expect(evaluateStrategyFirstInvariantsV1({ decision, result }).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'NEXT_ACTION_BUILD_MISMATCH' }),
    ]));
  });

  it('accepts a WAIT target aligned with the first NEXT build row', () => {
    const result = baseResult();
    result.nextAction = { actionKey: 'WAIT_SAVE:3', type: 'WAIT', targetItemId: 3, reasonCodes: [] };
    result.recommendedBuild.push({ itemId: 3, position: 2, status: 'NEXT', score: 1, confidence: 1, skeletonStrength: 1, contextualSupport: 1, reasonCodes: [] });

    const codes = evaluateStrategyFirstInvariantsV1({ decision, result }).violations.map((entry) => entry.code);
    expect(codes).not.toContain('NEXT_ACTION_BUILD_MISMATCH');
  });

  it('summarizes release metrics as rates over evaluated decisions', () => {
    const clean = evaluateStrategyFirstInvariantsV1({ decision, result: baseResult() });
    const badResult = baseResult();
    badResult.recommendedBuild.push({ itemId: 1, position: 2, status: 'NEXT', score: 1, confidence: 1, skeletonStrength: 1, contextualSupport: 1, reasonCodes: [] });
    const bad = evaluateStrategyFirstInvariantsV1({ decision, result: badResult });

    const summary = summarizeStrategyFirstInvariantChecksV1([clean, bad]);
    expect(summary.evaluatedDecisions).toBe(2);
    expect(summary.redundantAncestorRate).toBe(0.5);
    expect(summary.illegalActionRate).toBe(0);
    expect(summary.nextActionBuildMismatchRate).toBe(0.5);
  });
});
