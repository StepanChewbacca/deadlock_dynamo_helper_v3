import { Injectable } from '@nestjs/common';
import { AdaptiveRecommendationObservabilityV1Service } from './adaptive-recommendation-observability-v1.service';
import { StrategyFirstInvariantSummaryV1 } from './strategy-first-invariants-v1';

export type StrategyFirstServingModeV1 = 'LEGACY' | 'SHADOW' | 'STRATEGY';

export interface StrategyFirstPromotionStatusV1 {
  configuredMode: StrategyFirstServingModeV1;
  effectiveMode: StrategyFirstServingModeV1;
  promotable: boolean;
  externallyApproved: boolean;
  minimumShadowDecisions: number;
  shadowComparisons: number;
  shadowFailures: number;
  promotionBlockedCount: number;
  blockers: readonly string[];
  release: StrategyFirstInvariantSummaryV1;
}

const RELEASE_RATE_KEYS: readonly (keyof StrategyFirstInvariantSummaryV1)[] = [
  'illegalActionRate',
  'slotViolationRate',
  'unreachablePlanRate',
  'redundantAncestorRate',
  'falseBuildCompleteRate',
  'mandatoryGoalLostRate',
  'branchContradictionRate',
  'archetypeUnexpectedSwitchRate',
  'coreWithoutExitSlotRate',
  'unexplainedSituationalRate',
  'nextActionBuildMismatchRate',
];

@Injectable()
export class StrategyFirstPromotionGateV1Service {
  private shadowComparisons = 0;
  private shadowFailures = 0;
  private promotionBlockedCount = 0;

  constructor(private readonly observability: AdaptiveRecommendationObservabilityV1Service) {}

  recordShadowSuccess(): void {
    this.shadowComparisons += 1;
  }

  recordShadowFailure(): void {
    this.shadowComparisons += 1;
    this.shadowFailures += 1;
  }

  recordPromotionBlocked(): void {
    this.promotionBlockedCount += 1;
  }

  configuredMode(): StrategyFirstServingModeV1 {
    return parseMode(process.env.ADAPTIVE_STRATEGY_PLANNER_MODE);
  }

  canServeStrategy(): boolean {
    return this.status().effectiveMode === 'STRATEGY';
  }

  status(): StrategyFirstPromotionStatusV1 {
    const configuredMode = this.configuredMode();
    const release = this.observability.getStatus().strategyFirstRelease;
    const externallyApproved = parseBoolean(process.env.ADAPTIVE_STRATEGY_PROMOTION_APPROVED);
    const minimumShadowDecisions = readBoundedInteger(
      process.env.ADAPTIVE_STRATEGY_PROMOTION_MIN_DECISIONS,
      100,
      1,
      1_000_000,
    );
    const blockers: string[] = [];
    const releaseViolation = RELEASE_RATE_KEYS.some((key) => Number(release[key]) !== 0);
    if (releaseViolation) blockers.push('HARD_RELEASE_METRIC_NON_ZERO');
    if (this.shadowFailures > 0) blockers.push('SHADOW_RUNTIME_FAILURE');
    if (!externallyApproved && this.shadowComparisons < minimumShadowDecisions) {
      blockers.push('SHADOW_SAMPLE_BELOW_PROMOTION_MINIMUM');
    }
    if (!externallyApproved && release.evaluatedDecisions < minimumShadowDecisions) {
      blockers.push('INVARIANT_SAMPLE_BELOW_PROMOTION_MINIMUM');
    }

    const promotable = blockers.length === 0 && (
      externallyApproved ||
      (this.shadowComparisons >= minimumShadowDecisions && release.evaluatedDecisions >= minimumShadowDecisions)
    );
    const effectiveMode: StrategyFirstServingModeV1 = configuredMode === 'STRATEGY'
      ? promotable ? 'STRATEGY' : 'SHADOW'
      : configuredMode;
    return {
      configuredMode,
      effectiveMode,
      promotable,
      externallyApproved,
      minimumShadowDecisions,
      shadowComparisons: this.shadowComparisons,
      shadowFailures: this.shadowFailures,
      promotionBlockedCount: this.promotionBlockedCount,
      blockers: [...new Set(blockers)].sort(),
      release,
    };
  }
}

function parseMode(raw: string | undefined): StrategyFirstServingModeV1 {
  const normalized = raw?.trim().toUpperCase();
  if (normalized === 'LEGACY' || normalized === 'STRATEGY' || normalized === 'SHADOW') return normalized;
  return 'SHADOW';
}

function parseBoolean(raw: string | undefined): boolean {
  const normalized = raw?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function readBoundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
