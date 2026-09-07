import {
  RecommendationCandidate,
  RecommendationDecisionState,
  RecommendationItemGraph,
  applyRecommendationCandidateTransitionV1,
} from '@deadlock-live-probe/build-domain';
import {
  AdaptiveFlexCapacityInputV1,
  AdaptiveInvestmentStateV1,
  AdaptiveSlotRulesV1,
  AdaptiveSlotStateV1,
  RecommendationEconomyRulesV1,
  deriveAdaptiveInvestmentStateV1,
  deriveAdaptiveSlotStateV1,
} from './adaptive-economy-v1';
import { BuildContractV1 } from './build-contract-v1';

export interface PlannerTrajectoryActionV2 {
  candidate: RecommendationCandidate;
  goalId?: string;
  gameTimeSec?: number;
  enemyHeroIds?: readonly number[];
  flexCapacity?: AdaptiveFlexCapacityInputV1;
}

export interface PlannerTrajectoryStepV2 {
  index: number;
  actionId: string;
  actionType: RecommendationCandidate['action']['type'];
  goalId?: string;
  targetItemId?: number;
  sourceItemIds: readonly number[];
  consumedItemIds: readonly number[];
  removedItemIds: readonly number[];
  addedItemIds: readonly number[];
  soulsDelta: number;
  beforeSouls?: number;
  afterSouls?: number;
  beforeInventoryFingerprint: string;
  afterInventoryFingerprint: string;
  beforeStateFingerprint: string;
  afterStateFingerprint: string;
  beforeOwnedItemIds: readonly number[];
  afterOwnedItemIds: readonly number[];
  gameTimeSec: number;
  rulesetId: string;
  catalogSha256: string;
  heroId: number;
  enemyHeroIds: readonly number[];
  beforeSlotState: AdaptiveSlotStateV1;
  afterSlotState: AdaptiveSlotStateV1;
  beforeInvestmentState: AdaptiveInvestmentStateV1;
  afterInvestmentState: AdaptiveInvestmentStateV1;
}

export interface PlannerTrajectoryV2 {
  strategyId: string;
  decisionId: string;
  initialStateRevision: string;
  matchId: string;
  playerSlot: number;
  heroId: number;
  rulesetId: string;
  catalogSha256: string;
  enemyHeroIds: readonly number[];
  initialGameTimeSec: number;
  initialOwnedItemIds: readonly number[];
  initialSpendableSouls?: number;
  slotRules: AdaptiveSlotRulesV1;
  flexCapacity: AdaptiveFlexCapacityInputV1;
  steps: readonly PlannerTrajectoryStepV2[];
  terminalContract: BuildContractV1;
  terminalOwnedItemIds: readonly number[];
  utility: number;
  confidence: number;
}

export interface CompilePlannerTrajectoryInputV2 {
  strategyId: string;
  decisionId: string;
  initialStateRevision: string;
  catalogSha256: string;
  enemyHeroIds: readonly number[];
  initialState: RecommendationDecisionState;
  itemGraph: RecommendationItemGraph;
  slotRules: AdaptiveSlotRulesV1;
  flexCapacity?: AdaptiveFlexCapacityInputV1;
  economyRules?: RecommendationEconomyRulesV1;
  actions: readonly PlannerTrajectoryActionV2[];
  terminalContract: BuildContractV1;
  utility: number;
  confidence: number;
}

export function compilePlannerTrajectoryV2(input: CompilePlannerTrajectoryInputV2): PlannerTrajectoryV2 {
  validateTrajectoryInput(input);
  const catalogSha256 = input.catalogSha256.toLowerCase();
  const initialEnemyHeroIds = normalizeHeroIds(input.enemyHeroIds);
  const defaultFlexCapacity = normalizeFlexCapacity(input.flexCapacity ?? { evidence: 'UNKNOWN' });
  let state = input.initialState;
  let previousGameTimeSec = state.gameTimeSec;
  const initialOwnedItemIds = ownedItemIds(state);
  const steps: PlannerTrajectoryStepV2[] = [];

  input.actions.forEach((entry, index) => {
    if (!entry.candidate.feasible || !entry.candidate.recommendationEligible) {
      throw new Error(`Planner trajectory contains a non-executable candidate: ${entry.candidate.actionId}`);
    }

    const gameTimeSec = normalizeGameTime(entry.gameTimeSec ?? state.gameTimeSec);
    if (gameTimeSec < previousGameTimeSec) throw new Error('TRAJECTORY_GAME_TIME_NOT_MONOTONIC');
    previousGameTimeSec = gameTimeSec;
    state = { ...state, gameTimeSec };

    const flexCapacity = normalizeFlexCapacity(entry.flexCapacity ?? defaultFlexCapacity);
    const enemyHeroIds = normalizeHeroIds(entry.enemyHeroIds ?? initialEnemyHeroIds);
    const beforeOwnedItemIds = ownedItemIds(state);
    const beforeSouls = state.economy.spendableSouls.value;
    const beforeSlotState = deriveAdaptiveSlotStateV1(
      beforeOwnedItemIds,
      input.itemGraph,
      input.slotRules,
      flexCapacity,
    );
    const beforeInvestmentState = deriveAdaptiveInvestmentStateV1(
      beforeOwnedItemIds,
      input.itemGraph,
      input.economyRules,
    );
    const beforeStateFingerprint = stateFingerprint(
      state,
      catalogSha256,
      enemyHeroIds,
      beforeOwnedItemIds,
    );

    const transition = applyRecommendationCandidateTransitionV1(
      state,
      entry.candidate,
      input.itemGraph,
    );
    const afterOwnedItemIds = ownedItemIds(transition.state);
    const afterSouls = transition.state.economy.spendableSouls.value;
    const afterSlotState = deriveAdaptiveSlotStateV1(
      afterOwnedItemIds,
      input.itemGraph,
      input.slotRules,
      flexCapacity,
    );
    const afterInvestmentState = deriveAdaptiveInvestmentStateV1(
      afterOwnedItemIds,
      input.itemGraph,
      input.economyRules,
    );
    const afterStateFingerprint = stateFingerprint(
      transition.state,
      catalogSha256,
      enemyHeroIds,
      afterOwnedItemIds,
    );

    steps.push({
      index,
      actionId: entry.candidate.actionId,
      actionType: entry.candidate.action.type,
      ...(entry.goalId === undefined ? {} : { goalId: entry.goalId }),
      ...(candidateTargetItemId(entry.candidate) === undefined
        ? {}
        : { targetItemId: candidateTargetItemId(entry.candidate) }),
      sourceItemIds: candidateSourceItemIds(entry.candidate),
      consumedItemIds: [...transition.consumedItemIds],
      removedItemIds: [...transition.removedItemIds],
      addedItemIds: [...transition.addedItemIds],
      soulsDelta: transition.soulsDelta,
      ...(beforeSouls === undefined ? {} : { beforeSouls }),
      ...(afterSouls === undefined ? {} : { afterSouls }),
      beforeInventoryFingerprint: transition.beforeInventoryFingerprint,
      afterInventoryFingerprint: transition.afterInventoryFingerprint,
      beforeStateFingerprint,
      afterStateFingerprint,
      beforeOwnedItemIds,
      afterOwnedItemIds,
      gameTimeSec,
      rulesetId: state.rulesetId,
      catalogSha256,
      heroId: state.heroId,
      enemyHeroIds,
      beforeSlotState,
      afterSlotState,
      beforeInvestmentState,
      afterInvestmentState,
    });
    state = transition.state;
  });

  return {
    strategyId: input.strategyId,
    decisionId: input.decisionId,
    initialStateRevision: input.initialStateRevision,
    matchId: input.initialState.matchId,
    playerSlot: input.initialState.playerSlot,
    heroId: input.initialState.heroId,
    rulesetId: input.initialState.rulesetId,
    catalogSha256,
    enemyHeroIds: initialEnemyHeroIds,
    initialGameTimeSec: input.initialState.gameTimeSec,
    initialOwnedItemIds,
    ...(input.initialState.economy.spendableSouls.value === undefined
      ? {}
      : { initialSpendableSouls: input.initialState.economy.spendableSouls.value }),
    slotRules: cloneSlotRules(input.slotRules),
    flexCapacity: defaultFlexCapacity,
    steps,
    terminalContract: input.terminalContract,
    terminalOwnedItemIds: ownedItemIds(state),
    utility: finiteOrZero(input.utility),
    confidence: clamp01(input.confidence),
  };
}

function validateTrajectoryInput(input: CompilePlannerTrajectoryInputV2): void {
  if (!input.strategyId.trim()) throw new Error('TRAJECTORY_STRATEGY_ID_INVALID');
  if (!input.decisionId.trim()) throw new Error('TRAJECTORY_DECISION_ID_INVALID');
  if (!input.initialStateRevision.trim()) throw new Error('TRAJECTORY_STATE_REVISION_INVALID');
  if (!/^[a-f0-9]{64}$/i.test(input.catalogSha256)) throw new Error('TRAJECTORY_CATALOG_INVALID');
  if (!input.initialState.rulesetId.trim()) throw new Error('TRAJECTORY_RULESET_INVALID');
  if (!Number.isSafeInteger(input.initialState.heroId) || input.initialState.heroId <= 0) {
    throw new Error('TRAJECTORY_HERO_INVALID');
  }
  validateSlotRules(input.slotRules);
  if (input.economyRules) {
    if (input.economyRules.rulesetId !== input.initialState.rulesetId) {
      throw new Error('TRAJECTORY_ECONOMY_RULESET_MISMATCH');
    }
    if (input.economyRules.catalogSha256.toLowerCase() !== input.catalogSha256.toLowerCase()) {
      throw new Error('TRAJECTORY_ECONOMY_CATALOG_MISMATCH');
    }
  }
}

function validateSlotRules(rules: AdaptiveSlotRulesV1): void {
  const values = [
    rules.baseSlotsByType.weapon,
    rules.baseSlotsByType.vitality,
    rules.baseSlotsByType.spirit,
    rules.maxFlexSlots,
    rules.maxActiveItems,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('TRAJECTORY_SLOT_RULES_INVALID');
  }
}

function normalizeFlexCapacity(input: AdaptiveFlexCapacityInputV1): AdaptiveFlexCapacityInputV1 {
  if (input.evidence === 'UNKNOWN' || input.unlockedFlexSlots === undefined) {
    return { evidence: 'UNKNOWN' };
  }
  if (!Number.isSafeInteger(input.unlockedFlexSlots) || input.unlockedFlexSlots < 0) {
    throw new Error('TRAJECTORY_FLEX_CAPACITY_INVALID');
  }
  return { unlockedFlexSlots: input.unlockedFlexSlots, evidence: input.evidence };
}

function normalizeGameTime(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('TRAJECTORY_GAME_TIME_INVALID');
  return value;
}

function normalizeHeroIds(values: readonly number[]): readonly number[] {
  const normalized = [...new Set(values)].sort((left, right) => left - right);
  if (normalized.some((heroId) => !Number.isSafeInteger(heroId) || heroId <= 0)) {
    throw new Error('TRAJECTORY_ENEMY_HERO_INVALID');
  }
  return normalized;
}

function cloneSlotRules(rules: AdaptiveSlotRulesV1): AdaptiveSlotRulesV1 {
  return {
    baseSlotsByType: { ...rules.baseSlotsByType },
    maxFlexSlots: rules.maxFlexSlots,
    maxActiveItems: rules.maxActiveItems,
    evidence: rules.evidence,
  };
}

function stateFingerprint(
  state: RecommendationDecisionState,
  catalogSha256: string,
  enemyHeroIds: readonly number[],
  itemIds: readonly number[],
): string {
  return [
    state.rulesetId,
    catalogSha256,
    state.heroId,
    state.gameTimeSec,
    state.economy.spendableSouls.value ?? '?',
    itemIds.join(','),
    enemyHeroIds.join(','),
  ].join('|');
}

function ownedItemIds(state: RecommendationDecisionState): readonly number[] {
  return [...state.inventory.heldByItemId.keys()].sort((left, right) => left - right);
}

function candidateTargetItemId(candidate: RecommendationCandidate): number | undefined {
  switch (candidate.action.type) {
    case 'BUY_ITEM':
    case 'UPGRADE_ITEM':
      return candidate.action.itemId;
    case 'REPLACE_ITEM':
      return candidate.action.buyItemId;
    case 'WAIT_SAVE':
      return candidate.action.targetItemId;
    case 'SELL_ITEM':
      return undefined;
  }
}

function candidateSourceItemIds(candidate: RecommendationCandidate): readonly number[] {
  switch (candidate.action.type) {
    case 'UPGRADE_ITEM':
      return [...candidate.action.consumedItemIds].sort((left, right) => left - right);
    case 'REPLACE_ITEM':
      return [candidate.action.sellItemId];
    case 'SELL_ITEM':
      return [candidate.action.itemId];
    case 'BUY_ITEM':
    case 'WAIT_SAVE':
      return [];
  }
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
