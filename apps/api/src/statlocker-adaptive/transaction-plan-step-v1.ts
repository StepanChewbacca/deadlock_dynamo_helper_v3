import { createHash } from 'node:crypto';
import {
  RecommendationCandidateGeneratorRules,
  RecommendationDecisionState,
  RecommendationItemGraph,
  recommendationSlotUsageFor,
} from '@deadlock-live-probe/build-domain';
import {
  AdaptivePlanBarrierV1,
  AdaptivePlanProjectionV1,
  AdaptivePlanStepV1,
} from '@deadlock-live-probe/shared';

export interface TransactionPlanStepIdentityV1 {
  strategyId: string;
  goalId: string;
  kind: 'TRANSACTION' | 'BARRIER';
  type: string;
  targetItemId?: number;
  sellItemId?: number;
  consumedItemIds?: readonly number[];
  branchId?: string;
}

export function transactionPlanStepIdV1(input: TransactionPlanStepIdentityV1): string {
  const normalized = {
    strategyId: input.strategyId,
    goalId: input.goalId,
    kind: input.kind,
    type: input.type,
    targetItemId: input.targetItemId,
    sellItemId: input.sellItemId,
    consumedItemIds: [...(input.consumedItemIds ?? [])].sort((a, b) => a - b),
    branchId: input.branchId,
  };
  return `step:${createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 24)}`;
}

export function planProjectionFromDecisionStateV1(
  state: RecommendationDecisionState,
  graph: RecommendationItemGraph,
  rules: RecommendationCandidateGeneratorRules,
): AdaptivePlanProjectionV1 {
  const inventoryItemIds = [...state.inventory.heldByItemId.keys()].sort((a, b) => a - b);
  const usage = recommendationSlotUsageFor(inventoryItemIds, graph, rules);
  const unlockedFlexSlots = rules.flexCapacityEvidence === 'UNKNOWN'
    ? (usage.flexUsed > 0 ? usage.flexUsed : undefined)
    : Math.max(usage.flexUsed, rules.unlockedFlexSlots ?? 0);
  return {
    inventoryItemIds,
    spendableSouls: state.economy.spendableSouls.evidence === 'UNKNOWN'
      ? undefined
      : state.economy.spendableSouls.value,
    usedByType: { ...usage.usedByType },
    flexUsed: usage.flexUsed,
    unlockedFlexSlots,
    activeItemsUsed: usage.activeItemsUsed,
  };
}

export function isPlanBarrierSatisfiedV1(
  barrier: AdaptivePlanBarrierV1,
  decision: RecommendationDecisionState,
  unlockedFlexSlots?: number,
): boolean {
  switch (barrier.type) {
    case 'WAIT_FOR_GOLD': {
      if (decision.economy.spendableSouls.evidence === 'UNKNOWN') return false;
      const souls = decision.economy.spendableSouls.value;
      return souls !== undefined && souls >= barrier.requiredSouls;
    }
    case 'WAIT_FOR_FLEX':
      return unlockedFlexSlots !== undefined && unlockedFlexSlots >= barrier.requiredUnlockedFlexSlots;
    case 'WAIT_FOR_SHOP':
      return decision.economy.shopOpportunity.evidence !== 'UNKNOWN' &&
        decision.economy.shopOpportunity.value === 'AVAILABLE';
    case 'WAIT_FOR_PREREQUISITE':
      return false;
  }
}

export function isTransactionStepSatisfiedV1(
  step: AdaptivePlanStepV1,
  decision: RecommendationDecisionState,
  graph: RecommendationItemGraph,
): boolean {
  if (step.kind !== 'TRANSACTION' || !step.action) return false;
  const owned = decision.inventory.heldByItemId.keys();
  switch (step.action.type) {
    case 'BUY':
      return graph.isTargetSatisfied(step.action.buyItemId, owned);
    case 'UPGRADE': {
      if (!graph.isTargetSatisfied(step.action.buyItemId, owned)) return false;
      return step.action.consumedItemIds.every((itemId) => !decision.inventory.heldByItemId.has(itemId));
    }
    case 'SELL_AND_BUY':
      return graph.isTargetSatisfied(step.action.buyItemId, owned) &&
        !decision.inventory.heldByItemId.has(step.action.sellItemId);
  }
}
