import { Injectable, Logger } from '@nestjs/common';
import {
  AdaptivePlanSessionV1,
  AdaptiveRecommendationStrategyV1,
} from '@deadlock-live-probe/shared';
import {
  AdaptiveBuildPlannerInputV1,
  AdaptiveBuildPlannerResultV1,
  AdaptiveBuildPlannerV1Service,
} from './adaptive-build-planner-v1.service';
import { AdaptiveChoiceResolverV1Service } from './adaptive-choice-resolver-v1.service';
import { AdaptiveEvidenceScorerV1Service } from './adaptive-evidence-scorer-v1.service';
import { AdaptivePhaseEligibilityV1Service } from './adaptive-phase-eligibility-v1.service';
import { StrategyFirstLegacyPlannerAdapterV1Service } from './strategy-first-legacy-planner-adapter-v1.service';
import { StrategyFirstPromotionGateV1Service } from './strategy-first-promotion-gate-v1.service';

export type AdaptivePlannerServingResultV1 = AdaptiveBuildPlannerResultV1 & {
  strategy?: AdaptiveRecommendationStrategyV1;
  planSession?: AdaptivePlanSessionV1;
};

@Injectable()
export class AdaptivePlannerServingRouterV1Service {
  readonly version = 'adaptive-build-planner-v1' as const;
  private readonly logger = new Logger(AdaptivePlannerServingRouterV1Service.name);
  private readonly legacy: AdaptiveBuildPlannerV1Service;

  constructor(
    private readonly strategy: StrategyFirstLegacyPlannerAdapterV1Service,
    scorer: AdaptiveEvidenceScorerV1Service,
    phaseEligibility: AdaptivePhaseEligibilityV1Service,
    choiceResolver: AdaptiveChoiceResolverV1Service,
    private readonly promotion: StrategyFirstPromotionGateV1Service,
  ) {
    this.legacy = new AdaptiveBuildPlannerV1Service(scorer, phaseEligibility, choiceResolver);
  }

  plan(input: AdaptiveBuildPlannerInputV1): AdaptivePlannerServingResultV1 {
    const configuredMode = this.promotion.configuredMode();
    if (configuredMode === 'LEGACY') {
      const legacyResult = this.legacy.plan(input);
      this.logLegacyFlatFallback(input, legacyResult, 'STRATEGY_MODE_LEGACY');
      return legacyResult;
    }

    let transactionResult: AdaptivePlannerServingResultV1;
    try {
      transactionResult = this.strategy.plan(input);
    } catch (error) {
      this.promotion.recordShadowFailure();
      this.promotion.recordTransactionShadowFailure();
      const legacyResult = this.legacy.plan(input);
      this.logger.warn(`strategy-shadow-failure ${JSON.stringify({
        decisionId: input.decision.state.decisionId,
        error: describeError(error),
        legacyNextAction: legacyResult.nextAction,
        reasonCode: 'LEGACY_FLAT_PLAN_FALLBACK',
      })}`);
      return legacyResult;
    }

    if (configuredMode === 'SHADOW') {
      const legacyResult = this.legacy.plan(input);
      this.promotion.recordShadowSuccess();
      this.logShadowComparison(input, transactionResult, legacyResult, 'SHADOW');
      return legacyResult;
    }

    if (input.decision.economyRulesEvidence !== 'RECONSTRUCTED') {
      const legacyResult = this.legacy.plan(input);
      this.promotion.recordShadowSuccess();
      this.promotion.recordPromotionBlocked();
      this.logShadowComparison(input, transactionResult, legacyResult, 'EXACT_ECONOMY_RULES_BLOCKED');
      return legacyResult;
    }

    if (!this.promotion.canServeStrategy()) {
      const legacyResult = this.legacy.plan(input);
      this.promotion.recordShadowSuccess();
      this.promotion.recordPromotionBlocked();
      this.logShadowComparison(input, transactionResult, legacyResult, 'PROMOTION_BLOCKED');
      return legacyResult;
    }

    return this.routeTransactionPlan(input, transactionResult);
  }

  private routeTransactionPlan(
    input: AdaptiveBuildPlannerInputV1,
    transactionResult: AdaptivePlannerServingResultV1,
  ): AdaptivePlannerServingResultV1 {
    const transactionMode = this.promotion.transactionConfiguredMode();
    if (transactionMode === 'FLAT_COMPAT') {
      const flat = this.strategy.planFlatCompat(input);
      this.logTransactionComparison(input, transactionResult, flat, 'FLAT_COMPAT');
      return flat;
    }

    if (transactionMode === 'TRANSACTION_SHADOW') {
      const flat = this.strategy.planFlatCompat(input);
      this.promotion.recordTransactionShadowSuccess();
      this.logTransactionComparison(input, transactionResult, flat, 'TRANSACTION_SHADOW');
      return flat;
    }

    if (!this.promotion.canServeTransactionPlan()) {
      const flat = this.strategy.planFlatCompat(input);
      this.promotion.recordTransactionShadowSuccess();
      this.promotion.recordTransactionPromotionBlocked();
      this.logTransactionComparison(input, transactionResult, flat, 'TRANSACTION_PROMOTION_BLOCKED');
      return flat;
    }

    this.logger.debug(`transaction-plan-serving ${JSON.stringify(strategyDiagnostics(input, transactionResult))}`);
    return transactionResult;
  }

  private logShadowComparison(
    input: AdaptiveBuildPlannerInputV1,
    strategyResult: AdaptivePlannerServingResultV1,
    legacyResult: AdaptiveBuildPlannerResultV1,
    mode: 'SHADOW' | 'PROMOTION_BLOCKED' | 'EXACT_ECONOMY_RULES_BLOCKED',
  ): void {
    this.logger.debug(`strategy-shadow ${JSON.stringify({
      mode,
      ...strategyDiagnostics(input, strategyResult),
      legacy: legacyDiagnostics(legacyResult),
    })}`);
  }

  private logTransactionComparison(
    input: AdaptiveBuildPlannerInputV1,
    transactionResult: AdaptivePlannerServingResultV1,
    flatResult: AdaptivePlannerServingResultV1,
    mode: 'FLAT_COMPAT' | 'TRANSACTION_SHADOW' | 'TRANSACTION_PROMOTION_BLOCKED',
  ): void {
    const session = transactionResult.planSession;
    this.logger.debug(`transaction-plan-shadow ${JSON.stringify({
      mode,
      decisionId: input.decision.state.decisionId,
      stateRevision: input.decision.stateRevision,
      nextActionAgreement: sameAction(transactionResult, flatResult),
      futureTargetAgreement: firstFutureTarget(transactionResult) === firstFutureTarget(flatResult),
      replacementRequirementDisagreement: replacementSignature(transactionResult) !== replacementSignature(flatResult),
      barrierCount: session?.steps.filter((step) => step.kind === 'BARRIER').length ?? 0,
      planSessionId: session?.planSessionId,
      planRevision: session?.revision,
      planState: session?.state,
      stepCount: session?.steps.length ?? 0,
      firstBarrierReason: session?.steps.find((step) => step.kind === 'BARRIER' && step.state === 'BLOCKED')?.barrier?.type,
      transaction: strategyDiagnostics(input, transactionResult),
      flat: {
        ...strategyDiagnostics(input, flatResult),
        planSession: undefined,
      },
    })}`);
  }

  private logLegacyFlatFallback(
    input: AdaptiveBuildPlannerInputV1,
    result: AdaptiveBuildPlannerResultV1,
    mode: string,
  ): void {
    this.logger.debug(`legacy-flat-plan ${JSON.stringify({
      mode,
      decisionId: input.decision.state.decisionId,
      stateRevision: input.decision.stateRevision,
      reasonCode: 'LEGACY_FLAT_PLAN_FALLBACK',
      ...legacyDiagnostics(result),
    })}`);
  }
}

function strategyDiagnostics(
  input: AdaptiveBuildPlannerInputV1,
  result: AdaptivePlannerServingResultV1,
): Record<string, unknown> {
  const strategy = result.strategy;
  const session = result.planSession;
  return {
    decisionId: input.decision.state.decisionId,
    stateRevision: input.decision.stateRevision,
    economyRulesEvidence: input.decision.economyRulesEvidence,
    strategyId: strategy?.strategyId,
    strategyStability: strategy?.stability,
    commitment: strategy?.commitment,
    buildStatus: strategy?.buildStatus,
    currentGoal: strategy?.currentGoal,
    remainingGoalIds: strategy?.remainingGoalIds ?? [],
    remainingHardInvestmentObjectiveIds: strategy?.remainingHardInvestmentObjectiveIds ?? [],
    fullPlan: result.recommendedBuild.map((item) => ({
      itemId: item.itemId,
      position: item.position,
      status: item.status,
    })),
    planSession: session
      ? {
          planSessionId: session.planSessionId,
          revision: session.revision,
          state: session.state,
          nextStepId: session.nextStepId,
          steps: session.steps.map((step) => ({
            stepId: step.stepId,
            goalId: step.goalId,
            kind: step.kind,
            state: step.state,
            action: step.action,
            barrier: step.barrier,
            projectedBefore: step.projectedBefore,
            projectedAfter: step.projectedAfter,
          })),
        }
      : undefined,
    nextAction: result.nextAction,
    nextReasonCodes: result.nextAction.reasonCodes,
    slotPlan: strategy?.slotPlan,
    strategySwitchReasons: strategy?.reasonCodes ?? [],
    situational: strategy?.situationalDecision,
    coreInterruptionSouls: strategy?.situationalDecision?.coreInterruptionSouls,
    hold: result.nextAction.type === 'HOLD',
    complete: strategy?.buildStatus === 'COMPLETE',
    totalScore: result.totalScore,
    confidence: result.confidence,
  };
}

function legacyDiagnostics(result: AdaptiveBuildPlannerResultV1): Record<string, unknown> {
  return {
    nextAction: result.nextAction,
    fullPlan: result.recommendedBuild.map((item) => ({
      itemId: item.itemId,
      position: item.position,
      status: item.status,
    })),
    totalScore: result.totalScore,
    confidence: result.confidence,
  };
}

function sameAction(a: AdaptivePlannerServingResultV1, b: AdaptivePlannerServingResultV1): boolean {
  return a.nextAction.type === b.nextAction.type &&
    a.nextAction.targetItemId === b.nextAction.targetItemId &&
    a.nextAction.sellItemId === b.nextAction.sellItemId &&
    a.nextAction.buyItemId === b.nextAction.buyItemId;
}

function firstFutureTarget(result: AdaptivePlannerServingResultV1): number | undefined {
  return result.recommendedBuild
    .filter((row) => row.status !== 'OWNED')
    .sort((a, b) => a.position - b.position || a.itemId - b.itemId)[0]?.itemId;
}

function replacementSignature(result: AdaptivePlannerServingResultV1): string {
  return result.nextAction.type === 'REPLACE'
    ? `${result.nextAction.sellItemId ?? ''}->${result.nextAction.buyItemId ?? result.nextAction.targetItemId ?? ''}`
    : '';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
