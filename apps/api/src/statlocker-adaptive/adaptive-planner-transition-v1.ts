import {
  RecommendationCandidate,
  RecommendationDecisionState,
  RecommendationItemGraph,
  projectRecommendationCandidateState,
} from '@deadlock-live-probe/build-domain';
import {
  AdaptiveInvestmentStateV1,
  AdaptiveSlotStateV1,
  RecommendationEconomyRulesV1,
  deriveAdaptiveInvestmentStateV1,
  deriveAdaptiveSlotStateV1,
  slotRulesFromEconomyRulesV1,
} from './adaptive-economy-v1';
import {
  AdaptiveInvestmentDeltaV1 as AdaptiveScoreInvestmentDeltaV1,
  AdaptiveSlotDeltaV1,
} from './adaptive-evidence-scorer-v1.service';
import { groupCompletedV1 } from './adaptive-phase-eligibility-v1.service';
import { reconstructChoiceStateV1 } from './adaptive-choice-resolver-v1.service';
import { ConsensusBuildGroupV1, ConsensusSkeletonV1 } from './statlocker-adaptive.types';

export interface AdaptivePlannerNodeV1 {
  decisionState: RecommendationDecisionState;
  slots: AdaptiveSlotStateV1;
  investment: AdaptiveInvestmentStateV1;
  selectedChoiceItemIdsByGroup: ReadonlyMap<string, readonly number[]>;
  committedChoiceItemIdsByGroup: ReadonlyMap<string, readonly number[]>;
  /** @deprecated Compatibility projection of selectedChoiceItemIdsByGroup. */
  selectedChoices: ReadonlyMap<string, number>;
  /** @deprecated Compatibility projection of committedChoiceItemIdsByGroup. */
  committedChoices: ReadonlyMap<string, number>;
  completedGroupIds: ReadonlySet<string>;
  actions: readonly RecommendationCandidate[];
  utility: number;
  confidenceSum: number;
}

export interface ProjectPlannerCandidateInputV1 {
  node: AdaptivePlannerNodeV1;
  candidate: RecommendationCandidate;
  graph: RecommendationItemGraph;
  economyRules?: RecommendationEconomyRulesV1;
  skeleton?: ConsensusSkeletonV1;
}

export interface ProjectPlannerCandidateResultV1 {
  node: AdaptivePlannerNodeV1;
  investmentDelta: AdaptiveScoreInvestmentDeltaV1;
  slotDelta: AdaptiveSlotDeltaV1;
}

export function createAdaptivePlannerNodeV1(input: {
  decisionState: RecommendationDecisionState;
  slots: AdaptiveSlotStateV1;
  investment: AdaptiveInvestmentStateV1;
  selectedChoiceItemIdsByGroup?: ReadonlyMap<string, readonly number[]>;
  committedChoiceItemIdsByGroup?: ReadonlyMap<string, readonly number[]>;
  completedGroupIds?: ReadonlySet<string>;
}): AdaptivePlannerNodeV1 {
  const selectedChoiceItemIdsByGroup = normalizeChoiceItemIdsByGroup(
    input.selectedChoiceItemIdsByGroup ?? new Map(),
  );
  const committedChoiceItemIdsByGroup = normalizeChoiceItemIdsByGroup(
    input.committedChoiceItemIdsByGroup ?? new Map(),
  );
  return {
    decisionState: input.decisionState,
    slots: input.slots,
    investment: input.investment,
    selectedChoiceItemIdsByGroup,
    committedChoiceItemIdsByGroup,
    selectedChoices: choiceCompatibilityProjection(selectedChoiceItemIdsByGroup),
    committedChoices: choiceCompatibilityProjection(committedChoiceItemIdsByGroup),
    completedGroupIds: new Set(input.completedGroupIds ?? []),
    actions: [],
    utility: 0,
    confidenceSum: 0,
  };
}

export function projectPlannerCandidateV1(
  input: ProjectPlannerCandidateInputV1,
): ProjectPlannerCandidateResultV1 {
  const projectedDecision = projectRecommendationCandidateState(
    input.node.decisionState,
    input.candidate,
    input.graph,
  );
  const projectedItemIds = [...projectedDecision.inventory.heldByItemId.keys()].sort((a, b) => a - b);
  const slotRules = input.economyRules
    ? slotRulesFromEconomyRulesV1(input.economyRules)
    : {
        baseSlots: input.node.slots.baseSlots,
        baseSlotsByType: input.node.slots.baseSlotsByType,
        maxFlexSlots: input.node.slots.maxFlexSlots,
        maxActiveItems: input.node.slots.maxActiveItems,
      };
  const slots = deriveAdaptiveSlotStateV1(
    projectedItemIds,
    input.graph,
    slotRules,
    {
      unlockedFlexSlots: input.node.slots.unlockedFlexSlots,
      evidence: input.node.slots.evidence,
    },
  );
  const investment = deriveAdaptiveInvestmentStateV1(projectedItemIds, input.graph, input.economyRules);
  const completedGroupIds = new Set(input.node.completedGroupIds);
  if (input.skeleton) {
    const owned = new Set(projectedItemIds);
    for (const group of input.skeleton.groups) {
      if (groupCompletedV1(group, owned, input.graph)) completedGroupIds.add(group.groupId);
    }
  }

  const projectedNode = {
    ...input.node,
    decisionState: projectedDecision,
    slots,
    investment,
    completedGroupIds,
    actions: [...input.node.actions, input.candidate],
  };
  const node = input.skeleton
    ? refreshPlannerChoiceStateV1(projectedNode, input.skeleton, input.graph)
    : projectedNode;

  return {
    node,
    investmentDelta: derivePlannerInvestmentDeltaV1(input.node.investment, investment),
    slotDelta: derivePlannerSlotDeltaV1(input.node, slots, projectedDecision),
  };
}

export function refreshPlannerChoiceStateV1(
  node: AdaptivePlannerNodeV1,
  skeleton: ConsensusSkeletonV1,
  graph: RecommendationItemGraph,
): AdaptivePlannerNodeV1 {
  const ownedItemIds = [...node.decisionState.inventory.heldByItemId.keys()].sort((a, b) => a - b);
  const selectedChoiceItemIdsByGroup = new Map(node.selectedChoiceItemIdsByGroup);
  const committedChoiceItemIdsByGroup = new Map(node.committedChoiceItemIdsByGroup);

  for (const group of skeleton.groups.filter((entry) => entry.type === 'CHOICE')) {
    const previousSelected = selectedChoiceItemIdsByGroup.get(group.groupId) ?? [];
    const previousCommitted = committedChoiceItemIdsByGroup.get(group.groupId) ?? [];
    const reconstructed = reconstructChoiceStateV1(group, ownedItemIds, graph, previousCommitted);
    const committed = normalizeChoiceItemIds(reconstructed.committedItemIds);
    const selected = reconstructed.externallyDiverged
      ? normalizeChoiceItemIds(reconstructed.selectedItemIds)
      : reconcileSelectedChoiceItemIds(group, previousSelected, previousCommitted, committed);

    setChoiceItemIds(selectedChoiceItemIdsByGroup, group.groupId, selected);
    setChoiceItemIds(committedChoiceItemIdsByGroup, group.groupId, committed);
  }

  const normalizedSelected = normalizeChoiceItemIdsByGroup(selectedChoiceItemIdsByGroup);
  const normalizedCommitted = normalizeChoiceItemIdsByGroup(committedChoiceItemIdsByGroup);
  return {
    ...node,
    selectedChoiceItemIdsByGroup: normalizedSelected,
    committedChoiceItemIdsByGroup: normalizedCommitted,
    selectedChoices: choiceCompatibilityProjection(normalizedSelected),
    committedChoices: choiceCompatibilityProjection(normalizedCommitted),
  };
}

function reconcileSelectedChoiceItemIds(
  group: ConsensusBuildGroupV1,
  previousSelectedItemIds: readonly number[],
  previousCommittedItemIds: readonly number[],
  committedItemIds: readonly number[],
): number[] {
  const previousCommitted = new Set(previousCommittedItemIds);
  const committed = normalizeChoiceItemIds(committedItemIds);
  const retained = normalizeChoiceItemIds(previousSelectedItemIds).filter((itemId) =>
    !previousCommitted.has(itemId) || committed.includes(itemId),
  );
  const selected = [...committed];
  for (const itemId of retained) {
    if (!selected.includes(itemId) && selected.length < group.maxSelect) selected.push(itemId);
  }
  return normalizeChoiceItemIds(selected);
}

function normalizeChoiceItemIdsByGroup(
  values: ReadonlyMap<string, readonly number[]>,
): ReadonlyMap<string, readonly number[]> {
  return new Map(
    [...values.entries()]
      .map(([groupId, itemIds]) => [groupId, normalizeChoiceItemIds(itemIds)] as const)
      .filter(([, itemIds]) => itemIds.length > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function normalizeChoiceItemIds(itemIds: readonly number[]): number[] {
  return [...new Set(itemIds.filter(Number.isFinite))].sort((a, b) => a - b);
}

function choiceCompatibilityProjection(
  values: ReadonlyMap<string, readonly number[]>,
): ReadonlyMap<string, number> {
  return new Map(
    [...values.entries()]
      .filter(([, itemIds]) => itemIds.length > 0)
      .map(([groupId, itemIds]) => [groupId, itemIds[0]] as const),
  );
}

function setChoiceItemIds(
  values: Map<string, readonly number[]>,
  groupId: string,
  itemIds: readonly number[],
): void {
  if (itemIds.length === 0) values.delete(groupId);
  else values.set(groupId, itemIds);
}

export function derivePlannerInvestmentDeltaV1(
  before: AdaptiveInvestmentStateV1,
  after: AdaptiveInvestmentStateV1,
): AdaptiveScoreInvestmentDeltaV1 {
  if (before.evidence === 'UNKNOWN' || after.evidence === 'UNKNOWN') {
    return {
      evidence: 'UNKNOWN',
      breakpointsCrossed: 0,
      distanceReducedSouls: 0,
      achievedBreakpointsLost: 0,
    };
  }

  let breakpointsCrossed = 0;
  let distanceReducedSouls = 0;
  let achievedBreakpointsLost = 0;
  for (const type of ['weapon', 'vitality', 'spirit'] as const) {
    const previous = before.tracks[type];
    const next = after.tracks[type];
    const previousAchieved = previous.achievedBreakpoint ?? 0;
    const nextAchieved = next.achievedBreakpoint ?? 0;
    if (nextAchieved > previousAchieved) breakpointsCrossed += 1;
    if (nextAchieved < previousAchieved) achievedBreakpointsLost += 1;
    if (previous.nextBreakpoint !== undefined && previous.nextBreakpoint === next.nextBreakpoint) {
      distanceReducedSouls += Math.max(
        0,
        (previous.soulsToNextBreakpoint ?? 0) - (next.soulsToNextBreakpoint ?? 0),
      );
    }
  }
  return {
    evidence: 'RECONSTRUCTED',
    breakpointsCrossed,
    distanceReducedSouls,
    achievedBreakpointsLost,
  };
}

export function derivePlannerSlotDeltaV1(
  before: Pick<AdaptivePlannerNodeV1, 'decisionState' | 'slots'>,
  afterSlots: AdaptiveSlotStateV1,
  afterDecision: RecommendationDecisionState,
): AdaptiveSlotDeltaV1 {
  return {
    flexUsedBefore: before.slots.usedFlexSlots,
    flexUsedAfter: afterSlots.usedFlexSlots,
    slotsFreed: Math.max(
      0,
      before.decisionState.inventory.heldByItemId.size - afterDecision.inventory.heldByItemId.size,
    ),
  };
}
