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
} from './adaptive-economy-v1';
import {
  AdaptiveInvestmentDeltaV1 as AdaptiveScoreInvestmentDeltaV1,
  AdaptiveSlotDeltaV1,
} from './adaptive-evidence-scorer-v1.service';
import { groupCompletedV1 } from './adaptive-phase-eligibility-v1.service';
import { ConsensusSkeletonV1 } from './statlocker-adaptive.types';

export interface AdaptivePlannerNodeV1 {
  decisionState: RecommendationDecisionState;
  slots: AdaptiveSlotStateV1;
  investment: AdaptiveInvestmentStateV1;
  selectedChoices: ReadonlyMap<string, number>;
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
  selectedChoices?: ReadonlyMap<string, number>;
  committedChoices?: ReadonlyMap<string, number>;
  completedGroupIds?: ReadonlySet<string>;
}): AdaptivePlannerNodeV1 {
  return {
    decisionState: input.decisionState,
    slots: input.slots,
    investment: input.investment,
    selectedChoices: new Map(input.selectedChoices ?? []),
    committedChoices: new Map(input.committedChoices ?? []),
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
  const slotRules = input.economyRules ?? {
    baseSlotsByType: input.node.slots.baseByType,
    maxFlexSlots: input.node.slots.maxFlexSlots,
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
      if (groupCompletedV1(group, owned)) completedGroupIds.add(group.groupId);
    }
  }

  return {
    node: {
      ...input.node,
      decisionState: projectedDecision,
      slots,
      investment,
      completedGroupIds,
      actions: [...input.node.actions, input.candidate],
    },
    investmentDelta: derivePlannerInvestmentDeltaV1(input.node.investment, investment),
    slotDelta: derivePlannerSlotDeltaV1(input.node, slots, projectedDecision),
  };
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
