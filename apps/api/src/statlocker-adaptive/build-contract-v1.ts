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
  futureGoalTargetItemIdsByGoal?: ReadonlyMap<string, readonly number[]>;
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
  const temporaryItemIds = resolveTemporaryItemIds(input, input.skeleton.groups, owned);
  if (temporaryItemIds.size > 0) replanReasonCodes.add('USER_DIVERGENCE_REBASED');

  const slotReservations = resolveSlotReservations(input, remainingGoalIds, owned);
  for (const reservation of slotReservations) {
    if (reservation.state !== 'BLOCKED') continue;
    for (const reasonCode of reservation.reasonCodes) replanReasonCodes.add(reasonCode);
  }

  const status = resolveBuildStatus(input, remainingGoalIds, slotReservations);

  return {
    ...(input.strategyId === undefined ? {} : { strategyId: input.strategyId }),
    status,
    ...(remainingGoalIds[0] === undefined ? {} : { currentGoalId: remainingGoalIds[0] }),
    completedGoalIds,
    remainingGoalIds,
    committedChoiceItemIdsByGroup: cloneChoiceCommitments(input.committedChoiceItemIdsByGroup),
    temporaryItemIds,
    slotReservations,
    situationalWindowStates: [...(input.situationalWindowStates ?? [])],
    replanReasonCodes: [...replanReasonCodes].sort(),
  };
}

export function createOutOfDistributionBuildContractV1(
  reasonCodes: readonly string[],
): BuildContractV1 {
  return {
    status: 'OUT_OF_DISTRIBUTION',
    completedGoalIds: new Set(),
    remainingGoalIds: [],
    committedChoiceItemIdsByGroup: new Map(),
    temporaryItemIds: new Set(),
    slotReservations: [],
    situationalWindowStates: [],
    replanReasonCodes: [...new Set(reasonCodes)].sort(),
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
  strategyGroups: readonly ConsensusBuildGroupV1[],
  owned: ReadonlySet<number>,
): ReadonlySet<number> {
  const structuralItemIds = new Set<number>();
  for (const group of strategyGroups) {
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

function resolveSlotReservations(
  input: BuildContractInputV1,
  remainingGoalIds: readonly string[],
  owned: ReadonlySet<number>,
): readonly BuildSlotReservationV1[] {
  const remainingGoals = new Set(remainingGoalIds);
  const byKey = new Map<string, BuildSlotReservationV1>();

  for (const reservation of input.slotReservations ?? []) {
    if (!remainingGoals.has(reservation.goalId)) continue;
    if (input.itemGraph.isTargetSatisfied(reservation.targetItemId, owned)) continue;
    byKey.set(slotReservationKey(reservation.goalId, reservation.targetItemId), {
      goalId: reservation.goalId,
      targetItemId: reservation.targetItemId,
      state: reservation.state,
      reasonCodes: [...new Set(reservation.reasonCodes)].sort(),
    });
  }

  for (const [goalId, targetItemIds] of input.futureGoalTargetItemIdsByGoal ?? []) {
    if (!remainingGoals.has(goalId)) continue;
    for (const targetItemId of [...new Set(targetItemIds)].sort((left, right) => left - right)) {
      if (input.itemGraph.isTargetSatisfied(targetItemId, owned)) continue;
      const key = slotReservationKey(goalId, targetItemId);
      if (byKey.has(key)) continue;
      byKey.set(key, {
        goalId,
        targetItemId,
        state: 'BLOCKED',
        reasonCodes: ['MANDATORY_CAPACITY_PATH_UNRESOLVED'],
      });
    }
  }

  return [...byKey.values()].sort((left, right) =>
    left.goalId.localeCompare(right.goalId) || left.targetItemId - right.targetItemId,
  );
}

function slotReservationKey(goalId: string, targetItemId: number): string {
  return `${goalId}:${targetItemId}`;
}

function resolveBuildStatus(
  input: BuildContractInputV1,
  remainingGoalIds: readonly string[],
  slotReservations: readonly BuildSlotReservationV1[],
): BuildStatusV1 {
  if (input.outOfDistribution) return 'OUT_OF_DISTRIBUTION';
  if ((input.replanRequiredReasonCodes?.length ?? 0) > 0) return 'REPLAN_REQUIRED';
  if (slotReservations.some((reservation) => reservation.state === 'BLOCKED')) return 'REPLAN_REQUIRED';
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
