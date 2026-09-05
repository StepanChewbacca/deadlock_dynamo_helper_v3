import { Injectable, Logger } from '@nestjs/common';
import { AdaptiveRecommendationStrategyV1 } from '@deadlock-live-probe/shared';
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
    if (configuredMode === 'LEGACY') return this.legacy.plan(input);

    let strategyResult: AdaptivePlannerServingResultV1;
    try {
      strategyResult = this.strategy.plan(input);
    } catch (error) {
      this.promotion.recordShadowFailure();
      const legacyResult = this.legacy.plan(input);
      this.logger.warn(`strategy-shadow-failure ${JSON.stringify({
        decisionId: input.decision.state.decisionId,
        error: describeError(error),
        legacyNextAction: legacyResult.nextAction,
      })}`);
      return legacyResult;
    }

    if (configuredMode === 'SHADOW') {
      const legacyResult = this.legacy.plan(input);
      this.promotion.recordShadowSuccess();
      this.logShadowComparison(input, strategyResult, legacyResult, 'SHADOW');
      return legacyResult;
    }

    if (input.decision.economyRulesEvidence !== 'RECONSTRUCTED') {
      const legacyResult = this.legacy.plan(input);
      this.promotion.recordShadowSuccess();
      this.promotion.recordPromotionBlocked();
      this.logShadowComparison(input, strategyResult, legacyResult, 'EXACT_ECONOMY_RULES_BLOCKED');
      return legacyResult;
    }

    if (!this.promotion.canServeStrategy()) {
      const legacyResult = this.legacy.plan(input);
      this.promotion.recordShadowSuccess();
      this.promotion.recordPromotionBlocked();
      this.logShadowComparison(input, strategyResult, legacyResult, 'PROMOTION_BLOCKED');
      return legacyResult;
    }

    this.logger.debug(`strategy-serving ${JSON.stringify(strategyDiagnostics(input, strategyResult))}`);
    return strategyResult;
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
      legacy: {
        nextAction: legacyResult.nextAction,
        fullPlan: legacyResult.recommendedBuild.map((item) => ({
          itemId: item.itemId,
          position: item.position,
          status: item.status,
        })),
        totalScore: legacyResult.totalScore,
        confidence: legacyResult.confidence,
      },
    })}`);
  }
}

function strategyDiagnostics(
  input: AdaptiveBuildPlannerInputV1,
  result: AdaptivePlannerServingResultV1,
): Record<string, unknown> {
  const strategy = result.strategy;
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
