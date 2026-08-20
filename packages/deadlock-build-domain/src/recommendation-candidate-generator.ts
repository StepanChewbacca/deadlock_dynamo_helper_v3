import {
  FactEvidence,
  RecommendationAction,
  RecommendationCandidate,
  RecommendationCandidateEvidence,
  RecommendationDecisionState,
  RecommendationFeasibilityReason,
  RecommendationItemDefinition,
  recommendationActionId,
} from './recommendation-action-domain';
import { RecommendationItemGraph } from './recommendation-item-graph';
import { InventoryItemInstance, InventorySlotType } from './types';

export interface RecommendationCandidateGeneratorRules {
  baseSlotsByType: Readonly<Record<InventorySlotType, number>>;
  maxFlexSlots: number;
  maxActiveItems: number;
  allowSellOnlyActions: boolean;
  generateTargetedWaitActions: boolean;
}

export const DEFAULT_RECOMMENDATION_CANDIDATE_RULES: RecommendationCandidateGeneratorRules = {
  baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
  maxFlexSlots: 4,
  maxActiveItems: 4,
  allowSellOnlyActions: true,
  generateTargetedWaitActions: true,
};

export interface GenerateRecommendationCandidatesInput {
  state: RecommendationDecisionState;
  itemGraph: RecommendationItemGraph;
  rules?: RecommendationCandidateGeneratorRules;
}

export function generateRecommendationCandidates(
  input: GenerateRecommendationCandidatesInput,
): RecommendationCandidate[] {
  const rules = input.rules ?? DEFAULT_RECOMMENDATION_CANDIDATE_RULES;
  const state = input.state;
  const graph = input.itemGraph;
  const candidates: RecommendationCandidate[] = [];
  const waitTargets = new Set<number>();
  registerGraphMetadata(graph);

  candidates.push(buildCandidate(state, { type: 'WAIT_SAVE' }, true, ['FEASIBLE'], 0, heldIds(state), state.economy.spendableSouls.value));

  for (const item of graph.getAllItems()) {
    const availability = rulesetAvailability(state.rulesetId, item);
    const owned = state.inventory.heldByItemId.has(item.itemId);
    const copyCount = owned ? 1 : 0;
    const maxCopies = item.maxCopies ?? 1;

    if (item.directPurchaseCost !== undefined) {
      const buyAction: RecommendationAction = { type: 'BUY_ITEM', itemId: item.itemId };
      const reasons: RecommendationFeasibilityReason[] = [];
      if (!availability) reasons.push('ITEM_UNAVAILABLE_IN_RULESET');
      if (owned && maxCopies <= copyCount) reasons.push('ITEM_ALREADY_OWNED');
      if (copyCount >= maxCopies) reasons.push('MAX_COPIES_REACHED');
      applyPurchaseObservabilityReasons(state, reasons);
      applyAffordabilityReason(state, item.directPurchaseCost, reasons);
      const resulting = addItemToInventory(state, item);
      if (!checkSlots(resulting, rules)) reasons.push('SLOT_LIMIT_EXCEEDED');
      if (!checkActiveLimit(resulting, graph, rules)) reasons.push('ACTIVE_ITEM_LIMIT_EXCEEDED');
      const feasible = reasons.length === 0;
      candidates.push(buildCandidate(
        state,
        buyAction,
        feasible,
        feasible ? ['FEASIBLE'] : uniqueReasons(reasons),
        item.directPurchaseCost,
        resulting,
        feasible && state.economy.spendableSouls.value !== undefined
          ? state.economy.spendableSouls.value - item.directPurchaseCost
          : undefined,
      ));
      if (!feasible && shouldTargetWait(reasons)) waitTargets.add(item.itemId);
    }

    for (const recipe of item.upgradeRecipes) {
      const action: RecommendationAction = {
        type: 'UPGRADE_ITEM',
        itemId: item.itemId,
        recipeId: recipe.recipeId,
        consumedItemIds: recipe.consumedItemIds,
      };
      const reasons: RecommendationFeasibilityReason[] = [];
      if (!availability) reasons.push('ITEM_UNAVAILABLE_IN_RULESET');
      for (const componentId of recipe.consumedItemIds) {
        if (!state.inventory.heldByItemId.has(componentId)) reasons.push('MISSING_UPGRADE_COMPONENT');
      }
      if (owned && maxCopies <= copyCount) reasons.push('MAX_COPIES_REACHED');
      applyPurchaseObservabilityReasons(state, reasons);
      applyAffordabilityReason(state, recipe.soulsCost, reasons);
      const resulting = upgradeInventory(state, item, recipe.consumedItemIds);
      if (!checkSlots(resulting, rules)) reasons.push('SLOT_LIMIT_EXCEEDED');
      if (!checkActiveLimit(resulting, graph, rules)) reasons.push('ACTIVE_ITEM_LIMIT_EXCEEDED');
      const feasible = reasons.length === 0;
      candidates.push(buildCandidate(
        state,
        action,
        feasible,
        feasible ? ['FEASIBLE'] : uniqueReasons(reasons),
        recipe.soulsCost,
        resulting,
        feasible && state.economy.spendableSouls.value !== undefined
          ? state.economy.spendableSouls.value - recipe.soulsCost
          : undefined,
      ));
      if (!feasible && shouldTargetWait(reasons)) waitTargets.add(item.itemId);
    }
  }

  for (const held of state.inventory.heldByItemId.values()) {
    const item = graph.getItem(held.itemId);
    if (!item) continue;
    if (rules.allowSellOnlyActions) candidates.push(evaluateSell(state, item, graph, rules));

    for (const target of graph.getAllItems()) {
      if (target.itemId === held.itemId || target.directPurchaseCost === undefined) continue;
      const replacement = evaluateReplace(state, item, target, graph, rules);
      candidates.push(replacement);
      if (!replacement.feasible && shouldTargetWait(replacement.reasons)) waitTargets.add(target.itemId);
    }
  }

  if (rules.generateTargetedWaitActions) {
    for (const targetItemId of [...waitTargets].sort((a, b) => a - b)) {
      candidates.push(buildCandidate(
        state,
        { type: 'WAIT_SAVE', targetItemId },
        true,
        ['FEASIBLE'],
        0,
        heldIds(state),
        state.economy.spendableSouls.value,
      ));
    }
  }

  return dedupeAndSort(candidates);
}

function evaluateSell(
  state: RecommendationDecisionState,
  item: RecommendationItemDefinition,
  graph: RecommendationItemGraph,
  rules: RecommendationCandidateGeneratorRules,
): RecommendationCandidate {
  const reasons: RecommendationFeasibilityReason[] = [];
  if (!state.inventory.heldByItemId.has(item.itemId)) reasons.push('ITEM_NOT_OWNED');
  if (!item.sellTransition) reasons.push('SELL_TRANSITION_UNKNOWN');
  if (item.sellTransition) {
    for (const returnedItemId of item.sellTransition.returnedItemIds) {
      if (!graph.getItem(returnedItemId)) reasons.push('SELL_RETURN_ITEM_UNKNOWN');
    }
  }
  const resulting = applySellTransition(state, item, graph);
  if (!checkSlots(resulting, rules)) reasons.push('SLOT_LIMIT_EXCEEDED');
  if (!checkActiveLimit(resulting, graph, rules)) reasons.push('ACTIVE_ITEM_LIMIT_EXCEEDED');
  const feasible = reasons.length === 0;
  const refund = item.sellTransition?.soulsRefund ?? 0;
  const wallet = state.economy.spendableSouls.value;
  return buildCandidate(
    state,
    { type: 'SELL_ITEM', itemId: item.itemId },
    feasible,
    feasible ? ['FEASIBLE'] : uniqueReasons(reasons),
    -refund,
    resulting,
    feasible && wallet !== undefined ? wallet + refund : undefined,
  );
}

function evaluateReplace(
  state: RecommendationDecisionState,
  sold: RecommendationItemDefinition,
  bought: RecommendationItemDefinition,
  graph: RecommendationItemGraph,
  rules: RecommendationCandidateGeneratorRules,
): RecommendationCandidate {
  const reasons: RecommendationFeasibilityReason[] = [];
  if (!state.inventory.heldByItemId.has(sold.itemId)) reasons.push('ITEM_NOT_OWNED');
  if (!sold.sellTransition) reasons.push('SELL_TRANSITION_UNKNOWN');
  if (!rulesetAvailability(state.rulesetId, bought)) reasons.push('ITEM_UNAVAILABLE_IN_RULESET');
  if (state.inventory.heldByItemId.has(bought.itemId)) reasons.push('ITEM_ALREADY_OWNED');
  if (bought.directPurchaseCost === undefined) reasons.push('DIRECT_PURCHASE_NOT_SUPPORTED');
  applyPurchaseObservabilityReasons(state, reasons);

  const afterSell = applySellTransition(state, sold, graph);
  const resulting = bought.directPurchaseCost === undefined ? afterSell : addItemIds(afterSell, [bought.itemId]);
  if (!checkSlots(resulting, rules)) reasons.push('SLOT_LIMIT_EXCEEDED');
  if (!checkActiveLimit(resulting, graph, rules)) reasons.push('ACTIVE_ITEM_LIMIT_EXCEEDED');

  const refund = sold.sellTransition?.soulsRefund ?? 0;
  const cost = bought.directPurchaseCost ?? 0;
  const wallet = state.economy.spendableSouls.value;
  if (wallet !== undefined && wallet + refund < cost) reasons.push('UNAFFORDABLE');
  const feasible = reasons.length === 0;
  return buildCandidate(
    state,
    { type: 'REPLACE_ITEM', sellItemId: sold.itemId, buyItemId: bought.itemId },
    feasible,
    feasible ? ['FEASIBLE'] : uniqueReasons(reasons),
    cost - refund,
    resulting,
    feasible && wallet !== undefined ? wallet + refund - cost : undefined,
  );
}

function applyPurchaseObservabilityReasons(state: RecommendationDecisionState, reasons: RecommendationFeasibilityReason[]): void {
  if (state.economy.shopOpportunity.evidence === 'UNKNOWN' || state.economy.shopOpportunity.value === 'UNKNOWN') {
    reasons.push('SHOP_OPPORTUNITY_UNKNOWN');
  } else if (state.economy.shopOpportunity.value === 'UNAVAILABLE') {
    reasons.push('SHOP_UNAVAILABLE');
  }
  if (state.economy.spendableSouls.evidence === 'UNKNOWN' || state.economy.spendableSouls.value === undefined) {
    reasons.push('SPENDABLE_SOULS_UNKNOWN');
  }
}

function applyAffordabilityReason(state: RecommendationDecisionState, cost: number, reasons: RecommendationFeasibilityReason[]): void {
  const wallet = state.economy.spendableSouls.value;
  if (state.economy.spendableSouls.evidence !== 'UNKNOWN' && wallet !== undefined && wallet < cost) reasons.push('UNAFFORDABLE');
}

function rulesetAvailability(rulesetId: string, item: RecommendationItemDefinition): boolean {
  return item.availableRulesetIds.includes(rulesetId);
}

function checkSlots(itemIds: readonly number[], rules: RecommendationCandidateGeneratorRules): boolean {
  const counts: Record<InventorySlotType, number> = { weapon: 0, vitality: 0, spirit: 0 };
  for (const itemId of itemIds) {
    const slotType = slotTypesByItemId.get(itemId);
    if (slotType) counts[slotType] += 1;
  }
  const flexUsed = (Object.keys(counts) as InventorySlotType[])
    .reduce((sum, type) => sum + Math.max(0, counts[type] - rules.baseSlotsByType[type]), 0);
  return flexUsed <= rules.maxFlexSlots;
}

const slotTypesByItemId = new Map<number, InventorySlotType>();
const activeByItemId = new Map<number, boolean>();

function registerGraphMetadata(graph: RecommendationItemGraph): void {
  for (const item of graph.getAllItems()) {
    slotTypesByItemId.set(item.itemId, item.slotType);
    activeByItemId.set(item.itemId, item.active);
  }
}

function checkActiveLimit(itemIds: readonly number[], graph: RecommendationItemGraph, rules: RecommendationCandidateGeneratorRules): boolean {
  registerGraphMetadata(graph);
  let activeCount = 0;
  for (const itemId of itemIds) if (activeByItemId.get(itemId)) activeCount += 1;
  return activeCount <= rules.maxActiveItems;
}

function heldIds(state: RecommendationDecisionState): number[] {
  return [...state.inventory.heldByItemId.keys()].sort((a, b) => a - b);
}

function addItemToInventory(state: RecommendationDecisionState, item: RecommendationItemDefinition): number[] {
  return addItemIds(heldIds(state), [item.itemId]);
}

function addItemIds(existing: readonly number[], added: readonly number[]): number[] {
  return [...new Set([...existing, ...added])].sort((a, b) => a - b);
}

function upgradeInventory(
  state: RecommendationDecisionState,
  item: RecommendationItemDefinition,
  consumed: readonly number[],
): number[] {
  const removed = new Set(consumed);
  return addItemIds(heldIds(state).filter((id) => !removed.has(id)), [item.itemId]);
}

function applySellTransition(
  state: RecommendationDecisionState,
  item: RecommendationItemDefinition,
  graph: RecommendationItemGraph,
): number[] {
  const withoutSold = heldIds(state).filter((id) => id !== item.itemId);
  if (!item.sellTransition) return withoutSold;
  const knownReturns = item.sellTransition.returnedItemIds.filter((id) => graph.getItem(id) !== undefined);
  return addItemIds(withoutSold, knownReturns);
}

function shouldTargetWait(reasons: readonly RecommendationFeasibilityReason[]): boolean {
  return reasons.includes('UNAFFORDABLE') || reasons.includes('SPENDABLE_SOULS_UNKNOWN') || reasons.includes('SHOP_UNAVAILABLE') || reasons.includes('SHOP_OPPORTUNITY_UNKNOWN');
}

function evidenceFor(state: RecommendationDecisionState, transactionEvidence: FactEvidence): RecommendationCandidateEvidence {
  return {
    spendableSouls: state.economy.spendableSouls.evidence,
    shopOpportunity: state.economy.shopOpportunity.evidence,
    ruleset: state.rulesetId ? 'RECONSTRUCTED' : 'UNKNOWN',
    inventory: state.inventory.initializedFromSnapshot ? 'OBSERVED' : 'RECONSTRUCTED',
    transaction: transactionEvidence,
  };
}

function buildCandidate(
  state: RecommendationDecisionState,
  action: RecommendationAction,
  feasible: boolean,
  reasons: readonly RecommendationFeasibilityReason[],
  effectiveCostSouls: number,
  resultingItemIds: readonly number[],
  spendableSoulsAfter: number | undefined,
): RecommendationCandidate {
  return {
    actionId: recommendationActionId(action),
    action,
    feasible,
    reasons,
    effectiveCostSouls,
    spendableSoulsAfter,
    resultingItemIds: [...resultingItemIds].sort((a, b) => a - b),
    evidence: evidenceFor(state, 'RECONSTRUCTED'),
  };
}

function uniqueReasons(reasons: readonly RecommendationFeasibilityReason[]): RecommendationFeasibilityReason[] {
  return [...new Set(reasons)].sort();
}

function dedupeAndSort(candidates: readonly RecommendationCandidate[]): RecommendationCandidate[] {
  const byId = new Map<string, RecommendationCandidate>();
  for (const candidate of candidates) if (!byId.has(candidate.actionId)) byId.set(candidate.actionId, candidate);
  return [...byId.values()].sort((a, b) => a.actionId.localeCompare(b.actionId));
}

export function buildInventoryInstancesForRecommendation(
  itemIds: readonly number[],
  graph: RecommendationItemGraph,
): ReadonlyMap<number, InventoryItemInstance> {
  registerGraphMetadata(graph);
  const held = new Map<number, InventoryItemInstance>();
  let sequence = 1;
  for (const itemId of [...new Set(itemIds)].sort((a, b) => a - b)) {
    const item = graph.getItem(itemId);
    if (!item) continue;
    held.set(itemId, {
      itemId,
      name: item.name,
      slotType: item.slotType,
      instanceId: `${itemId}:1:${sequence++}`,
      lifecycle: 1,
      acquiredBy: 'RECONCILE',
      acquiredAtMs: 0,
    });
  }
  return held;
}
