import { Injectable } from '@nestjs/common';
import {
  RecommendationCandidate,
  RecommendationDecisionState,
  RecommendationItemGraph,
  generateRecommendationCandidates,
} from '@deadlock-live-probe/build-domain';
import {
  RecommendationBehavioralV8Decision,
  RecommendationBehavioralV8LinearModel,
  RecommendationDecisionCandidateV8,
  RecommendationFeatureStateV8,
  predictRecommendationBehavioralV8Linear,
} from '@deadlock-live-probe/shared';

export interface RecommendationEngineV8Input {
  state: RecommendationDecisionState;
  itemGraph: RecommendationItemGraph;
  featureState?: RecommendationFeatureStateV8;
  behavioralModel?: RecommendationBehavioralV8LinearModel;
}

export interface RecommendationEngineV8Result {
  domainCandidates: readonly RecommendationCandidate[];
  telemetryCandidates: readonly RecommendationDecisionCandidateV8[];
}

@Injectable()
export class RecommendationEngineV8Service {
  evaluate(input: RecommendationEngineV8Input): RecommendationEngineV8Result {
    const domainCandidates = generateRecommendationCandidates({
      state: input.state,
      itemGraph: input.itemGraph,
    });
    const baseTelemetryCandidates = domainCandidates.map(toTelemetryCandidate);
    const behaviorProbabilityByAction = input.behavioralModel && input.featureState
      ? predictBehaviorProbabilities(input.behavioralModel, input.featureState, domainCandidates)
      : undefined;
    const telemetryCandidates = baseTelemetryCandidates.map((candidate) => ({
      ...candidate,
      behaviorProbability: behaviorProbabilityByAction?.get(candidate.actionKey),
    }));
    return { domainCandidates, telemetryCandidates };
  }
}

export function toTelemetryCandidate(candidate: RecommendationCandidate): RecommendationDecisionCandidateV8 {
  const reasons = new Set(candidate.reasons);
  const action = candidate.action;
  const transactionUnknown = reasons.has('SELL_TRANSITION_UNKNOWN')
    || reasons.has('SELL_RETURN_ITEM_UNKNOWN')
    || reasons.has('DIRECT_PURCHASE_NOT_SUPPORTED');
  const walletUnknown = reasons.has('SPENDABLE_SOULS_UNKNOWN');
  const shopUnknown = reasons.has('SHOP_OPPORTUNITY_UNKNOWN');
  const shopUnavailable = reasons.has('SHOP_UNAVAILABLE');
  const rulesetUnavailable = reasons.has('ITEM_UNAVAILABLE_IN_RULESET');
  const recipeIllegal = reasons.has('MISSING_UPGRADE_COMPONENT')
    || reasons.has('DIRECT_PURCHASE_NOT_SUPPORTED')
    || reasons.has('SELL_RETURN_ITEM_UNKNOWN');

  return {
    actionKey: candidate.actionId,
    actionType: action.type,
    targetItemId: action.type === 'BUY_ITEM'
      || action.type === 'UPGRADE_ITEM'
      || action.type === 'SELL_ITEM'
      ? action.itemId
      : action.type === 'REPLACE_ITEM'
        ? action.buyItemId
        : action.targetItemId,
    sellItemId: action.type === 'REPLACE_ITEM' ? action.sellItemId : undefined,
    recipeId: action.type === 'UPGRADE_ITEM' ? action.recipeId : undefined,
    consumedItemIds: action.type === 'UPGRADE_ITEM' ? [...action.consumedItemIds] : undefined,
    effectiveCostSouls: candidate.effectiveCostSouls,
    spendableSoulsAfter: candidate.spendableSoulsAfter,
    resultingItemIds: [...candidate.resultingItemIds],
    feasible: candidate.feasible,
    feasibilityReasons: [...candidate.reasons],
    affordable: action.type === 'SELL_ITEM' || action.type === 'WAIT_SAVE'
      ? true
      : walletUnknown
        ? 'UNKNOWN'
        : !reasons.has('UNAFFORDABLE'),
    slotLegal: !reasons.has('SLOT_LIMIT_EXCEEDED'),
    recipeLegal: !recipeIllegal,
    shopLegal: shopUnknown ? 'UNKNOWN' : !shopUnavailable,
    rulesetLegal: !rulesetUnavailable,
    transactionMechanicsKnown: !transactionUnknown,
    evidence: {
      spendableSouls: candidate.evidence.spendableSouls,
      shopOpportunity: candidate.evidence.shopOpportunity,
      inventory: candidate.evidence.inventory,
      ruleset: candidate.evidence.ruleset,
      transaction: transactionUnknown ? 'UNKNOWN' : candidate.evidence.transaction,
    },
  };
}

function predictBehaviorProbabilities(
  model: RecommendationBehavioralV8LinearModel,
  featureState: RecommendationFeatureStateV8,
  candidates: readonly RecommendationCandidate[],
): Map<string, number> {
  const feasible = candidates.filter((candidate) => candidate.feasible);
  if (feasible.length === 0) return new Map();
  const decision: RecommendationBehavioralV8Decision = {
    decisionId: featureState.decisionId,
    state: featureState,
    candidates: feasible.map((candidate) => {
      const action = candidate.action;
      return {
        actionKey: candidate.actionId,
        actionType: action.type,
        targetItemId: action.type === 'BUY_ITEM'
          || action.type === 'UPGRADE_ITEM'
          || action.type === 'SELL_ITEM'
          ? action.itemId
          : action.type === 'REPLACE_ITEM'
            ? action.buyItemId
            : action.targetItemId,
        sellItemId: action.type === 'REPLACE_ITEM' ? action.sellItemId : undefined,
        recipeId: action.type === 'UPGRADE_ITEM' ? action.recipeId : undefined,
        effectiveCostSouls: candidate.effectiveCostSouls,
        feasible: true as const,
      };
    }),
  };
  const prediction = predictRecommendationBehavioralV8Linear(model, decision);
  const probabilities = new Map(prediction.candidates.map((candidate) => [candidate.actionKey, candidate.probability]));
  for (const candidate of candidates) {
    if (!candidate.feasible) probabilities.set(candidate.actionId, 0);
  }
  return probabilities;
}
