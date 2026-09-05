import { Injectable } from '@nestjs/common';
import {
  RecommendationItemGraph,
  recommendationSlotUsageFor,
} from '@deadlock-live-probe/build-domain';
import {
  AdaptiveSlotStateV1,
  candidateGeneratorRulesFromSlotStateV1,
} from './adaptive-economy-v1';
import {
  BuildContractV1,
  BuildSlotPlanTransitionV1,
  BuildSlotPlanV1,
  BuildStrategySpecV1,
} from './build-strategy-v1';

export interface BuildSlotPlannerV1Input {
  strategy: BuildStrategySpecV1;
  contract: BuildContractV1;
  itemGraph: RecommendationItemGraph;
  ownedItemIds: readonly number[];
  slots: AdaptiveSlotStateV1;
}

@Injectable()
export class BuildSlotPlannerV1Service {
  plan(input: BuildSlotPlannerV1Input): BuildSlotPlanV1 {
    const owned = new Set(input.ownedItemIds);
    const goalById = new Map(input.strategy.goals.map((goal) => [goal.goalId, goal]));
    const transitions: BuildSlotPlanTransitionV1[] = [];
    const reasonCodes: string[] = [];
    let feasible = true;

    for (const goalId of input.contract.remainingHardGoalIds) {
      const goal = goalById.get(goalId);
      if (!goal || input.contract.goalStates[goalId] === 'SKIPPED') continue;
      const targetItemId = goal.targetItemIds.find((itemId) => !input.itemGraph.isTargetSatisfied(itemId, owned));
      if (targetItemId === undefined) continue;
      const transition = this.transitionForTarget(input, goalId, targetItemId);
      transitions.push(transition);
      if (transition.requirement === 'NONE') continue;
      if (transition.requirement === 'UPGRADE' || transition.requirement === 'SELL_TEMPORARY' ||
        transition.requirement === 'REPLACE' || transition.requirement === 'FLEX_UNLOCK') continue;
      feasible = false;
    }

    if (transitions.some((entry) => entry.requirement === 'FLEX_UNLOCK')) reasonCodes.push('FUTURE_GOAL_REQUIRES_FLEX_UNLOCK');
    if (transitions.some((entry) => entry.requirement === 'SELL_TEMPORARY')) reasonCodes.push('TEMPORARY_ITEM_EXIT_REQUIRED');
    if (transitions.some((entry) => entry.requirement === 'UPGRADE')) reasonCodes.push('UPGRADE_COMPRESSES_SLOT_PATH');
    if (!feasible) reasonCodes.push('NO_SLOT_FEASIBLE_PATH');

    return {
      currentUsedSlots: input.slots.usedSlots,
      currentFlexUsed: input.slots.usedFlexSlots,
      unlockedFlexSlots: input.slots.unlockedFlexSlots,
      reservedSituationalSlots: input.strategy.slotPolicy.reservedSituationalSlots,
      futureTransitions: transitions,
      feasible,
      reasonCodes: [...new Set(reasonCodes)].sort(),
    };
  }

  private transitionForTarget(
    input: BuildSlotPlannerV1Input,
    goalId: string,
    targetItemId: number,
  ): BuildSlotPlanTransitionV1 {
    const target = input.itemGraph.getItem(targetItemId);
    if (!target) {
      return {
        targetGoalId: goalId,
        targetItemId,
        requirement: 'REPLACE',
        reasonCodes: ['TARGET_ITEM_UNKNOWN'],
      };
    }

    const owned = new Set(input.ownedItemIds);
    const upgradeRecipe = target.upgradeRecipes.find((recipe) =>
      recipe.consumedItemIds.length > 0 && recipe.consumedItemIds.every((itemId) => owned.has(itemId)),
    );
    if (upgradeRecipe) {
      return {
        targetGoalId: goalId,
        targetItemId,
        requirement: 'UPGRADE',
        sourceItemId: upgradeRecipe.consumedItemIds[0],
        reasonCodes: ['OWNED_COMPONENT_REUSED'],
      };
    }

    if (this.canFit([...input.ownedItemIds, targetItemId], input)) {
      return {
        targetGoalId: goalId,
        targetItemId,
        requirement: 'NONE',
        reasonCodes: ['CURRENT_CAPACITY_SUFFICIENT'],
      };
    }

    for (const temporaryItemId of input.contract.temporaryItemIds) {
      if (!owned.has(temporaryItemId)) continue;
      const afterExit = input.ownedItemIds.filter((itemId) => itemId !== temporaryItemId);
      if (this.canFit([...afterExit, targetItemId], input)) {
        return {
          targetGoalId: goalId,
          targetItemId,
          requirement: 'SELL_TEMPORARY',
          sourceItemId: temporaryItemId,
          reasonCodes: ['TEMPORARY_ITEM_FREES_REQUIRED_SLOT'],
        };
      }
    }

    const requiredFlex = requiredFlexAfterAdd(input.ownedItemIds, targetItemId, input);
    if (requiredFlex <= input.slots.maxFlexSlots &&
      (input.slots.unlockedFlexSlots === undefined || requiredFlex > input.slots.unlockedFlexSlots)) {
      return {
        targetGoalId: goalId,
        targetItemId,
        requirement: 'FLEX_UNLOCK',
        requiredUnlockedFlexSlots: requiredFlex,
        reasonCodes: input.slots.unlockedFlexSlots === undefined
          ? ['FLEX_CAPACITY_UNKNOWN', 'TARGET_REQUIRES_FLEX']
          : ['TARGET_LOCKED_UNTIL_FLEX_UNLOCK'],
      };
    }

    return {
      targetGoalId: goalId,
      targetItemId,
      requirement: 'REPLACE',
      reasonCodes: ['EXPLICIT_REPLACEMENT_PATH_REQUIRED'],
    };
  }

  private canFit(itemIds: readonly number[], input: BuildSlotPlannerV1Input): boolean {
    const rules = candidateGeneratorRulesFromSlotStateV1(input.slots);
    const usage = recommendationSlotUsageFor(itemIds, input.itemGraph, rules);
    const unlocked = input.slots.unlockedFlexSlots;
    if (usage.flexUsed > input.slots.maxFlexSlots) return false;
    if (unlocked === undefined || usage.flexUsed > unlocked) return false;
    if (usage.activeItemsUsed > input.slots.maxActiveItems) return false;
    const reserved = input.strategy.slotPolicy.reservedSituationalSlots;
    return usage.flexUsed + reserved <= unlocked || usage.itemCount + reserved <= input.slots.baseSlots + unlocked;
  }
}

function requiredFlexAfterAdd(
  ownedItemIds: readonly number[],
  targetItemId: number,
  input: BuildSlotPlannerV1Input,
): number {
  const rules = candidateGeneratorRulesFromSlotStateV1(input.slots);
  return recommendationSlotUsageFor([...ownedItemIds, targetItemId], input.itemGraph, rules).flexUsed +
    input.strategy.slotPolicy.reservedSituationalSlots;
}
