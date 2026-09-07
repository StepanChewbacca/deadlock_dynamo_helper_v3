import { RecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { groupCompletedV1 } from './adaptive-phase-eligibility-v1.service';
import { ConsensusBuildGroupV1, ConsensusSkeletonV1 } from './statlocker-adaptive.types';

export type BuildStatusV1 =
  | 'IN_PROGRESS'
  | 'WAITING'
  | 'COMPLETE'
  | 'REPLAN_REQUIRED'
  | 'OUT_OF_DISTRIBUTION';

export type BuildContractExecutionStateV1 = 'ACTIONABLE' | 'HOLD' | 'WAITING';

export type BuildSlotReservationStateV1 =
  | 'READY'
  | 'LOCKED_BY_FLEX'
  | 'LOCKED_BY_SELL'
  | 'LOCKED_BY_UPGRADE_COMPRESSION'
  | 'BLOCKED';

export interface BuildSlotReservationV1 {
  goalId: string;
  targetItemId: number;
  state: BuildSlotReservationStateV1;
  reasonCodes: readonly string[];
}

export interface BuildSituationalWindowStateV1 {
  windowId: string;
  state: 'CLOSED' | 'OPEN' | 'RESOLVED';
  targetItemIds: readonly number[];
  reasonCodes: readonly string[];
}

export interface BuildContractV1 {
  strategyId?: string;
  status: BuildStatusV1;
  currentGoalId?: string;
  completedGoalIds: ReadonlySet<string>;
  remainingGoalIds: readonly string[];
  committedChoiceItemIdsByGroup: ReadonlyMap<string, readonly number[]>;
  temporaryItemIds: ReadonlySet<number>;
  slotReservations: readonly BuildSlotReservationV1[];
  situationalWindowStates: readonly BuildSituationalWindowStateV1[];
  replanReasonCodes: readonly string[];
}

export interface BuildContractInputV1 {
  skeleton: ConsensusSkeletonV1;
  itemGraph: RecommendationItemGraph;
  ownedItemIds: readonly number[];
  executionState: BuildContractExecutionStateV1;
  committedChoiceItemIdsByGroup: ReadonlyMap<string, readonly number[]>;
  strategyId?: string;
  slotReservations?: readonly BuildSlotReservationV1[];
  situationalWindowStates?: readonly BuildSituationalWindowStateV1[];
  outOfDistribution?: boolean;
  replanRequiredReasonCodes?: readonly string[];
}

export function compileBuildContractV1(input: BuildContractInputV1): BuildContractV1 {
  const owned = new Set(input.ownedItemIds);
  const mandatoryGroups = input.skeleton.groups.filter(isMandatoryGroup);
  const completedGoalIds = new Set<string>();
  const replanReasonCodes = new Set(input.replanRequiredReasonCodes ?? []);

  for (const group of mandatoryGroups) {
    if (mandatoryGoalCompleted(group, input, owned)) completedGoalIds.add(group.groupId);
  }

  const remainingGoalIds = mandatoryGroups
    .filter((group) => !completedGoalIds.has(group.groupId))
    .map((group) => group.groupId);
  const temporaryItemIds = resolveTemporaryItemIds(input, mandatoryGroups, owned);
  if (temporaryItemIds.size > 0) replanReasonCodes.add('USER_DIVERGENCE_REBASED');

  const status = resolveBuildStatus(
    input,
    remainingGoalIds,
    replanReasonCodes,
  );

  return {
    strategyId: input.strategyId,
    status,
    currentGoalId: remainingGoalIds[0],
    completedGoalIds,
    remainingGoalIds,
    committedChoiceItemIdsByGroup: cloneChoiceCommitments(input.committedChoiceItemIdsByGroup),
    temporaryItemIds,
    slotReservations: [...(input.slotReservations ?? [])],
    situationalWindowStates: [...(input.situationalWindowStates ?? [])],
    replanReasonCodes: [...replanReasonCodes].sort(),
  };
}

function isMandatoryGroup(group: ConsensusBuildGroupV1): boolean {
  return group.type === 'REQUIRED' || group.type === 'CHOICE';
}

function mandatoryGoalCompleted(
  group: ConsensusBuildGroupV1,
  input: BuildContractInputV1,
  owned: ReadonlySet<number>,
): boolean {
  if (group.type !== 'CHOICE') return groupCompletedV1(group, owned, input.itemGraph);

  const committed = input.committedChoiceItemIdsByGroup.get(group.groupId) ?? [];
  if (committed.length === 0) return groupCompletedV1(group, owned, input.itemGraph);

  const groupCandidates = new Set(group.candidates.map((candidate) => candidate.itemId));
  const committedInsideGroup = [...new Set(committed)].filter((itemId) => groupCandidates.has(itemId));
  if (committedInsideGroup.length < Math.max(1, group.minSelect)) return false;

  const satisfied = committedInsideGroup.filter((itemId) => input.itemGraph.isTargetSatisfied(itemId, owned));
  return satisfied.length >= Math.max(1, group.minSelect);
}

function resolveTemporaryItemIds(
  input: BuildContractInputV1,
  mandatoryGroups: readonly ConsensusBuildGroupV1[],
  owned: ReadonlySet<number>,
): ReadonlySet<number> {
  const structuralItemIds = new Set<number>();
  for (const group of mandatoryGroups) {
    for (const candidate of group.candidates) {
      structuralItemIds.add(candidate.itemId);
      for (const componentId of input.itemGraph.getTransitiveComponentIds(candidate.itemId)) {
        structuralItemIds.add(componentId);
      }
    }
  }

  return new Set(
    [...owned]
      .filter((itemId) => !structuralItemIds.has(itemId))
      .sort((left, right) => left - right),
  );
}

function resolveBuildStatus(
  input: BuildContractInputV1,
  remainingGoalIds: readonly string[],
  replanReasonCodes: ReadonlySet<string>,
): BuildStatusV1 {
  if (input.outOfDistribution) return 'OUT_OF_DISTRIBUTION';
  if ((input.replanRequiredReasonCodes?.length ?? 0) > 0) return 'REPLAN_REQUIRED';
  if (remainingGoalIds.length === 0) return 'COMPLETE';
  if (input.executionState === 'WAITING') return 'WAITING';
  return 'IN_PROGRESS';
}

function cloneChoiceCommitments(
  values: ReadonlyMap<string, readonly number[]>,
): ReadonlyMap<string, readonly number[]> {
  return new Map(
    [...values.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([groupId, itemIds]) => [
        groupId,
        [...new Set(itemIds)].sort((left, right) => left - right),
      ] as const),
  );
}
