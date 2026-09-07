import {
  RecommendationCandidate,
  RecommendationItemGraph,
} from '@deadlock-live-probe/build-domain';
import { BuildContractV1 } from './build-contract-v1';
import {
  ConsensusBuildGroupV1,
  ConsensusBuildPhaseV1,
  ConsensusSkeletonV1,
} from './statlocker-adaptive.types';

export type BuildStrategyGoalTypeV1 =
  | 'CORE'
  | 'POWER_SPIKE'
  | 'UPGRADE'
  | 'BRANCH'
  | 'INVESTMENT'
  | 'SITUATIONAL_WINDOW'
  | 'TERMINAL';

export interface BuildStrategyGoalV1 {
  goalId: string;
  type: BuildStrategyGoalTypeV1;
  mandatory: boolean;
  targetItemIds: readonly number[];
  sourceGroupId?: string;
  phase?: ConsensusBuildPhaseV1;
  dependsOnGoalIds: readonly string[];
}

export interface BuildStrategySituationalWindowV1 {
  windowId: string;
  targetItemIds: readonly number[];
}

export interface BuildStrategySpecV1 {
  strategyId: string;
  heroId: number;
  rulesetId: string;
  support: number;
  goals: readonly BuildStrategyGoalV1[];
}

export interface CompileStructuredConsensusStrategyInputV1 {
  skeleton: ConsensusSkeletonV1;
  itemGraph: RecommendationItemGraph;
  rulesetId: string;
  situationalWindows?: readonly BuildStrategySituationalWindowV1[];
}

export interface BuildGoalCandidateFilterOptionsV1 {
  capacityExitItemIds?: ReadonlySet<number>;
}

export function compileStructuredConsensusStrategyV1(
  input: CompileStructuredConsensusStrategyInputV1,
): BuildStrategySpecV1 {
  const goals: BuildStrategyGoalV1[] = [];
  const mandatoryGoalIds: string[] = [];

  for (const group of input.skeleton.groups) {
    if (group.type === 'OPTIONAL') continue;
    const goal = compileStructuredGroupGoalV1(group, input.itemGraph);
    goals.push(goal);
    if (goal.mandatory) mandatoryGoalIds.push(goal.goalId);
  }

  for (const window of input.situationalWindows ?? []) {
    const targetItemIds = normalizeExistingItemIds(window.targetItemIds, input.itemGraph);
    if (targetItemIds.length === 0) continue;
    goals.push({
      goalId: `situational:${window.windowId}`,
      type: 'SITUATIONAL_WINDOW',
      mandatory: false,
      targetItemIds,
      dependsOnGoalIds: [],
    });
  }

  goals.push({
    goalId: 'terminal:mandatory-completion',
    type: 'TERMINAL',
    mandatory: true,
    targetItemIds: [],
    dependsOnGoalIds: [...mandatoryGoalIds],
  });

  return {
    strategyId: `structured:${input.skeleton.heroId}:${input.rulesetId}`,
    heroId: input.skeleton.heroId,
    rulesetId: input.rulesetId,
    support: Math.max(0, input.skeleton.profileCount),
    goals,
  };
}

export function resolveActiveBuildStrategyGoalsV1(
  strategy: BuildStrategySpecV1,
  contract: BuildContractV1,
): readonly BuildStrategyGoalV1[] {
  if (contract.status === 'OUT_OF_DISTRIBUTION' || contract.status === 'REPLAN_REQUIRED') return [];

  if (contract.status === 'COMPLETE') {
    return strategy.goals.filter((goal) => goal.type === 'TERMINAL');
  }

  const activeGoalIds = new Set<string>();
  if (contract.currentGoalId) activeGoalIds.add(contract.currentGoalId);
  for (const window of contract.situationalWindowStates) {
    if (window.state === 'OPEN') activeGoalIds.add(`situational:${window.windowId}`);
  }

  return strategy.goals.filter((goal) => activeGoalIds.has(goal.goalId));
}

export function filterRecommendationCandidatesForActiveGoalsV1(
  candidates: readonly RecommendationCandidate[],
  activeGoals: readonly BuildStrategyGoalV1[],
  itemGraph: RecommendationItemGraph,
  options: BuildGoalCandidateFilterOptionsV1 = {},
): readonly RecommendationCandidate[] {
  const targetFamilies = new Set<number>();
  for (const goal of activeGoals) {
    if (goal.type === 'TERMINAL') continue;
    for (const targetItemId of goal.targetItemIds) {
      targetFamilies.add(targetItemId);
      for (const componentItemId of itemGraph.getTransitiveComponentIds(targetItemId)) {
        targetFamilies.add(componentItemId);
      }
    }
  }

  return candidates.filter((candidate) => {
    switch (candidate.action.type) {
      case 'BUY_ITEM':
      case 'UPGRADE_ITEM':
        return targetFamilies.has(candidate.action.itemId);
      case 'REPLACE_ITEM':
        return targetFamilies.has(candidate.action.buyItemId);
      case 'WAIT_SAVE':
        return candidate.action.targetItemId === undefined || targetFamilies.has(candidate.action.targetItemId);
      case 'SELL_ITEM':
        return options.capacityExitItemIds?.has(candidate.action.itemId) ?? false;
    }
  });
}

function compileStructuredGroupGoalV1(
  group: ConsensusBuildGroupV1,
  itemGraph: RecommendationItemGraph,
): BuildStrategyGoalV1 {
  const targetItemIds = normalizeExistingItemIds(
    group.candidates.map((candidate) => candidate.itemId),
    itemGraph,
  );
  const type: BuildStrategyGoalTypeV1 = group.type === 'CHOICE'
    ? 'BRANCH'
    : targetItemIds.length > 0 && targetItemIds.every((itemId) => itemGraph.getDirectComponentIds(itemId).length > 0)
      ? 'UPGRADE'
      : 'CORE';

  return {
    goalId: group.groupId,
    type,
    mandatory: true,
    targetItemIds,
    sourceGroupId: group.groupId,
    phase: group.phase,
    dependsOnGoalIds: [],
  };
}

function normalizeExistingItemIds(
  itemIds: readonly number[],
  itemGraph: RecommendationItemGraph,
): readonly number[] {
  return [...new Set(itemIds)]
    .filter((itemId) => itemGraph.getItem(itemId) !== undefined)
    .sort((left, right) => left - right);
}
