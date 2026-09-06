import { Injectable, Optional } from '@nestjs/common';
import { AdaptiveRecommendationResultV1 } from '@deadlock-live-probe/shared';
import { AdaptiveDecisionStateV1 } from './adaptive-decision-state-v1.service';
import { AdaptiveRecommendationObservabilityV1Service } from './adaptive-recommendation-observability-v1.service';
import { diffAdaptiveBuildPlansV1 } from './build-plan-diff-v1';
import { BuildStrategyRegistryV1Service } from './build-strategy-registry-v1.service';
import { ConsensusStrategyFallbackV1Service } from './consensus-strategy-fallback-v1.service';
import { StrategyFirstBuildPlannerV1Service } from './strategy-first-build-planner-v1.service';
import { BuildContractV1 } from './build-strategy-v1';
import { BuildStrategySessionV1 } from './build-strategy-session-v1.service';
import { StatlockerEvidenceBundleV1 } from './statlocker-evidence.service';
import { ConsensusSkeletonV1 } from './statlocker-adaptive.types';
import { StrategyFirstSituationalOverlayV1Service } from './strategy-first-situational-overlay-v1.service';
import {
  StrategyFirstInvariantCheckV1,
  evaluateStrategyFirstInvariantsV1,
} from './strategy-first-invariants-v1';
import {
  StrategyFirstTransactionPlanResultV1,
  StrategyFirstTransactionPlanV1Service,
} from './strategy-first-transaction-plan-v1.service';
import {
  TransactionPlanInvariantCheckV1,
  evaluateTransactionPlanInvariantsV1,
} from './transaction-plan-invariants-v1';

export type StrategyFirstPreviousResultV1 = Pick<
  AdaptiveRecommendationResultV1,
  'recommendedBuild' | 'totalScore' | 'nextAction' | 'confidence' | 'strategy' | 'planSession'
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
    @Optional() private readonly transactionPlan?: StrategyFirstTransactionPlanV1Service,
    @Optional() private readonly situational?: StrategyFirstSituationalOverlayV1Service,
    @Optional() private readonly observability?: AdaptiveRecommendationObservabilityV1Service,
  ) {}

  plan(input: StrategyFirstAdaptivePlannerFacadeV1Input): StrategyFirstTransactionPlanResultV1 {
    let strategies = this.registry.getStrategies(
      input.decision.state.heroId,
      input.decision.rulesetId,
      input.decision.catalogSha256,
      input.evidence.statlockerPatchId,
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
    const planned = this.planner.plan({
      decision: input.decision,
      evidence: input.evidence,
      strategies,
      previousSession,
      previousContract,
      previousRecommendedBuild: input.previousResult?.recommendedBuild,
      recentPurchasedItemIds: input.recentPurchasedItemIds ?? [],
      recentSoldItemIds: input.recentSoldItemIds ?? [],
    });
    const overlaid = planned.contract.status === 'COMPLETE'
      ? planned
      : this.situational?.apply({
          result: planned,
          decision: input.decision,
          evidence: input.evidence,
        }) ?? planned;
    const transactionFirst = (this.transactionPlan ?? new StrategyFirstTransactionPlanV1Service()).apply({
      result: overlaid,
      decision: input.decision,
      previousPlanSession: input.previousResult?.planSession,
      recentPurchasedItemIds: input.recentPurchasedItemIds ?? [],
    });
    const withChanges: StrategyFirstTransactionPlanResultV1 = {
      ...transactionFirst,
      changes: input.previousResult
        ? diffAdaptiveBuildPlansV1(
            input.previousResult.recommendedBuild,
            transactionFirst.recommendedBuild,
            input.recentPurchasedItemIds ?? [],
            input.recentSoldItemIds ?? [],
          )
        : [],
    };

    const transactionInvariantCheck = evaluateTransactionPlanInvariantsV1({
      decision: input.decision,
      planSession: withChanges.planSession,
      nextAction: withChanges.nextAction,
      recommendedBuild: withChanges.recommendedBuild,
    });
    this.observability?.recordTransactionPlanInvariantCheck(transactionInvariantCheck);
    const transactionSafe = transactionInvariantCheck.valid
      ? withChanges
      : failClosedTransactionPlanResult(withChanges, input.decision, transactionInvariantCheck);

    const invariantCheck = evaluateStrategyFirstInvariantsV1({
      decision: input.decision,
      result: transactionSafe,
      previousStrategy: input.previousResult?.strategy,
    });
    this.observability?.recordStrategyInvariantCheck(invariantCheck);
    if (invariantCheck.valid) return withLegacyChanges(transactionSafe, input);

    return withLegacyChanges(
      failClosedStrategyResult(transactionSafe, input.decision, invariantCheck),
      input,
    );
  }
}

function withLegacyChanges(
  result: StrategyFirstTransactionPlanResultV1,
  input: StrategyFirstAdaptivePlannerFacadeV1Input,
): StrategyFirstTransactionPlanResultV1 {
  return {
    ...result,
    changes: input.previousResult
      ? diffAdaptiveBuildPlansV1(
          input.previousResult.recommendedBuild,
          result.recommendedBuild,
          input.recentPurchasedItemIds ?? [],
          input.recentSoldItemIds ?? [],
        )
      : [],
  };
}

function failClosedTransactionPlanResult(
  result: StrategyFirstTransactionPlanResultV1,
  decision: AdaptiveDecisionStateV1,
  check: TransactionPlanInvariantCheckV1,
): StrategyFirstTransactionPlanResultV1 {
  const violationReasons = check.violations.map((violation) => `TRANSACTION_INVARIANT:${violation.code}`);
  return failClosedBase(
    result,
    decision,
    'TRANSACTION_PLAN_INVARIANT_FAIL_CLOSED',
    violationReasons,
  );
}

function failClosedStrategyResult(
  result: StrategyFirstTransactionPlanResultV1,
  decision: AdaptiveDecisionStateV1,
  check: StrategyFirstInvariantCheckV1,
): StrategyFirstTransactionPlanResultV1 {
  const violationReasons = check.violations.map((violation) => `INVARIANT:${violation.code}`);
  return failClosedBase(
    result,
    decision,
    'STRATEGY_INVARIANT_FAIL_CLOSED',
    violationReasons,
  );
}

function failClosedBase(
  result: StrategyFirstTransactionPlanResultV1,
  decision: AdaptiveDecisionStateV1,
  failCode: string,
  violationReasons: readonly string[],
): StrategyFirstTransactionPlanResultV1 {
  const owned = new Set(decision.state.inventory.heldByItemId.keys());
  const completionReasonCodes = unique([
    ...result.contract.completionReasonCodes,
    failCode,
    ...violationReasons,
  ]).sort();
  const recommendedBuild = result.recommendedBuild
    .filter((row) => owned.has(row.itemId))
    .sort((a, b) => a.position - b.position || a.itemId - b.itemId)
    .map((row, index) => ({ ...row, position: index + 1, status: 'OWNED' as const }));
  return {
    ...result,
    contract: {
      ...result.contract,
      status: 'REPLAN_REQUIRED',
      completionReasonCodes,
    },
    strategyPlan: {
      ...result.strategyPlan,
      buildStatus: 'REPLAN_REQUIRED',
    },
    planSession: {
      ...result.planSession,
      state: 'REPLAN_REQUIRED',
      nextStepId: undefined,
      reasonCodes: unique([
        ...result.planSession.reasonCodes,
        failCode,
        ...violationReasons,
      ]),
    },
    nextAction: {
      actionKey: 'HOLD',
      type: 'HOLD',
      reasonCodes: [failCode, ...violationReasons],
    },
    recommendedBuild,
    rankedImmediateCandidates: [],
    totalScore: 0,
    confidence: 0,
  };
}

function previousStrategySession(
  previous: StrategyFirstPreviousResultV1 | undefined,
): BuildStrategySessionV1 | undefined {
  const strategy = previous?.strategy;
  if (!strategy) return undefined;
  return {
    strategyId: strategy.strategyId,
    commitment: strategy.commitment,
    posterior: Number.isFinite(strategy.posterior) ? strategy.posterior : 0,
    selectedAtGameTimeSec: strategy.selectedAtGameTimeSec ?? 0,
    replanReasons: [...(strategy.reasonCodes ?? [])],
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
    selectedBranches: { ...(strategy.selectedBranches ?? {}) },
    committedBranches: { ...(strategy.committedBranches ?? {}) },
    temporaryItemIds: [],
    reservedSituationalWindowIds: strategy.situationalDecision ? [strategy.situationalDecision.windowId] : [],
    activeSituationalDecision: strategy.situationalDecision
      ? {
          windowId: strategy.situationalDecision.windowId,
          purpose: strategy.situationalDecision.purpose as any,
          targetItemId: strategy.situationalDecision.targetItemId,
          enemyHeroIds: [...(strategy.situationalDecision.enemyHeroIds ?? [])],
          enemyItemIds: [...(strategy.situationalDecision.enemyItemIds ?? [])],
          statisticalSupport: 0,
          confidence: strategy.situationalDecision.confidence,
          slotImpact: 0,
          investmentImpact: 0,
          coreInterruptionSouls: 0,
          reasonCodes: [...(strategy.situationalDecision.reasonCodes ?? [])],
        }
      : undefined,
    remainingHardGoalIds: [...(strategy.remainingGoalIds ?? [])],
    completionReasonCodes: [],
  };
}

function asSkeleton(value: unknown, heroId: number): ConsensusSkeletonV1 | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const skeleton = value as Partial<ConsensusSkeletonV1>;
  if (skeleton.heroId !== heroId || !Array.isArray(skeleton.groups)) return undefined;
  return skeleton as ConsensusSkeletonV1;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}