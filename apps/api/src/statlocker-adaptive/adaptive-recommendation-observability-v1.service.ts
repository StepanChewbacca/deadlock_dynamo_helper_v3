import { Injectable, Logger } from '@nestjs/common';
import { AdaptiveRecommendationResultV1 } from '@deadlock-live-probe/shared';
import { AdaptiveDecisionStateV1 } from './adaptive-decision-state-v1.service';
import { StatlockerEvidenceBundleV1 } from './statlocker-evidence.service';
import {
  StrategyFirstInvariantCheckV1,
  StrategyFirstInvariantSummaryV1,
  StrategyFirstInvariantViolationCodeV1,
} from './strategy-first-invariants-v1';

export interface AdaptiveRecommendationObservabilityLatencyV1 {
  count: number;
  lastMs: number;
  maxMs: number;
  totalMs: number;
}

export interface AdaptiveRecommendationObservabilityCountersV1 {
  evidenceDegradedCount: number;
  evidenceFallbackCount: number;
  finalLegalityFallbackCount: number;
  phaseViolationPreventedCount: number;
  choiceGroupViolationPreventedCount: number;
  flexCapacityUnknownCount: number;
  investmentRulesUnknownCount: number;
  planSwitchCount: number;
  planChurnCount: number;
  sellCount: number;
  replaceCount: number;
  postCommitReplacementCount: number;
  externallyDivergedChoiceStateCount: number;
}

export interface AdaptiveRecommendationObservabilityStatusV1 {
  updatedAt: string;
  plannerLatencyMs: AdaptiveRecommendationObservabilityLatencyV1;
  counters: AdaptiveRecommendationObservabilityCountersV1;
  strategyFirstRelease: StrategyFirstInvariantSummaryV1;
  reasonCodeCounts: Record<string, number>;
}

export interface AdaptiveRecommendationOutcomeV1 {
  evidence: StatlockerEvidenceBundleV1;
  decision: AdaptiveDecisionStateV1;
  previousResult?: Pick<AdaptiveRecommendationResultV1, 'nextAction' | 'nextTargetItemId' | 'recommendedBuild'>;
  result: AdaptiveRecommendationResultV1;
  plannerLatencyMs?: number;
  legalityFallback?: boolean;
  legalityFallbackReasonCodes?: readonly string[];
}

const RELEASE_CODES: readonly StrategyFirstInvariantViolationCodeV1[] = [
  'ILLEGAL_NEXT_ACTION',
  'SLOT_STATE_INVALID',
  'UNREACHABLE_PLAN',
  'REDUNDANT_ANCESTOR_IN_PLAN',
  'FALSE_BUILD_COMPLETE',
  'MANDATORY_GOAL_LOST',
  'BRANCH_CONTRADICTION',
  'UNEXPECTED_COMMITTED_STRATEGY_SWITCH',
  'CORE_WITHOUT_EXIT_SLOT',
  'UNEXPLAINED_SITUATIONAL',
  'NEXT_ACTION_BUILD_MISMATCH',
];

@Injectable()
export class AdaptiveRecommendationObservabilityV1Service {
  private readonly logger = new Logger(AdaptiveRecommendationObservabilityV1Service.name);
  private readonly invariantViolationDecisionCounts = new Map<StrategyFirstInvariantViolationCodeV1, number>();
  private evaluatedStrategyDecisions = 0;
  private readonly status = {
    updatedAt: new Date(0).toISOString(),
    plannerLatencyMs: {
      count: 0,
      lastMs: 0,
      maxMs: 0,
      totalMs: 0,
    },
    counters: {
      evidenceDegradedCount: 0,
      evidenceFallbackCount: 0,
      finalLegalityFallbackCount: 0,
      phaseViolationPreventedCount: 0,
      choiceGroupViolationPreventedCount: 0,
      flexCapacityUnknownCount: 0,
      investmentRulesUnknownCount: 0,
      planSwitchCount: 0,
      planChurnCount: 0,
      sellCount: 0,
      replaceCount: 0,
      postCommitReplacementCount: 0,
      externallyDivergedChoiceStateCount: 0,
    } satisfies AdaptiveRecommendationObservabilityCountersV1,
    reasonCodeCounts: {} as Record<string, number>,
  };

  recordDecisionState(decision: Partial<Pick<AdaptiveDecisionStateV1, 'slots' | 'investment'>>): void {
    const slots = decision.slots;
    const investment = decision.investment;
    if (slots && (slots.evidence === 'UNKNOWN' || slots.unlockedFlexSlots === undefined)) {
      this.status.counters.flexCapacityUnknownCount += 1;
    }
    if (investment && investment.evidence === 'UNKNOWN') {
      this.status.counters.investmentRulesUnknownCount += 1;
    }
    this.touch();
  }

  recordEvidence(bundle: Pick<StatlockerEvidenceBundleV1, 'usable' | 'degradedReasons'>): void {
    if (bundle.degradedReasons.length > 0) this.status.counters.evidenceDegradedCount += 1;
    if (!bundle.usable) this.status.counters.evidenceFallbackCount += 1;
    this.recordReasonCodes(bundle.degradedReasons);
    this.touch();
  }

  recordPlannerLatency(latencyMs: number): void {
    const normalized = Number.isFinite(latencyMs) ? Math.max(0, Math.floor(latencyMs)) : 0;
    this.status.plannerLatencyMs.count += 1;
    this.status.plannerLatencyMs.lastMs = normalized;
    this.status.plannerLatencyMs.totalMs += normalized;
    this.status.plannerLatencyMs.maxMs = Math.max(this.status.plannerLatencyMs.maxMs, normalized);
    this.touch();
  }

  recordPhaseViolationPrevented(): void {
    this.status.counters.phaseViolationPreventedCount += 1;
    this.touch();
  }

  recordChoiceGroupViolationPrevented(): void {
    this.status.counters.choiceGroupViolationPreventedCount += 1;
    this.touch();
  }

  recordExternallyDivergedChoiceState(): void {
    this.status.counters.externallyDivergedChoiceStateCount += 1;
    this.touch();
  }

  recordPostCommitReplacement(): void {
    this.status.counters.postCommitReplacementCount += 1;
    this.touch();
  }

  recordStrategyInvariantCheck(check: StrategyFirstInvariantCheckV1): void {
    this.evaluatedStrategyDecisions += 1;
    const codes = new Set(check.violations.map((violation) => violation.code));
    for (const code of codes) {
      this.invariantViolationDecisionCounts.set(code, (this.invariantViolationDecisionCounts.get(code) ?? 0) + 1);
    }
    this.recordReasonCodes([...codes].map((code) => `STRATEGY_INVARIANT:${code}`));
    this.touch();
  }

  recordRecommendationOutcome(outcome: AdaptiveRecommendationOutcomeV1): void {
    if (outcome.result.nextAction.type === 'SELL') this.status.counters.sellCount += 1;
    if (outcome.result.nextAction.type === 'REPLACE') this.status.counters.replaceCount += 1;

    if (outcome.legalityFallback) {
      this.status.counters.finalLegalityFallbackCount += 1;
      this.recordReasonCodes(outcome.legalityFallbackReasonCodes ?? []);
    }

    if (outcome.previousResult) {
      if (
        !sameAction(outcome.previousResult.nextAction, outcome.result.nextAction) ||
        outcome.previousResult.nextTargetItemId !== outcome.result.nextTargetItemId
      ) {
        this.status.counters.planSwitchCount += 1;
      }
      if (!sameBuild(outcome.previousResult.recommendedBuild, outcome.result.recommendedBuild)) {
        this.status.counters.planChurnCount += 1;
      }
    }

    this.recordReasonCodes(outcome.result.nextAction.reasonCodes ?? []);
    this.touch();
    this.logger.debug(
      `adaptive-observability ${JSON.stringify({
        plannerLatencyMs: outcome.plannerLatencyMs,
        evidenceUsable: outcome.evidence.usable,
        nextActionType: outcome.result.nextAction.type,
        legalityFallback: outcome.legalityFallback ?? false,
      })}`,
    );
  }

  getStatus(): AdaptiveRecommendationObservabilityStatusV1 {
    return {
      updatedAt: this.status.updatedAt,
      plannerLatencyMs: { ...this.status.plannerLatencyMs },
      counters: { ...this.status.counters },
      strategyFirstRelease: this.strategyFirstReleaseSummary(),
      reasonCodeCounts: { ...this.status.reasonCodeCounts },
    };
  }

  private strategyFirstReleaseSummary(): StrategyFirstInvariantSummaryV1 {
    const rate = (code: StrategyFirstInvariantViolationCodeV1): number => {
      if (this.evaluatedStrategyDecisions === 0) return 0;
      return (this.invariantViolationDecisionCounts.get(code) ?? 0) / this.evaluatedStrategyDecisions;
    };
    for (const code of RELEASE_CODES) {
      if (!this.invariantViolationDecisionCounts.has(code)) this.invariantViolationDecisionCounts.set(code, 0);
    }
    return {
      evaluatedDecisions: this.evaluatedStrategyDecisions,
      illegalActionRate: rate('ILLEGAL_NEXT_ACTION'),
      slotViolationRate: rate('SLOT_STATE_INVALID'),
      unreachablePlanRate: rate('UNREACHABLE_PLAN'),
      redundantAncestorRate: rate('REDUNDANT_ANCESTOR_IN_PLAN'),
      falseBuildCompleteRate: rate('FALSE_BUILD_COMPLETE'),
      mandatoryGoalLostRate: rate('MANDATORY_GOAL_LOST'),
      branchContradictionRate: rate('BRANCH_CONTRADICTION'),
      archetypeUnexpectedSwitchRate: rate('UNEXPECTED_COMMITTED_STRATEGY_SWITCH'),
      coreWithoutExitSlotRate: rate('CORE_WITHOUT_EXIT_SLOT'),
      unexplainedSituationalRate: rate('UNEXPLAINED_SITUATIONAL'),
      nextActionBuildMismatchRate: rate('NEXT_ACTION_BUILD_MISMATCH'),
    };
  }

  private recordReasonCodes(reasonCodes: readonly string[]): void {
    for (const reasonCode of new Set(reasonCodes)) {
      this.status.reasonCodeCounts[reasonCode] = (this.status.reasonCodeCounts[reasonCode] ?? 0) + 1;
    }
  }

  private touch(): void {
    this.status.updatedAt = new Date().toISOString();
  }
}

function sameAction(
  a: Pick<AdaptiveRecommendationResultV1['nextAction'], 'actionKey' | 'type' | 'targetItemId'>,
  b: Pick<AdaptiveRecommendationResultV1['nextAction'], 'actionKey' | 'type' | 'targetItemId'>,
): boolean {
  return a.actionKey === b.actionKey && a.type === b.type && a.targetItemId === b.targetItemId;
}

function sameBuild(
  a: AdaptiveRecommendationResultV1['recommendedBuild'],
  b: AdaptiveRecommendationResultV1['recommendedBuild'],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) =>
    item.itemId === b[index]?.itemId &&
    item.position === b[index]?.position &&
    item.status === b[index]?.status,
  );
}
