import {
  RecommendationItemDefinition,
  buildInventoryInstancesForRecommendation,
  createRecommendationItemGraph,
  observedFact,
} from '@deadlock-live-probe/build-domain';
import {
  isPlanBarrierSatisfiedV1,
  isTransactionStepSatisfiedV1,
  transactionPlanStepIdV1,
} from '../src/statlocker-adaptive/transaction-plan-step-v1';

const items: RecommendationItemDefinition[] = [
  {
    itemId: 101, name: 'Component', slotType: 'spirit', active: false, availableRulesetIds: ['r1'],
    directPurchaseCost: 500, upgradeRecipes: [], sellTransition: { soulsRefund: 250, returnedItemIds: [] }, maxCopies: 1,
  },
  {
    itemId: 202, name: 'Upgrade', slotType: 'spirit', active: false, availableRulesetIds: ['r1'],
    upgradeRecipes: [{ recipeId: 'upgrade-202', consumedItemIds: [101], soulsCost: 1000 }],
    sellTransition: { soulsRefund: 500, returnedItemIds: [] }, maxCopies: 1,
  },
  {
    itemId: 303, name: 'Descendant', slotType: 'spirit', active: false, availableRulesetIds: ['r1'],
    upgradeRecipes: [{ recipeId: 'upgrade-303', consumedItemIds: [202], soulsCost: 1000 }],
    sellTransition: { soulsRefund: 750, returnedItemIds: [] }, maxCopies: 1,
  },
];
const graph = createRecommendationItemGraph(items);

function decision(ownedItemIds: readonly number[], souls: number, shop: 'AVAILABLE' | 'UNAVAILABLE' = 'AVAILABLE') {
  const held = buildInventoryInstancesForRecommendation(ownedItemIds, graph);
  return {
    decisionId: 'd', matchId: 'm', playerSlot: 0, gameTimeSec: 100, rulesetId: 'r1', heroId: 1,
    inventory: {
      initializedFromSnapshot: true,
      heldByItemId: held,
      lifecycleCountByItemId: new Map(ownedItemIds.map((itemId) => [itemId, 1])),
      nextInstanceSequence: held.size + 1,
    },
    economy: {
      spendableSouls: observedFact(souls, 'test'),
      shopOpportunity: observedFact(shop, 'test'),
    },
  };
}

const projection = {
  inventoryItemIds: [] as number[],
  spendableSouls: 1000,
  usedByType: { weapon: 0, vitality: 0, spirit: 0 },
  flexUsed: 0,
  unlockedFlexSlots: 0,
  activeItemsUsed: 0,
};

describe('transaction plan step v1', () => {
  it('keeps semantic step identity stable and changes it when the replacement source changes', () => {
    const base = {
      strategyId: 's', goalId: 'g', kind: 'TRANSACTION' as const, type: 'SELL_AND_BUY', targetItemId: 202, sellItemId: 101,
    };
    expect(transactionPlanStepIdV1(base)).toBe(transactionPlanStepIdV1({ ...base }));
    expect(transactionPlanStepIdV1(base)).not.toBe(transactionPlanStepIdV1({ ...base, sellItemId: 303 }));
  });

  it('sorts consumed item ids before fingerprinting', () => {
    const a = transactionPlanStepIdV1({
      strategyId: 's', goalId: 'g', kind: 'TRANSACTION', type: 'UPGRADE', targetItemId: 303, consumedItemIds: [202, 101],
    });
    const b = transactionPlanStepIdV1({
      strategyId: 's', goalId: 'g', kind: 'TRANSACTION', type: 'UPGRADE', targetItemId: 303, consumedItemIds: [101, 202],
    });
    expect(a).toBe(b);
  });

  it('recognizes BUY satisfaction through exact ownership or an owned upgrade descendant', () => {
    const step = {
      stepId: 'buy', goalId: 'g', kind: 'TRANSACTION' as const, state: 'NEXT' as const,
      action: { type: 'BUY' as const, buyItemId: 202 }, prerequisiteStepIds: [], blockingReasons: [], projectedBefore: projection, reasonCodes: [],
    };
    expect(isTransactionStepSatisfiedV1(step, decision([202], 0), graph)).toBe(true);
    expect(isTransactionStepSatisfiedV1(step, decision([303], 0), graph)).toBe(true);
    expect(isTransactionStepSatisfiedV1(step, decision([101], 0), graph)).toBe(false);
  });

  it('requires consumed components to be gone for UPGRADE completion', () => {
    const step = {
      stepId: 'upgrade', goalId: 'g', kind: 'TRANSACTION' as const, state: 'NEXT' as const,
      action: { type: 'UPGRADE' as const, buyItemId: 202, consumedItemIds: [101], recipeId: 'upgrade-202' },
      prerequisiteStepIds: [], blockingReasons: [], projectedBefore: projection, reasonCodes: [],
    };
    expect(isTransactionStepSatisfiedV1(step, decision([202], 0), graph)).toBe(true);
    expect(isTransactionStepSatisfiedV1(step, decision([101, 202], 0), graph)).toBe(false);
    expect(isTransactionStepSatisfiedV1(step, decision([303], 0), graph)).toBe(true);
  });

  it('requires replacement target satisfaction and sold item absence', () => {
    const step = {
      stepId: 'replace', goalId: 'g', kind: 'TRANSACTION' as const, state: 'NEXT' as const,
      action: { type: 'SELL_AND_BUY' as const, sellItemId: 101, buyItemId: 202 },
      prerequisiteStepIds: [], blockingReasons: [], projectedBefore: projection, reasonCodes: [],
    };
    expect(isTransactionStepSatisfiedV1(step, decision([202], 0), graph)).toBe(true);
    expect(isTransactionStepSatisfiedV1(step, decision([101, 202], 0), graph)).toBe(false);
  });

  it('evaluates gold, flex, and shop barriers from exact current evidence', () => {
    expect(isPlanBarrierSatisfiedV1({ type: 'WAIT_FOR_GOLD', targetItemId: 202, requiredSouls: 1200 }, decision([], 1199), 0)).toBe(false);
    expect(isPlanBarrierSatisfiedV1({ type: 'WAIT_FOR_GOLD', targetItemId: 202, requiredSouls: 1200 }, decision([], 1200), 0)).toBe(true);
    expect(isPlanBarrierSatisfiedV1({ type: 'WAIT_FOR_FLEX', targetItemId: 202, requiredUnlockedFlexSlots: 2 }, decision([], 0), 1)).toBe(false);
    expect(isPlanBarrierSatisfiedV1({ type: 'WAIT_FOR_FLEX', targetItemId: 202, requiredUnlockedFlexSlots: 2 }, decision([], 0), 2)).toBe(true);
    expect(isPlanBarrierSatisfiedV1({ type: 'WAIT_FOR_SHOP', targetItemId: 202 }, decision([], 0, 'UNAVAILABLE'), 0)).toBe(false);
    expect(isPlanBarrierSatisfiedV1({ type: 'WAIT_FOR_SHOP', targetItemId: 202 }, decision([], 0, 'AVAILABLE'), 0)).toBe(true);
  });
});
