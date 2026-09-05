import { Injectable } from '@nestjs/common';
import { AdaptiveRecommendationStrategyV1 } from '@deadlock-live-probe/shared';
import {
  AdaptiveBuildPlannerInputV1,
  AdaptiveBuildPlannerResultV1,
} from './adaptive-build-planner-v1.service';
import { StrategyFirstAdaptivePlannerFacadeV1Service } from './strategy-first-adaptive-planner-facade-v1.service';
import { StrategyFirstBuildPlannerV1Result } from './strategy-first-build-planner-v1.service';

export type StrategyFirstLegacyPlannerResultV1 = AdaptiveBuildPlannerResultV1 & {
  strategy: AdaptiveRecommendationStrategyV1;
};

/**
 * Compatibility adapter for existing recommendation/replay call sites while the external API
 * remains on AdaptiveRecommendationResultV1. Runtime semantics come from the strategy-first
 * planner; the legacy planner version string is retained only so persisted V1 replay inputs stay readable.
 */
@Injectable()
export class StrategyFirstLegacyPlannerAdapterV1Service {
  readonly version = 'adaptive-build-planner-v1' as const;

  constructor(private readonly strategyPlanner: StrategyFirstAdaptivePlannerFacadeV1Service) {}

  plan(input: AdaptiveBuildPlannerInputV1): StrategyFirstLegacyPlannerResultV1 {
    const result = this.strategyPlanner.plan({
      decision: input.decision,
      evidence: input.evidence,
      previousResult: input.previousResult as any,
      recentPurchasedItemIds: input.recentPurchasedItemIds,
      recentSoldItemIds: input.recentSoldItemIds,
    });
    return {
      gameState: result.gameState,
      nextAction: result.nextAction,
      recommendedBuild: result.recommendedBuild,
      changes: result.changes,
      rankedImmediateCandidates: result.rankedImmediateCandidates,
      totalScore: result.totalScore,
      confidence: result.confidence,
      plannerVersion: this.version,
      strategy: toAdaptiveRecommendationStrategyV1(result),
    };
  }
}

export function toAdaptiveRecommendationStrategyV1(
  result: Pick<
    StrategyFirstBuildPlannerV1Result,
    'strategy' | 'strategySession' | 'contract' | 'strategyPlan'
  >,
): AdaptiveRecommendationStrategyV1 {
  const session = result.strategySession;
  const plan = result.strategyPlan;
  const slotPlan = plan.slotPlan;
  const investmentPlan = plan.investmentPlan;
  return {
    strategyId: session.strategyId ?? result.strategy.strategyId,
    commitment: session.commitment,
    selectedAtGameTimeSec: session.selectedAtGameTimeSec,
    posterior: session.posterior,
    reasonCodes: [...(session.replanReasons ?? [])],
    selectedBranches: { ...(result.contract.selectedBranches ?? {}) },
    committedBranches: { ...(result.contract.committedBranches ?? {}) },
    buildStatus: plan.buildStatus,
    progress: { ...plan.progress },
    currentGoal: plan.currentGoal
      ? {
          goalId: plan.currentGoal.goalId,
          type: plan.currentGoal.type,
          reasonCodes: [...(plan.currentGoal.reasonCodes ?? [])],
        }
      : undefined,
    remainingGoalIds: [...(plan.remainingGoalIds ?? [])],
    remainingHardInvestmentObjectiveIds: [...(plan.remainingHardInvestmentObjectiveIds ?? [])],
    slotPlan: {
      currentUsedSlots: slotPlan.currentUsedSlots,
      currentFlexUsed: slotPlan.currentFlexUsed,
      unlockedFlexSlots: slotPlan.unlockedFlexSlots,
      reservedSituationalSlots: slotPlan.reservedSituationalSlots,
      feasible: slotPlan.feasible,
      reasonCodes: [...(slotPlan.reasonCodes ?? [])],
      futureTransitions: (slotPlan.futureTransitions ?? []).map((transition) => ({
        targetGoalId: transition.targetGoalId,
        targetItemId: transition.targetItemId,
        requirement: transition.requirement,
        sourceItemId: transition.sourceItemId,
        requiredUnlockedFlexSlots: transition.requiredUnlockedFlexSlots,
        reasonCodes: [...(transition.reasonCodes ?? [])],
      })),
    },
    investmentObjectives: (investmentPlan?.objectives ?? []).map((objective) => ({
      objectiveId: objective.objectiveId,
      type: objective.type,
      state: objective.state,
      currentValue: objective.currentValue,
      targetValue: objective.targetValue,
      distance: objective.distance,
      reasonCodes: [...(objective.reasonCodes ?? [])],
    })),
    situationalDecision: plan.situationalDecision
      ? {
          windowId: plan.situationalDecision.windowId,
          purpose: plan.situationalDecision.purpose,
          targetItemId: plan.situationalDecision.targetItemId,
          enemyHeroIds: [...(plan.situationalDecision.enemyHeroIds ?? [])],
          enemyItemIds: [...(plan.situationalDecision.enemyItemIds ?? [])],
          confidence: plan.situationalDecision.confidence,
          reasonCodes: [...(plan.situationalDecision.reasonCodes ?? [])],
        }
      : undefined,
  };
}
