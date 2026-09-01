import { InventoryState } from './types';

export type FactEvidence = 'OBSERVED' | 'RECONSTRUCTED' | 'UNKNOWN';

export interface ObservedFact<T> {
  value?: T;
  evidence: FactEvidence;
  source: string;
}

export type ShopOpportunity = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';

export interface RecommendationEconomyState {
  spendableSouls: ObservedFact<number>;
  netWorth?: ObservedFact<number>;
  shopOpportunity: ObservedFact<ShopOpportunity>;
}

export interface RecommendationDecisionState {
  decisionId: string;
  matchId: string;
  playerSlot: number;
  gameTimeSec: number;
  rulesetId: string;
  heroId: number;
  inventory: InventoryState;
  economy: RecommendationEconomyState;
}

export interface ItemUpgradeRecipe {
  recipeId: string;
  consumedItemIds: readonly number[];
  soulsCost: number;
}

export interface ItemSellTransition {
  soulsRefund: number;
  returnedItemIds: readonly number[];
}

export interface RecommendationItemDefinition {
  itemId: number;
  name: string;
  slotType: 'weapon' | 'vitality' | 'spirit';
  active: boolean;
  availableRulesetIds: readonly string[];
  directPurchaseCost?: number;
  upgradeRecipes: readonly ItemUpgradeRecipe[];
  sellTransition?: ItemSellTransition;
  maxCopies?: number;
}

export type RecommendationAction =
  | { type: 'WAIT_SAVE'; targetItemId?: number }
  | { type: 'BUY_ITEM'; itemId: number }
  | { type: 'UPGRADE_ITEM'; itemId: number; recipeId: string; consumedItemIds: readonly number[] }
  | { type: 'SELL_ITEM'; itemId: number }
  | { type: 'REPLACE_ITEM'; sellItemId: number; buyItemId: number };

export type RecommendationFeasibilityReason =
  | 'FEASIBLE'
  | 'ITEM_UNAVAILABLE_IN_RULESET'
  | 'ITEM_ALREADY_OWNED'
  | 'MAX_COPIES_REACHED'
  | 'DIRECT_PURCHASE_NOT_SUPPORTED'
  | 'SPENDABLE_SOULS_UNKNOWN'
  | 'SHOP_OPPORTUNITY_UNKNOWN'
  | 'SHOP_UNAVAILABLE'
  | 'UNAFFORDABLE'
  | 'SLOT_LIMIT_EXCEEDED'
  | 'ACTIVE_ITEM_LIMIT_EXCEEDED'
  | 'MISSING_UPGRADE_COMPONENT'
  | 'ITEM_NOT_OWNED'
  | 'SELL_TRANSITION_UNKNOWN'
  | 'SELL_RETURN_ITEM_UNKNOWN';

export interface RecommendationCandidateEvidence {
  spendableSouls: FactEvidence;
  shopOpportunity: FactEvidence;
  ruleset: FactEvidence;
  inventory: FactEvidence;
  transaction: FactEvidence;
}

export interface RecommendationCandidate {
  actionId: string;
  action: RecommendationAction;
  feasible: boolean;
  reasons: readonly RecommendationFeasibilityReason[];
  effectiveCostSouls: number;
  spendableSoulsAfter?: number;
  resultingItemIds: readonly number[];
  evidence: RecommendationCandidateEvidence;
}

export interface RecommendationDatasetCandidateV1 {
  schemaVersion: 1;
  decisionId: string;
  matchId: string;
  rulesetId: string;
  gameTimeSec: number;
  actionId: string;
  actionType: RecommendationAction['type'];
  targetItemId?: number;
  sellItemId?: number;
  recipeId?: string;
  consumedItemIds: readonly number[];
  feasible: boolean;
  feasibilityReasons: readonly RecommendationFeasibilityReason[];
  effectiveCostSouls: number;
  spendableSoulsAfter?: number;
  resultingItemIds: readonly number[];
  evidence: RecommendationCandidateEvidence;
  observedActionInjected: false;
}

export function observedFact<T>(value: T, source: string): ObservedFact<T> {
  return { value, evidence: 'OBSERVED', source };
}

export function reconstructedFact<T>(value: T, source: string): ObservedFact<T> {
  return { value, evidence: 'RECONSTRUCTED', source };
}

export function unknownFact<T>(source: string): ObservedFact<T> {
  return { evidence: 'UNKNOWN', source };
}

export function recommendationActionId(action: RecommendationAction): string {
  switch (action.type) {
    case 'WAIT_SAVE':
      return action.targetItemId === undefined ? 'WAIT_SAVE' : `WAIT_SAVE:${action.targetItemId}`;
    case 'BUY_ITEM':
      return `BUY_ITEM:${action.itemId}`;
    case 'UPGRADE_ITEM':
      return `UPGRADE_ITEM:${action.itemId}:${action.recipeId}`;
    case 'SELL_ITEM':
      return `SELL_ITEM:${action.itemId}`;
    case 'REPLACE_ITEM':
      return `REPLACE_ITEM:${action.sellItemId}->${action.buyItemId}`;
  }
}

export function toRecommendationDatasetCandidateV1(
  state: RecommendationDecisionState,
  candidate: RecommendationCandidate,
): RecommendationDatasetCandidateV1 {
  const action = candidate.action;
  return {
    schemaVersion: 1,
    decisionId: state.decisionId,
    matchId: state.matchId,
    rulesetId: state.rulesetId,
    gameTimeSec: state.gameTimeSec,
    actionId: candidate.actionId,
    actionType: action.type,
    targetItemId:
      action.type === 'BUY_ITEM' || action.type === 'UPGRADE_ITEM'
        ? action.itemId
        : action.type === 'WAIT_SAVE'
          ? action.targetItemId
          : action.type === 'REPLACE_ITEM'
            ? action.buyItemId
            : undefined,
    sellItemId:
      action.type === 'SELL_ITEM'
        ? action.itemId
        : action.type === 'REPLACE_ITEM'
          ? action.sellItemId
          : undefined,
    recipeId: action.type === 'UPGRADE_ITEM' ? action.recipeId : undefined,
    consumedItemIds: action.type === 'UPGRADE_ITEM' ? [...action.consumedItemIds] : [],
    feasible: candidate.feasible,
    feasibilityReasons: [...candidate.reasons],
    effectiveCostSouls: candidate.effectiveCostSouls,
    spendableSoulsAfter: candidate.spendableSoulsAfter,
    resultingItemIds: [...candidate.resultingItemIds],
    evidence: { ...candidate.evidence },
    observedActionInjected: false,
  };
}
