import { Injectable } from '@nestjs/common';
import { AdaptiveRecommendationResultV1 } from '@deadlock-live-probe/shared';
import { AdaptiveDecisionStateV1 } from './adaptive-decision-state-v1.service';
import { BuildStrategyRegistryV1Service } from './build-strategy-registry-v1.service';
import { ConsensusStrategyFallbackV1Service } from './consensus-strategy-fallback-v1.service';
import {
  StrategyFirstBuildPlannerV1Result,
  StrategyFirstBuildPlannerV1Service,
} from './strategy-first-build-planner-v1.service';
import { BuildContractV1 } from './build-strategy-v1';
import { BuildStrategySessionV1 } from './build-strategy-session-v1.service';
import { StatlockerEvidenceBundleV1 } from './statlocker-evidence.service';
import { ConsensusSkeletonV1 } from './statlocker-adaptive.types';

export type StrategyFirstPreviousResultV1 = Pick<
  AdaptiveRecommendationResultV1,
  'recommendedBuild' | 'totalScore' | 'nextAction' | 'confidence' | 'strategy'
>;

export interface StrategyFirstAdaptivePlannerFacadeV1Input {
  decision: AdaptiveDecisionStateV1;
  evidence: StatlockerEvidenceBundleV1;
  previousResult?: StrategyFirstPreviousResultV1;
  recentPurchasedItemIds?: readonly number[];
  recentSoldItemIds?: readonly number[];
}

@Injectable()
export class StrategyFirstAdaptivePlannerFacadeV1Service {
  constructor(
    private readonly planner: StrategyFirstBuildPlannerV1Service,
    private readonly registry: BuildStrategyRegistryV1Service,
    private readonly fallback: ConsensusStrategyFallbackV1Service,
  ) {}

  plan(input: StrategyFirstAdaptivePlannerFacadeV1Input): StrategyFirstBuildPlannerV1Result {
    let strategies = this.registry.getStrategies(
      input.decision.state.heroId,
      input.decision.rulesetId,
      input.decision.catalogSha256,
    );
    if (strategies.length === 0) {
      const skeleton = asSkeleton(input.evidence.byDataset.CONSENSUS_SKELETON.payload, input.decision.state.heroId);
      if (!skeleton) throw new Error('No strategy snapshot or structured consensus fallback is available');
      strategies = [this.fallback.compile(
        skeleton,
        input.decision.itemGraph,
        input.decision.rulesetId,
        input.evidence.statlockerPatchId,
      )];
    }

    const previousSession = previousStrategySession(input.previousResult);
    const previousContract = previousBuildContract(input.previousResult);
    return this.planner.plan({
      decision: input.decision,
      evidence: input.evidence,
      strategies,
      previousSession,
      previousContract,
      previousRecommendedBuild: input.previousResult?.recommendedBuild,
      recentPurchasedItemIds: input.recentPurchasedItemIds,
      recentSoldItemIds: input.recentSoldItemIds,
    } as Parameters<StrategyFirstBuildPlannerV1Service['plan']>[0]);
  }
}

function previousStrategySession(
  previous: StrategyFirstPreviousResultV1 | undefined,
): BuildStrategySessionV1 | undefined {
  const strategy = previous?.strategy;
  if (!strategy) return undefined;
  return {
    strategyId: strategy.strategyId,
    commitment: strategy.commitment,
    posterior: strategy.posterior,
    selectedAtGameTimeSec: strategy.selectedAtGameTimeSec ?? 0,
    replanReasons: [...strategy.reasonCodes],
  };
}

function previousBuildContract(
  previous: StrategyFirstPreviousResultV1 | undefined,
): BuildContractV1 | undefined {
  const strategy = previous?.strategy;
  if (!strategy) return undefined;
  return {
    strategyId: strategy.strategyId,
    status: strategy.buildStatus,
    commitment: strategy.commitment,
    currentGoalId: strategy.currentGoal?.goalId,
    goalStates: {},
    selectedBranches: { ...strategy.selectedBranches },
    committedBranches: { ...strategy.committedBranches },
    temporaryItemIds: [],
    reservedSituationalWindowIds: strategy.situationalDecision ? [strategy.situationalDecision.windowId] : [],
    activeSituationalDecision: strategy.situationalDecision
      ? {
          windowId: strategy.situationalDecision.windowId,
          purpose: strategy.situationalDecision.purpose as any,
          targetItemId: strategy.situationalDecision.targetItemId,
          enemyHeroIds: [...strategy.situationalDecision.enemyHeroIds],
          enemyItemIds: [...strategy.situationalDecision.enemyItemIds],
          statisticalSupport: 0,
          confidence: strategy.situationalDecision.confidence,
          slotImpact: 0,
          investmentImpact: 0,
          coreInterruptionSouls: 0,
          reasonCodes: [...strategy.situationalDecision.reasonCodes],
        }
      : undefined,
    remainingHardGoalIds: [...strategy.remainingGoalIds],
    completionReasonCodes: [],
  };
}

function asSkeleton(value: unknown, heroId: number): ConsensusSkeletonV1 | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const skeleton = value as Partial<ConsensusSkeletonV1>;
  if (skeleton.heroId !== heroId || !Array.isArray(skeleton.groups)) return undefined;
  return skeleton as ConsensusSkeletonV1;
}
