import { Injectable } from '@nestjs/common';
import {
  RecommendationCandidate,
  RecommendationDecisionState,
  RecommendationItemGraph,
  buildInventoryInstancesForRecommendation,
  generateRecommendationCandidates,
  observedFact,
  projectRecommendationCandidateState,
} from '@deadlock-live-probe/build-domain';
import {
  AdaptiveSlotRulesV1,
  candidateGeneratorRulesFromSlotStateV1,
  deriveAdaptiveSlotStateV1,
} from './adaptive-economy-v1';
import { BuildStrategyGoalV1, BuildStrategySpecV1, phaseOrderBuildStrategyV1 } from './build-strategy-v1';

export interface BuildStrategyFeasibilityV1Input {
  strategy: BuildStrategySpecV1;
  itemGraph: RecommendationItemGraph;
  slotRules: AdaptiveSlotRulesV1;
  walletSouls?: number;
  maxActionsPerGoal?: number;
}

export interface BuildStrategyFeasibilityV1Result {
  feasible: boolean;
  actionIds: readonly string[];
  finalItemIds: readonly number[];
  failedGoalId?: string;
  failedBranchSelection?: Readonly<Record<string, string>>;
  validatedBranchPaths?: number;
  reasonCodes: readonly string[];
}

interface SearchState {
  decision: RecommendationDecisionState;
  actionIds: readonly string[];
}

interface PathValidationResult {
  feasible: boolean;
  actionIds: readonly string[];
  finalItemIds: readonly number[];
  failedGoalId?: string;
  reasonCodes: readonly string[];
}

@Injectable()
export class BuildStrategyFeasibilityV1Service {
  validate(input: BuildStrategyFeasibilityV1Input): BuildStrategyFeasibilityV1Result {
    if (input.strategy.branchGroups.some((group) => group.minSelect !== 1 || group.maxSelect !== 1)) {
      return {
        feasible: false,
        actionIds: [],
        finalItemIds: [],
        validatedBranchPaths: 0,
        reasonCodes: ['UNSUPPORTED_MULTI_SELECT_BRANCH', 'UNSUPPORTED_MULTI_SELECT_BRANCH_V1'],
      };
    }

    const branchPaths = enumerateBranchSelections(input.strategy);
    if (branchPaths.length > 64) {
      return {
        feasible: false,
        actionIds: [],
        finalItemIds: [],
        validatedBranchPaths: 0,
        reasonCodes: ['BRANCH_PATH_EXPLOSION'],
      };
    }

    let representative: PathValidationResult | undefined;
    let validatedBranchPaths = 0;
    for (const selectedBranches of branchPaths) {
      const path = validatePath(input, selectedBranches);
      representative ??= path;
      if (!path.feasible) {
        return {
          ...path,
          failedBranchSelection: { ...selectedBranches },
          validatedBranchPaths,
          reasonCodes: unique([
            ...path.reasonCodes,
            ...(input.strategy.branchGroups.length > 0
              ? ['BRANCH_PATH_UNREACHABLE', 'BRANCH_OPTION_UNREACHABLE', branchPathCode(selectedBranches)]
              : []),
          ]),
        };
      }
      validatedBranchPaths += 1;
    }

    const base = representative ?? {
      feasible: true,
      actionIds: [],
      finalItemIds: [],
      reasonCodes: ['ALL_MANDATORY_GOALS_REACHABLE'],
    };
    return {
      ...base,
      validatedBranchPaths,
      reasonCodes: unique([
        ...base.reasonCodes,
        ...(input.strategy.branchGroups.length > 0 ? ['ALL_BRANCH_PATHS_REACHABLE'] : []),
      ]),
    };
  }
}

function validatePath(
  input: BuildStrategyFeasibilityV1Input,
  selectedBranches: Readonly<Record<string, string>>,
): PathValidationResult {
  const goals = orderedRequiredGoals(input.strategy, selectedBranches);
  let searchState: SearchState = {
    decision: createInitialDecision(input),
    actionIds: [],
  };
  const completed: BuildStrategyGoalV1[] = [];

  for (const goal of goals) {
    if (goalSatisfied(goal, searchState.decision, input.itemGraph)) {
      completed.push(goal);
      continue;
    }
    const realized = realizeGoal(searchState, goal, completed, input);
    if (!realized) {
      return {
        feasible: false,
        actionIds: searchState.actionIds,
        finalItemIds: heldIds(searchState.decision),
        failedGoalId: goal.goalId,
        reasonCodes: ['MANDATORY_GOAL_UNREACHABLE', `GOAL:${goal.goalId}`],
      };
    }
    searchState = realized;
    completed.push(goal);
  }

  return {
    feasible: true,
    actionIds: searchState.actionIds,
    finalItemIds: heldIds(searchState.decision),
    reasonCodes: ['ALL_MANDATORY_GOALS_REACHABLE'],
  };
}

function createInitialDecision(input: BuildStrategyFeasibilityV1Input): RecommendationDecisionState {
  return {
    decisionId: `strategy-feasibility:${input.strategy.strategyId}`,
    matchId: 'offline-strategy-validation',
    playerSlot: 0,
    gameTimeSec: 0,
    rulesetId: input.strategy.rulesetId,
    heroId: input.strategy.heroId,
    inventory: {
      initializedFromSnapshot: true,
      heldByItemId: buildInventoryInstancesForRecommendation([], input.itemGraph),
      lifecycleCountByItemId: new Map(),
      nextInstanceSequence: 1,
    },
    economy: {
      spendableSouls: observedFact(input.walletSouls ?? 1_000_000, 'offline-strategy-feasibility'),
      shopOpportunity: observedFact('AVAILABLE', 'offline-strategy-feasibility'),
    },
  };
}

function realizeGoal(
  initial: SearchState,
  goal: BuildStrategyGoalV1,
  completedGoals: readonly BuildStrategyGoalV1[],
  input: BuildStrategyFeasibilityV1Input,
): SearchState | undefined {
  const maxDepth = Math.max(1, input.maxActionsPerGoal ?? 5);
  let frontier: SearchState[] = [initial];
  const visited = new Set<string>([stateKey(initial.decision)]);
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next: SearchState[] = [];
    for (const current of frontier) {
      const itemIds = heldIds(current.decision);
      const slots = deriveAdaptiveSlotStateV1(
        itemIds,
        input.itemGraph,
        input.slotRules,
        { unlockedFlexSlots: input.slotRules.maxFlexSlots, evidence: 'RECONSTRUCTED' },
      );
      const rules = candidateGeneratorRulesFromSlotStateV1(slots, {
        allowSellOnlyActions: true,
        generateTargetedWaitActions: false,
      });
      const relevantItems = targetSupportClosure(goal, input.itemGraph);
      const candidates = generateRecommendationCandidates({ state: current.decision, itemGraph: input.itemGraph, rules })
        .filter((candidate) => candidate.feasible && candidate.recommendationEligible)
        .filter((candidate) => candidate.action.type !== 'WAIT_SAVE')
        .filter((candidate) => candidateRelevantToGoal(candidate, relevantItems))
        .filter((candidate) => preservesCompletedGoals(candidate, current.decision, completedGoals, input.itemGraph));

      for (const candidate of candidates) {
        const projected = projectRecommendationCandidateState(current.decision, candidate, input.itemGraph);
        const candidateState: SearchState = {
          decision: projected,
          actionIds: [...current.actionIds, candidate.actionId],
        };
        if (goalSatisfied(goal, projected, input.itemGraph)) return candidateState;
        const key = stateKey(projected);
        if (visited.has(key)) continue;
        visited.add(key);
        next.push(candidateState);
      }
    }
    frontier = next.sort((a, b) => a.actionIds.join('|').localeCompare(b.actionIds.join('|'))).slice(0, 64);
    if (frontier.length === 0) break;
  }
  return undefined;
}

function preservesCompletedGoals(
  candidate: RecommendationCandidate,
  current: RecommendationDecisionState,
  completedGoals: readonly BuildStrategyGoalV1[],
  graph: RecommendationItemGraph,
): boolean {
  const projectedIds = candidate.resultingItemIds;
  return completedGoals.every((goal) => {
    if (!goalSatisfied(goal, current, graph)) return true;
    const satisfied = goal.targetItemIds.filter((itemId) => graph.isTargetSatisfied(itemId, projectedIds)).length;
    return satisfied >= goal.minSelect;
  });
}

function targetSupportClosure(goal: BuildStrategyGoalV1, graph: RecommendationItemGraph): ReadonlySet<number> {
  const values = new Set<number>();
  for (const itemId of goal.targetItemIds) {
    values.add(itemId);
    for (const componentId of graph.getTransitiveComponentIds(itemId)) values.add(componentId);
  }
  return values;
}

function candidateRelevantToGoal(candidate: RecommendationCandidate, relevantItems: ReadonlySet<number>): boolean {
  const action = candidate.action;
  if (action.type === 'BUY_ITEM' || action.type === 'UPGRADE_ITEM') return relevantItems.has(action.itemId);
  if (action.type === 'REPLACE_ITEM') return relevantItems.has(action.buyItemId);
  return action.type === 'SELL_ITEM';
}

function goalSatisfied(
  goal: BuildStrategyGoalV1,
  state: RecommendationDecisionState,
  graph: RecommendationItemGraph,
): boolean {
  const owned = state.inventory.heldByItemId.keys();
  return goal.targetItemIds.filter((itemId) => graph.isTargetSatisfied(itemId, owned)).length >= goal.minSelect;
}

function orderedRequiredGoals(
  strategy: BuildStrategySpecV1,
  selectedBranches: Readonly<Record<string, string>>,
): BuildStrategyGoalV1[] {
  const branchGoalIds = new Set(strategy.branchGroups.flatMap((group) => group.optionGoalIds));
  const selectedGoalIds = new Set(Object.values(selectedBranches));
  const required = strategy.goals.filter((goal) =>
    goal.hard && (!branchGoalIds.has(goal.goalId) || selectedGoalIds.has(goal.goalId)),
  );
  const declarationOrder = new Map(strategy.goals.map((goal, index) => [goal.goalId, index]));
  return topologicalOrder(required, strategy).sort((a, b) =>
    phaseOrderBuildStrategyV1(a.phase) - phaseOrderBuildStrategyV1(b.phase) ||
    (declarationOrder.get(a.goalId) ?? 0) - (declarationOrder.get(b.goalId) ?? 0),
  );
}

function topologicalOrder(goals: readonly BuildStrategyGoalV1[], strategy: BuildStrategySpecV1): BuildStrategyGoalV1[] {
  const included = new Set(goals.map((goal) => goal.goalId));
  const result: BuildStrategyGoalV1[] = [];
  const remaining = new Set(included);
  while (remaining.size > 0) {
    const ready = strategy.goals.filter((goal) =>
      remaining.has(goal.goalId) && goal.prerequisiteGoalIds.every((prerequisite) => !included.has(prerequisite) || !remaining.has(prerequisite)),
    );
    if (ready.length === 0) return goals as BuildStrategyGoalV1[];
    for (const goal of ready) {
      remaining.delete(goal.goalId);
      result.push(goal);
    }
  }
  return result;
}

function enumerateBranchSelections(strategy: BuildStrategySpecV1): Readonly<Record<string, string>>[] {
  let paths: Record<string, string>[] = [{}];
  for (const group of [...strategy.branchGroups].sort((a, b) => a.branchGroupId.localeCompare(b.branchGroupId))) {
    const options = [...new Set(group.optionGoalIds)].sort();
    const next: Record<string, string>[] = [];
    for (const path of paths) {
      for (const option of options) {
        next.push({ ...path, [group.branchGroupId]: option });
      }
    }
    paths = next;
    if (paths.length > 64) return paths;
  }
  return paths.length > 0 ? paths : [{}];
}

function branchPathCode(selected: Readonly<Record<string, string>>): string {
  const value = Object.entries(selected)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([groupId, goalId]) => `${groupId}=${goalId}`)
    .join(',');
  return `BRANCH_PATH:${value || 'none'}`;
}

function heldIds(state: RecommendationDecisionState): number[] {
  return [...state.inventory.heldByItemId.keys()].sort((a, b) => a - b);
}

function stateKey(state: RecommendationDecisionState): string {
  return JSON.stringify([heldIds(state), state.economy.spendableSouls.value ?? 'UNKNOWN']);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
