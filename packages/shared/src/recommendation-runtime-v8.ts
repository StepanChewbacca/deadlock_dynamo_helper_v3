import { RecommendationDecisionCandidateV8 } from './recommendation-telemetry-v8';

export const RECOMMENDATION_RUNTIME_V8_CONTRACT = 'recommendation-runtime-v8' as const;

export type RecommendationRuntimeModeV8 = 'DISABLED' | 'SHADOW' | 'LIVE';

export interface RecommendationRuntimeContextV8 {
  mode: RecommendationRuntimeModeV8;
  telemetryFresh: boolean;
  observabilityGatePassed: boolean;
  modelRuntimeCompatible: boolean;
  shadowGatePassed: boolean;
  exactSpendableSoulsKnown: boolean;
  shopOpportunityKnown: boolean;
  candidates: readonly RecommendationDecisionCandidateV8[];
}

export interface RecommendationRuntimeSelectionV8 {
  contract: typeof RECOMMENDATION_RUNTIME_V8_CONTRACT;
  mode: RecommendationRuntimeModeV8;
  selectedActionKey: string;
  userVisibleActionKey?: string;
  fallbackUsed: boolean;
  fallbackReasons: readonly string[];
  safeCandidateCount: number;
}

export function selectRecommendationRuntimeActionV8(
  context: RecommendationRuntimeContextV8,
): RecommendationRuntimeSelectionV8 {
  const safeCandidates = context.candidates.filter(isSafeFeasibleCandidate);
  const waitCandidate = context.candidates.find(
    (candidate) => candidate.actionType === 'WAIT_SAVE' && candidate.feasible,
  );
  const blockers: string[] = [];
  if (context.mode === 'DISABLED') blockers.push('RUNTIME_DISABLED');
  if (!context.telemetryFresh) blockers.push('STALE_TELEMETRY');
  if (!context.observabilityGatePassed) blockers.push('OBSERVABILITY_GATE_NOT_PASS');
  if (!context.modelRuntimeCompatible) blockers.push('MODEL_RUNTIME_INCOMPATIBLE');
  if (context.mode === 'LIVE' && !context.shadowGatePassed) blockers.push('SHADOW_GATE_NOT_PASS');
  if (!context.exactSpendableSoulsKnown) blockers.push('EXACT_SPENDABLE_SOULS_UNKNOWN');
  if (!context.shopOpportunityKnown) blockers.push('SHOP_OPPORTUNITY_UNKNOWN');

  const modelCandidate = [...safeCandidates]
    .filter((candidate) => candidate.behaviorProbability !== undefined)
    .sort((a, b) => {
      const scoreA = candidateDecisionScore(a);
      const scoreB = candidateDecisionScore(b);
      return scoreB - scoreA || a.actionKey.localeCompare(b.actionKey);
    })[0];

  if (blockers.length > 0 || !modelCandidate) {
    if (!modelCandidate) blockers.push('NO_SAFE_SCORED_CANDIDATE');
    if (!waitCandidate) throw new Error(`Runtime fallback impossible: WAIT_SAVE is not feasible; blockers=${blockers.join(',')}`);
    return {
      contract: RECOMMENDATION_RUNTIME_V8_CONTRACT,
      mode: context.mode,
      selectedActionKey: waitCandidate.actionKey,
      userVisibleActionKey: context.mode === 'LIVE' ? waitCandidate.actionKey : undefined,
      fallbackUsed: true,
      fallbackReasons: [...new Set(blockers)].sort(),
      safeCandidateCount: safeCandidates.length,
    };
  }

  return {
    contract: RECOMMENDATION_RUNTIME_V8_CONTRACT,
    mode: context.mode,
    selectedActionKey: modelCandidate.actionKey,
    userVisibleActionKey: context.mode === 'LIVE' ? modelCandidate.actionKey : undefined,
    fallbackUsed: false,
    fallbackReasons: [],
    safeCandidateCount: safeCandidates.length,
  };
}

export function isSafeFeasibleCandidate(candidate: RecommendationDecisionCandidateV8): boolean {
  if (!candidate.feasible) return false;
  if (candidate.actionType === 'WAIT_SAVE') return true;
  return candidate.affordable === true
    && candidate.slotLegal === true
    && candidate.recipeLegal === true
    && candidate.shopLegal === true
    && candidate.rulesetLegal === true;
}

function candidateDecisionScore(candidate: RecommendationDecisionCandidateV8): number {
  if (candidate.policyScore !== undefined && Number.isFinite(candidate.policyScore)) return candidate.policyScore;
  if (candidate.valueScore !== undefined && Number.isFinite(candidate.valueScore)) return candidate.valueScore;
  return candidate.behaviorProbability ?? -Infinity;
}
