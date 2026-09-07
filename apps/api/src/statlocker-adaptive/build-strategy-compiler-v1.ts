import {
  RecommendationCandidateGeneratorRules,
  RecommendationDecisionState,
  RecommendationItemGraph,
  applyRecommendationCandidateTransitionV1,
  buildInventoryInstancesForRecommendation,
  generateRecommendationCandidates,
  observedFact,
} from '@deadlock-live-probe/build-domain';
import { AdaptiveSituationalPurposeV1 } from '@deadlock-live-probe/shared';
import { AdaptiveSlotRulesV1 } from './adaptive-economy-v1';
import { BuildStrategyGoalV1, BuildStrategySpecV1 } from './build-strategy-v1';
import { MinedBuildArchetypeV1 } from './build-archetype-miner-v1';

export interface CompiledBuildStrategySituationalWindowV1 {
  windowId: string;
  targetItemIds: readonly number[];
  purpose: AdaptiveSituationalPurposeV1;
  maxItems: number;
  maxSoulsDelay: number;
  reservedSlots: number;
}

export interface BuildStrategyFeasibilityV1 {
  releaseEligible: boolean;
  actionCoverage: number;
  mandatoryGoalCoverage: number;
  terminalSatisfied: boolean;
  validatedActionIds: readonly string[];
  terminalOwnedItemIds: readonly number[];
}

export interface CompiledBuildStrategySpecV1 extends BuildStrategySpecV1 {
  catalogSha256: string;
  terminalItemIds: readonly number[];
  situationalWindows: readonly CompiledBuildStrategySituationalWindowV1[];
  feasibility: BuildStrategyFeasibilityV1;
}

export interface CompileBuildStrategySpecInputV1 {
  archetype: MinedBuildArchetypeV1;
  itemGraph: RecommendationItemGraph;
  slotRules?: AdaptiveSlotRulesV1;
  situationalWindows?: readonly CompiledBuildStrategySituationalWindowV1[];
}

export function compileBuildStrategySpecV1(
  input: CompileBuildStrategySpecInputV1,
): CompiledBuildStrategySpecV1 {
  validateIdentity(input.archetype);
  const slotRules = input.slotRules ?? input.archetype.representativeSlotRules;
  if (slotRules.evidence === 'UNKNOWN') throw new Error('STRATEGY_MECHANICS_UNKNOWN');
  validateSlotRuleScope(slotRules, input.archetype.representativeSlotRules);

  const availableItemIds = new Set(
    input.itemGraph.getAllItems()
      .filter((item) => item.availableRulesetIds.includes(input.archetype.rulesetId))
      .map((item) => item.itemId),
  );
  const terminalItemIds = normalizeTargets(input.archetype.terminalItemIds, availableItemIds, 'TERMINAL_ITEM_INVALID');
  if (terminalItemIds.length === 0) throw new Error('TERMINAL_ITEMS_EMPTY');

  const observedWindowIds = new Set(input.archetype.situationalWindowIds);
  const suppliedWindows = new Map((input.situationalWindows ?? []).map((window) => [window.windowId, window]));
  for (const windowId of observedWindowIds) {
    if (!suppliedWindows.has(windowId)) throw new Error(`SITUATIONAL_WINDOW_METADATA_MISSING:${windowId}`);
  }

  const goals = compileGoals(input.archetype, availableItemIds);
  const situationalWindows = [...observedWindowIds]
    .sort()
    .map((windowId) => validateSituationalWindow(suppliedWindows.get(windowId)!, availableItemIds));
  for (const window of situationalWindows) {
    goals.push({
      goalId: `situational:${window.windowId}`,
      type: 'SITUATIONAL_WINDOW',
      mandatory: false,
      targetItemIds: window.targetItemIds,
      dependsOnGoalIds: [],
    });
  }
  goals.push({
    goalId: 'terminal:archetype',
    type: 'TERMINAL',
    mandatory: true,
    targetItemIds: terminalItemIds,
    dependsOnGoalIds: goals.filter((goal) => goal.mandatory).map((goal) => goal.goalId),
  });

  validateTerminalCapacity(terminalItemIds, input.itemGraph, slotRules);
  const feasibility = validateCanonicalFeasibility(
    input.archetype,
    goals,
    terminalItemIds,
    input.itemGraph,
    slotRules,
  );
  if (!feasibility.releaseEligible) throw new Error('STRATEGY_FEASIBILITY_NOT_100_PERCENT');

  const spec: CompiledBuildStrategySpecV1 = {
    strategyId: input.archetype.archetypeId,
    heroId: input.archetype.heroId,
    rulesetId: input.archetype.rulesetId,
    catalogSha256: input.archetype.catalogSha256.toLowerCase(),
    support: input.archetype.supportCount,
    goals,
    terminalItemIds,
    situationalWindows,
    feasibility,
  };
  return deepFreeze(spec);
}

function compileGoals(
  archetype: MinedBuildArchetypeV1,
  availableItemIds: ReadonlySet<number>,
): BuildStrategyGoalV1[] {
  const goalTargets = new Map<string, number[]>();
  const goalOrder: string[] = [];
  const count = Math.max(archetype.orderedGoalIds.length, archetype.orderedTargetItemIds.length);
  for (let index = 0; index < count; index += 1) {
    const goalId = archetype.orderedGoalIds[index];
    const targetItemId = archetype.orderedTargetItemIds[index];
    if (!goalId || targetItemId === undefined) continue;
    if (!availableItemIds.has(targetItemId)) throw new Error(`STRATEGY_TARGET_INVALID:${targetItemId}`);
    if (!goalTargets.has(goalId)) goalOrder.push(goalId);
    const targets = goalTargets.get(goalId) ?? [];
    if (!targets.includes(targetItemId)) targets.push(targetItemId);
    goalTargets.set(goalId, targets);
  }

  return goalOrder.map((goalId, index) => ({
    goalId,
    type: inferGoalType(goalId),
    mandatory: true,
    targetItemIds: [...(goalTargets.get(goalId) ?? [])].sort((left, right) => left - right),
    dependsOnGoalIds: index === 0 ? [] : [goalOrder[index - 1]],
  }));
}

function validateCanonicalFeasibility(
  archetype: MinedBuildArchetypeV1,
  goals: readonly BuildStrategyGoalV1[],
  terminalItemIds: readonly number[],
  graph: RecommendationItemGraph,
  slotRules: AdaptiveSlotRulesV1,
): BuildStrategyFeasibilityV1 {
  let state = syntheticFeasibilityState(archetype, graph);
  const rules: RecommendationCandidateGeneratorRules = {
    baseSlotsByType: { ...slotRules.baseSlotsByType },
    maxFlexSlots: slotRules.maxFlexSlots,
    unlockedFlexSlots: slotRules.maxFlexSlots,
    flexCapacityEvidence: slotRules.evidence,
    maxActiveItems: slotRules.maxActiveItems,
    activeCapacityEvidence: slotRules.evidence,
    allowSellOnlyActions: true,
    generateTargetedWaitActions: true,
  };
  const validatedActionIds: string[] = [];

  for (const actionId of archetype.representativeActionIds) {
    const candidate = generateRecommendationCandidates({ state, itemGraph: graph, rules })
      .find((entry) => entry.actionId === actionId && entry.feasible && entry.recommendationEligible);
    if (!candidate) throw new Error(`STRATEGY_FEASIBILITY_ACTION_NOT_EXECUTABLE:${actionId}`);
    state = applyRecommendationCandidateTransitionV1(state, candidate, graph).state;
    validatedActionIds.push(actionId);
  }

  const terminalOwnedItemIds = [...state.inventory.heldByItemId.keys()].sort((left, right) => left - right);
  const hardGoals = goals.filter((goal) => goal.mandatory && goal.type !== 'TERMINAL');
  const satisfiedHardGoals = hardGoals.filter((goal) =>
    goal.targetItemIds.length > 0 && goal.targetItemIds.every((itemId) =>
      graph.isTargetSatisfied(itemId, terminalOwnedItemIds),
    ),
  ).length;
  const mandatoryGoalCoverage = hardGoals.length === 0 ? 1 : satisfiedHardGoals / hardGoals.length;
  const actionCoverage = archetype.representativeActionIds.length === 0
    ? 1
    : validatedActionIds.length / archetype.representativeActionIds.length;
  const terminalSatisfied = terminalItemIds.every((itemId) =>
    graph.isTargetSatisfied(itemId, terminalOwnedItemIds),
  );
  const releaseEligible = actionCoverage === 1 && mandatoryGoalCoverage === 1 && terminalSatisfied;

  return {
    releaseEligible,
    actionCoverage,
    mandatoryGoalCoverage,
    terminalSatisfied,
    validatedActionIds,
    terminalOwnedItemIds,
  };
}

function syntheticFeasibilityState(
  archetype: MinedBuildArchetypeV1,
  graph: RecommendationItemGraph,
): RecommendationDecisionState {
  const initialOwnedItemIds = [...new Set(archetype.representativeInitialOwnedItemIds)]
    .sort((left, right) => left - right);
  for (const itemId of initialOwnedItemIds) {
    const item = graph.getItem(itemId);
    if (!item || !item.availableRulesetIds.includes(archetype.rulesetId)) {
      throw new Error(`STRATEGY_INITIAL_ITEM_INVALID:${itemId}`);
    }
  }
  const heldByItemId = buildInventoryInstancesForRecommendation(initialOwnedItemIds, graph);
  return {
    decisionId: `strategy-feasibility:${archetype.archetypeId}`,
    matchId: `strategy-feasibility:${archetype.representativeDecisionId}`,
    playerSlot: 0,
    gameTimeSec: 0,
    rulesetId: archetype.rulesetId,
    heroId: archetype.heroId,
    inventory: {
      initializedFromSnapshot: true,
      heldByItemId,
      lifecycleCountByItemId: new Map(initialOwnedItemIds.map((itemId) => [itemId, 1])),
      nextInstanceSequence: heldByItemId.size + 1,
    },
    economy: {
      spendableSouls: observedFact(1_000_000_000_000, 'strategy-feasibility'),
      shopOpportunity: observedFact('AVAILABLE' as const, 'strategy-feasibility'),
    },
  };
}

function inferGoalType(goalId: string): BuildStrategyGoalV1['type'] {
  const normalized = goalId.toLowerCase();
  if (normalized.includes('choice') || normalized.includes('branch')) return 'BRANCH';
  if (normalized.includes('upgrade')) return 'UPGRADE';
  if (normalized.includes('spike')) return 'POWER_SPIKE';
  if (normalized.includes('investment')) return 'INVESTMENT';
  return 'CORE';
}

function validateSituationalWindow(
  window: CompiledBuildStrategySituationalWindowV1,
  availableItemIds: ReadonlySet<number>,
): CompiledBuildStrategySituationalWindowV1 {
  if (!window.windowId.trim()) throw new Error('SITUATIONAL_WINDOW_ID_INVALID');
  const targetItemIds = normalizeTargets(window.targetItemIds, availableItemIds, 'SITUATIONAL_TARGET_INVALID');
  if (targetItemIds.length === 0) throw new Error(`SITUATIONAL_TARGETS_EMPTY:${window.windowId}`);
  if (!Number.isSafeInteger(window.maxItems) || window.maxItems <= 0 || window.maxItems > targetItemIds.length) {
    throw new Error(`SITUATIONAL_MAX_ITEMS_INVALID:${window.windowId}`);
  }
  if (!Number.isFinite(window.maxSoulsDelay) || window.maxSoulsDelay < 0) {
    throw new Error(`SITUATIONAL_DELAY_INVALID:${window.windowId}`);
  }
  if (!Number.isSafeInteger(window.reservedSlots) || window.reservedSlots <= 0) {
    throw new Error(`SITUATIONAL_RESERVED_SLOTS_INVALID:${window.windowId}`);
  }
  return {
    windowId: window.windowId,
    targetItemIds,
    purpose: window.purpose,
    maxItems: window.maxItems,
    maxSoulsDelay: window.maxSoulsDelay,
    reservedSlots: window.reservedSlots,
  };
}

function validateTerminalCapacity(
  terminalItemIds: readonly number[],
  graph: RecommendationItemGraph,
  rules: AdaptiveSlotRulesV1,
): void {
  const used = { weapon: 0, vitality: 0, spirit: 0 };
  let active = 0;
  for (const itemId of terminalItemIds) {
    const item = graph.getItem(itemId);
    if (!item) throw new Error(`TERMINAL_ITEM_INVALID:${itemId}`);
    used[item.slotType] += 1;
    if (item.active) active += 1;
  }
  const overflow = (['weapon', 'vitality', 'spirit'] as const).reduce(
    (sum, type) => sum + Math.max(0, used[type] - rules.baseSlotsByType[type]),
    0,
  );
  if (overflow > rules.maxFlexSlots) throw new Error('TERMINAL_SLOT_CAPACITY_EXCEEDED');
  if (active > rules.maxActiveItems) throw new Error('TERMINAL_ACTIVE_ITEM_LIMIT_EXCEEDED');
}

function validateSlotRuleScope(
  selected: AdaptiveSlotRulesV1,
  representative: AdaptiveSlotRulesV1,
): void {
  if (representative.evidence === 'UNKNOWN') return;
  const same = selected.maxFlexSlots === representative.maxFlexSlots &&
    selected.maxActiveItems === representative.maxActiveItems &&
    selected.baseSlotsByType.weapon === representative.baseSlotsByType.weapon &&
    selected.baseSlotsByType.vitality === representative.baseSlotsByType.vitality &&
    selected.baseSlotsByType.spirit === representative.baseSlotsByType.spirit;
  if (!same) throw new Error('STRATEGY_SLOT_RULES_SCOPE_MISMATCH');
}

function normalizeTargets(
  itemIds: readonly number[],
  availableItemIds: ReadonlySet<number>,
  errorCode: string,
): readonly number[] {
  const result = [...new Set(itemIds)].sort((left, right) => left - right);
  for (const itemId of result) {
    if (!Number.isSafeInteger(itemId) || itemId <= 0 || !availableItemIds.has(itemId)) {
      throw new Error(`${errorCode}:${itemId}`);
    }
  }
  return result;
}

function validateIdentity(archetype: MinedBuildArchetypeV1): void {
  if (!archetype.archetypeId.trim()) throw new Error('STRATEGY_ID_INVALID');
  if (!Number.isSafeInteger(archetype.heroId) || archetype.heroId <= 0) throw new Error('STRATEGY_HERO_INVALID');
  if (!archetype.rulesetId.trim()) throw new Error('STRATEGY_RULESET_INVALID');
  if (!/^[a-f0-9]{64}$/i.test(archetype.catalogSha256)) throw new Error('STRATEGY_CATALOG_INVALID');
  if (!Number.isSafeInteger(archetype.supportCount) || archetype.supportCount <= 0) throw new Error('STRATEGY_SUPPORT_INVALID');
  if (!Number.isFinite(archetype.stability) || archetype.stability < 0 || archetype.stability > 1) {
    throw new Error('STRATEGY_STABILITY_INVALID');
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
