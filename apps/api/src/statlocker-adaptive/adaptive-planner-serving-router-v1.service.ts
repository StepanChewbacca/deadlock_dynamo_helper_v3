import { Injectable } from '@nestjs/common';
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
      this.promotion.recordShadowSuccess();
    } catch {
      this.promotion.recordShadowFailure();
      return this.legacy.plan(input);
    }

    if (configuredMode === 'SHADOW') return this.legacy.plan(input);
    if (!this.promotion.canServeStrategy()) {
      this.promotion.recordPromotionBlocked();
      return this.legacy.plan(input);
    }
    return strategyResult;
  }
}
