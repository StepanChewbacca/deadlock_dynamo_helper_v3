import { Injectable } from '@nestjs/common';
import {
  AdaptiveBuildPlannerInputV1,
  AdaptiveBuildPlannerResultV1,
} from './adaptive-build-planner-v1.service';
import { StrategyFirstAdaptivePlannerFacadeV1Service } from './strategy-first-adaptive-planner-facade-v1.service';

/**
 * Compatibility adapter for existing recommendation/replay call sites while the external API
 * remains on AdaptiveRecommendationResultV1. Runtime semantics come from the strategy-first
 * planner; the legacy planner version string is retained only so persisted V1 replay inputs stay readable.
 */
@Injectable()
export class StrategyFirstLegacyPlannerAdapterV1Service {
  readonly version = 'adaptive-build-planner-v1' as const;

  constructor(private readonly strategyPlanner: StrategyFirstAdaptivePlannerFacadeV1Service) {}

  plan(input: AdaptiveBuildPlannerInputV1): AdaptiveBuildPlannerResultV1 {
    const result = this.strategyPlanner.plan({
      decision: input.decision,
      evidence: input.evidence,
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
    };
  }
}
