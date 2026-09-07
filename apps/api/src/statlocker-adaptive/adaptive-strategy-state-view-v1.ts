import {
  AdaptiveBuildContractViewV1,
  AdaptiveStrategySessionViewV1,
} from '@deadlock-live-probe/shared';
import { BuildContractV1 } from './build-contract-v1';
import { AdaptiveStrategySessionV1 } from './strategy-session-v1';

export function toAdaptiveBuildContractViewV1(
  contract: BuildContractV1,
): AdaptiveBuildContractViewV1 {
  return {
    ...(contract.strategyId === undefined ? {} : { strategyId: contract.strategyId }),
    status: contract.status,
    ...(contract.currentGoalId === undefined ? {} : { currentGoalId: contract.currentGoalId }),
    completedGoalIds: [...contract.completedGoalIds].sort(),
    remainingGoalIds: [...contract.remainingGoalIds],
    committedChoices: [...contract.committedChoiceItemIdsByGroup.entries()]
      .map(([groupId, itemIds]) => ({
        groupId,
        itemIds: [...new Set(itemIds)].sort((left, right) => left - right),
      }))
      .sort((left, right) => left.groupId.localeCompare(right.groupId)),
    temporaryItemIds: [...contract.temporaryItemIds].sort((left, right) => left - right),
    slotReservations: contract.slotReservations.map((reservation) => ({
      goalId: reservation.goalId,
      targetItemId: reservation.targetItemId,
      state: reservation.state,
      reasonCodes: [...reservation.reasonCodes],
    })),
    situationalWindowStates: contract.situationalWindowStates.map((window) => ({
      windowId: window.windowId,
      state: window.state,
      targetItemIds: [...window.targetItemIds],
      reasonCodes: [...window.reasonCodes],
    })),
    replanReasonCodes: [...contract.replanReasonCodes],
  };
}

export function toAdaptiveStrategySessionViewV1(
  session: AdaptiveStrategySessionV1,
): AdaptiveStrategySessionViewV1 {
  return {
    state: session.state,
    ...(session.strategyId === undefined ? {} : { strategyId: session.strategyId }),
    ...(session.strategyPosterior === undefined ? {} : { strategyPosterior: session.strategyPosterior }),
    heroId: session.heroId,
    rulesetId: session.rulesetId,
    catalogSha256: session.catalogSha256,
    ...(session.committedAtDecisionId === undefined
      ? {}
      : { committedAtDecisionId: session.committedAtDecisionId }),
    divergenceCount: session.divergenceCount,
    lastTransitionReasonCodes: [...session.lastTransitionReasonCodes],
  };
}
