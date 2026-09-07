import {
  RecommendationCandidate,
  RecommendationDecisionState,
  RecommendationItemGraph,
  applyRecommendationCandidateTransitionV1,
} from '@deadlock-live-probe/build-domain';
import { BuildContractV1 } from './build-contract-v1';

export interface PlannerTrajectoryActionV2 {
  candidate: RecommendationCandidate;
  goalId?: string;
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
  beforeOwnedItemIds: readonly number[];
  afterOwnedItemIds: readonly number[];
}

export interface PlannerTrajectoryV2 {
  strategyId: string;
  decisionId: string;
  initialStateRevision: string;
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
  initialState: RecommendationDecisionState;
  itemGraph: RecommendationItemGraph;
  actions: readonly PlannerTrajectoryActionV2[];
  terminalContract: BuildContractV1;
  utility: number;
  confidence: number;
}

export function compilePlannerTrajectoryV2(input: CompilePlannerTrajectoryInputV2): PlannerTrajectoryV2 {
  let state = input.initialState;
  const steps: PlannerTrajectoryStepV2[] = [];

  input.actions.forEach((entry, index) => {
    if (!entry.candidate.feasible || !entry.candidate.recommendationEligible) {
      throw new Error(`Planner trajectory contains a non-executable candidate: ${entry.candidate.actionId}`);
    }
    const beforeOwnedItemIds = ownedItemIds(state);
    const beforeSouls = state.economy.spendableSouls.value;
    const transition = applyRecommendationCandidateTransitionV1(
      state,
      entry.candidate,
      input.itemGraph,
    );
    const afterOwnedItemIds = ownedItemIds(transition.state);
    const afterSouls = transition.state.economy.spendableSouls.value;

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
      beforeOwnedItemIds,
      afterOwnedItemIds,
    });
    state = transition.state;
  });

  return {
    strategyId: input.strategyId,
    decisionId: input.decisionId,
    initialStateRevision: input.initialStateRevision,
    steps,
    terminalContract: input.terminalContract,
    terminalOwnedItemIds: ownedItemIds(state),
    utility: finiteOrZero(input.utility),
    confidence: clamp01(input.confidence),
  };
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
