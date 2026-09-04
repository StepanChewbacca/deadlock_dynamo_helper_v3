import {
  FactEvidence,
  RecommendationAction,
  RecommendationCandidate,
  RecommendationCandidateEvidence,
  RecommendationDecisionState,
  RecommendationFeasibilityReason,
  RecommendationItemDefinition,
  recommendationActionId,
  reconstructedFact,
} from './recommendation-action-domain';
import { RecommendationItemGraph } from './recommendation-item-graph';
import { InventoryAcquisitionType, InventoryItemInstance, InventorySlotType, InventoryState } from './types';

export interface RecommendationCandidateGeneratorRules {
  baseSlots?: number;
  baseSlotsByType: Readonly<Record<InventorySlotType, number>>;
  maxFlexSlots: number;
  unlockedFlexSlots?: number;
  flexCapacityEvidence: FactEvidence;
  maxActiveItems: number;
  allowSellOnlyActions: boolean;
  generateTargetedWaitActions: boolean;
}

export const DEFAULT_RECOMMENDATION_CANDIDATE_RULES: RecommendationCandidateGeneratorRules = {
  baseSlots: 9,
  baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
  maxFlexSlots: 3,
  flexCapacityEvidence: 'UNKNOWN',
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
      applySlotReason(state, resulting, graph, rules, reasons);
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
      applySlotReason(state, resulting, graph, rules, reasons);
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
  applyShopObservabilityReasons(state, reasons);
  const resulting = applySellTransition(state, item, graph);
  applySlotReason(state, resulting, graph, rules, reasons);
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
  applySlotReason(state, resulting, graph, rules, reasons);
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

function applyShopObservabilityReasons(
  state: RecommendationDecisionState,
  reasons: RecommendationFeasibilityReason[],
): void {
  if (state.economy.shopOpportunity.evidence === 'UNKNOWN' || state.economy.shopOpportunity.value === 'UNKNOWN') {
    reasons.push('SHOP_OPPORTUNITY_UNKNOWN');
  } else if (state.economy.shopOpportunity.value === 'UNAVAILABLE') {
    reasons.push('SHOP_UNAVAILABLE');
  }
}

function applyPurchaseObservabilityReasons(state: RecommendationDecisionState, reasons: RecommendationFeasibilityReason[]): void {
  applyShopObservabilityReasons(state, reasons);
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

function applySlotReason(
  state: RecommendationDecisionState,
  resultingItemIds: readonly number[],
  graph: RecommendationItemGraph,
  rules: RecommendationCandidateGeneratorRules,
  reasons: RecommendationFeasibilityReason[],
): void {
  const reason = slotFailureReason(heldIds(state), resultingItemIds, graph, rules);
  if (reason) reasons.push(reason);
}

function slotFailureReason(
  currentItemIds: readonly number[],
  resultingItemIds: readonly number[],
  graph: RecommendationItemGraph,
  rules: RecommendationCandidateGeneratorRules,
): 'SLOT_LIMIT_EXCEEDED' | 'FLEX_SLOT_CAPACITY_UNKNOWN' | undefined {
  const currentUsed = flexUsedFor(currentItemIds, graph, rules);
  const resultingUsed = flexUsedFor(resultingItemIds, graph, rules);
  if (resultingUsed <= currentUsed) return undefined;
  if (resultingUsed > rules.maxFlexSlots) return 'SLOT_LIMIT_EXCEEDED';

  if (rules.flexCapacityEvidence === 'UNKNOWN') {
    return resultingUsed > currentUsed ? 'FLEX_SLOT_CAPACITY_UNKNOWN' : undefined;
  }

  const unlocked = Math.min(rules.maxFlexSlots, Math.max(0, rules.unlockedFlexSlots ?? 0));
  return resultingUsed > unlocked ? 'SLOT_LIMIT_EXCEEDED' : undefined;
}

export function flexUsedFor(
  itemIds: readonly number[],
  _graph: RecommendationItemGraph,
  rules: RecommendationCandidateGeneratorRules,
): number {
  const legacyBaseSlots = (Object.keys(rules.baseSlotsByType) as InventorySlotType[])
    .reduce((sum, type) => sum + Math.max(0, rules.baseSlotsByType[type]), 0);
  const baseSlots = Number.isFinite(rules.baseSlots)
    ? Math.max(0, Math.floor(rules.baseSlots as number))
    : legacyBaseSlots;
  return Math.max(0, itemIds.length - baseSlots);
}

function checkActiveLimit(
  itemIds: readonly number[],
  graph: RecommendationItemGraph,
  rules: RecommendationCandidateGeneratorRules,
): boolean {
  let activeCount = 0;
  for (const itemId of itemIds) if (graph.getItem(itemId)?.active) activeCount += 1;
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

export function projectRecommendationCandidateState(
  state: RecommendationDecisionState,
  candidate: RecommendationCandidate,
  graph: RecommendationItemGraph,
): RecommendationDecisionState {
  const inventory = inventoryFromProjectedIds(state, candidate, graph);
  return {
    ...state,
    inventory,
    economy: {
      ...state.economy,
      spendableSouls: candidate.spendableSoulsAfter === undefined
        ? state.economy.spendableSouls
        : reconstructedFact(candidate.spendableSoulsAfter, `candidate:${candidate.actionId}`),
    },
  };
}

function inventoryFromProjectedIds(
  state: RecommendationDecisionState,
  candidate: RecommendationCandidate,
  graph: RecommendationItemGraph,
): InventoryState {
  const held = new Map<number, InventoryItemInstance>();
  const lifecycleCountByItemId = new Map(state.inventory.lifecycleCountByItemId);
  let sequence = state.inventory.nextInstanceSequence;
  const acquisition = projectedAcquisitionType(candidate.action);

  for (const itemId of [...new Set(candidate.resultingItemIds)].sort((a, b) => a - b)) {
    const existing = state.inventory.heldByItemId.get(itemId);
    if (existing) {
      held.set(itemId, existing);
      continue;
    }
    const item = graph.getItem(itemId);
    if (!item) continue;
    const lifecycle = (lifecycleCountByItemId.get(itemId) ?? 0) + 1;
    lifecycleCountByItemId.set(itemId, lifecycle);
    held.set(itemId, {
      itemId,
      name: item.name,
      slotType: item.slotType,
      instanceId: `projected:${candidate.actionId}:${itemId}:${lifecycle}:${sequence}`,
      lifecycle,
      acquiredBy: acquisition,
      acquiredAtMs: Math.max(0, Math.round(state.gameTimeSec * 1000)),
      acquiredAtGameTimeSec: state.gameTimeSec,
    });
    sequence += 1;
  }

  return {
    initializedFromSnapshot: state.inventory.initializedFromSnapshot,
    heldByItemId: held,
    lifecycleCountByItemId,
    nextInstanceSequence: sequence,
  };
}

function projectedAcquisitionType(action: RecommendationAction): InventoryAcquisitionType {
  if (action.type === 'UPGRADE_ITEM') return 'UPGRADE';
  if (action.type === 'BUY_ITEM' || action.type === 'REPLACE_ITEM') return 'BUY';
  return 'RECONCILE';
}
