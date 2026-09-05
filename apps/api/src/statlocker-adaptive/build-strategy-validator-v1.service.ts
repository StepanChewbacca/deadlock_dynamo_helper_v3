import { Injectable } from '@nestjs/common';
import { RecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { BuildStrategySpecV1 } from './build-strategy-v1';

export type BuildStrategyValidationErrorCodeV1 =
  | 'SCHEMA_VERSION_UNSUPPORTED'
  | 'STRATEGY_ID_EMPTY'
  | 'HERO_ID_INVALID'
  | 'RULESET_ID_EMPTY'
  | 'SUPPORT_OUT_OF_RANGE'
  | 'STABILITY_OUT_OF_RANGE'
  | 'DUPLICATE_GOAL_ID'
  | 'UNKNOWN_PREREQUISITE_GOAL'
  | 'PREREQUISITE_CYCLE'
  | 'INVALID_SELECTION_BOUNDS'
  | 'UNKNOWN_ITEM'
  | 'ITEM_UNAVAILABLE_IN_RULESET'
  | 'DUPLICATE_BRANCH_GROUP_ID'
  | 'BRANCH_UNKNOWN_GOAL'
  | 'BRANCH_SELECTION_BOUNDS_INVALID'
  | 'DUPLICATE_SITUATIONAL_WINDOW_ID'
  | 'SITUATIONAL_WINDOW_BOUNDS_INVALID'
  | 'TERMINAL_UNKNOWN_GOAL'
  | 'TERMINAL_GOAL_NOT_HARD'
  | 'INVESTMENT_OBJECTIVE_INVALID'
  | 'SLOT_POLICY_INVALID';

export interface BuildStrategyValidationErrorV1 {
  code: BuildStrategyValidationErrorCodeV1;
  message: string;
  goalId?: string;
  branchGroupId?: string;
  windowId?: string;
  itemId?: number;
}

export interface BuildStrategyValidationResultV1 {
  valid: boolean;
  errors: readonly BuildStrategyValidationErrorV1[];
}

@Injectable()
export class BuildStrategyValidatorV1Service {
  validate(strategy: BuildStrategySpecV1, graph: RecommendationItemGraph): BuildStrategyValidationResultV1 {
    const errors: BuildStrategyValidationErrorV1[] = [];

    if (strategy.schemaVersion !== 1) {
      errors.push({ code: 'SCHEMA_VERSION_UNSUPPORTED', message: `Unsupported schemaVersion ${strategy.schemaVersion}` });
    }
    if (strategy.strategyId.trim() === '') {
      errors.push({ code: 'STRATEGY_ID_EMPTY', message: 'strategyId must be non-empty' });
    }
    if (!Number.isInteger(strategy.heroId) || strategy.heroId <= 0) {
      errors.push({ code: 'HERO_ID_INVALID', message: 'heroId must be a positive integer' });
    }
    if (strategy.rulesetId.trim() === '') {
      errors.push({ code: 'RULESET_ID_EMPTY', message: 'rulesetId must be non-empty' });
    }
    if (!inProbabilityRange(strategy.support)) {
      errors.push({ code: 'SUPPORT_OUT_OF_RANGE', message: 'support must be in [0, 1]' });
    }
    if (!inProbabilityRange(strategy.stability)) {
      errors.push({ code: 'STABILITY_OUT_OF_RANGE', message: 'stability must be in [0, 1]' });
    }

    const goalIds = new Set<string>();
    for (const goal of strategy.goals) {
      if (goalIds.has(goal.goalId)) {
        errors.push({ code: 'DUPLICATE_GOAL_ID', goalId: goal.goalId, message: `Duplicate goal ${goal.goalId}` });
      }
      goalIds.add(goal.goalId);
      if (!Number.isInteger(goal.minSelect) || !Number.isInteger(goal.maxSelect) ||
        goal.minSelect < 0 || goal.maxSelect < 1 || goal.minSelect > goal.maxSelect ||
        goal.maxSelect > goal.targetItemIds.length) {
        errors.push({
          code: 'INVALID_SELECTION_BOUNDS',
          goalId: goal.goalId,
          message: `Invalid selection bounds ${goal.minSelect}/${goal.maxSelect}`,
        });
      }
      for (const itemId of goal.targetItemIds) {
        const item = graph.getItem(itemId);
        if (!item) {
          errors.push({ code: 'UNKNOWN_ITEM', goalId: goal.goalId, itemId, message: `Unknown item ${itemId}` });
          continue;
        }
        if (!item.availableRulesetIds.includes(strategy.rulesetId)) {
          errors.push({
            code: 'ITEM_UNAVAILABLE_IN_RULESET',
            goalId: goal.goalId,
            itemId,
            message: `Item ${itemId} is unavailable in ruleset ${strategy.rulesetId}`,
          });
        }
      }
    }

    for (const goal of strategy.goals) {
      for (const prerequisiteId of goal.prerequisiteGoalIds) {
        if (!goalIds.has(prerequisiteId)) {
          errors.push({
            code: 'UNKNOWN_PREREQUISITE_GOAL',
            goalId: goal.goalId,
            message: `Goal ${goal.goalId} references unknown prerequisite ${prerequisiteId}`,
          });
        }
      }
    }
    if (hasGoalCycle(strategy)) {
      errors.push({ code: 'PREREQUISITE_CYCLE', message: 'Goal prerequisite graph contains a cycle' });
    }

    const branchIds = new Set<string>();
    for (const branch of strategy.branchGroups) {
      if (branchIds.has(branch.branchGroupId)) {
        errors.push({
          code: 'DUPLICATE_BRANCH_GROUP_ID',
          branchGroupId: branch.branchGroupId,
          message: `Duplicate branch group ${branch.branchGroupId}`,
        });
      }
      branchIds.add(branch.branchGroupId);
      for (const goalId of branch.optionGoalIds) {
        if (!goalIds.has(goalId)) {
          errors.push({
            code: 'BRANCH_UNKNOWN_GOAL',
            branchGroupId: branch.branchGroupId,
            goalId,
            message: `Branch group ${branch.branchGroupId} references unknown goal ${goalId}`,
          });
        }
      }
      if (!Number.isInteger(branch.minSelect) || !Number.isInteger(branch.maxSelect) ||
        branch.minSelect < 1 || branch.maxSelect < branch.minSelect || branch.maxSelect > branch.optionGoalIds.length) {
        errors.push({
          code: 'BRANCH_SELECTION_BOUNDS_INVALID',
          branchGroupId: branch.branchGroupId,
          message: `Invalid branch bounds ${branch.minSelect}/${branch.maxSelect}`,
        });
      }
    }

    const windowIds = new Set<string>();
    for (const window of strategy.situationalWindows) {
      if (windowIds.has(window.windowId)) {
        errors.push({
          code: 'DUPLICATE_SITUATIONAL_WINDOW_ID',
          windowId: window.windowId,
          message: `Duplicate situational window ${window.windowId}`,
        });
      }
      windowIds.add(window.windowId);
      if (!Number.isInteger(window.maxSlots) || window.maxSlots < 0 ||
        !Number.isFinite(window.maxSouls) || window.maxSouls < 0 ||
        !Number.isFinite(window.maxCoreDelaySouls) || window.maxCoreDelaySouls < 0) {
        errors.push({
          code: 'SITUATIONAL_WINDOW_BOUNDS_INVALID',
          windowId: window.windowId,
          message: `Invalid bounds for situational window ${window.windowId}`,
        });
      }
      for (const goalId of [...window.afterGoalIds, ...window.beforeGoalIds]) {
        if (!goalIds.has(goalId)) {
          errors.push({
            code: 'BRANCH_UNKNOWN_GOAL',
            windowId: window.windowId,
            goalId,
            message: `Situational window ${window.windowId} references unknown goal ${goalId}`,
          });
        }
      }
    }

    const goalById = new Map(strategy.goals.map((goal) => [goal.goalId, goal]));
    for (const goalId of strategy.terminalPolicy.requiredGoalIds) {
      const goal = goalById.get(goalId);
      if (!goal) {
        errors.push({ code: 'TERMINAL_UNKNOWN_GOAL', goalId, message: `Terminal policy references unknown goal ${goalId}` });
      } else if (!goal.hard) {
        errors.push({ code: 'TERMINAL_GOAL_NOT_HARD', goalId, message: `Terminal required goal ${goalId} must be hard` });
      }
    }

    for (const objective of strategy.investmentPolicy.objectives) {
      const target = objective.targetBreakpoint ?? objective.minimumValue;
      if (target !== undefined && (!Number.isFinite(target) || target <= 0)) {
        errors.push({
          code: 'INVESTMENT_OBJECTIVE_INVALID',
          message: `Investment objective ${objective.objectiveId} has invalid target`,
        });
      }
      for (const goalId of [...objective.activateAfterGoalIds, ...objective.deactivateAfterGoalIds]) {
        if (!goalIds.has(goalId)) {
          errors.push({
            code: 'INVESTMENT_OBJECTIVE_INVALID',
            goalId,
            message: `Investment objective ${objective.objectiveId} references unknown goal ${goalId}`,
          });
        }
      }
    }

    if (!Number.isInteger(strategy.slotPolicy.reservedSituationalSlots) || strategy.slotPolicy.reservedSituationalSlots < 0 ||
      !Number.isInteger(strategy.slotPolicy.maxTemporarySlots) || strategy.slotPolicy.maxTemporarySlots < 0) {
      errors.push({ code: 'SLOT_POLICY_INVALID', message: 'Slot policy values must be non-negative integers' });
    }

    const stableErrors = errors.sort((a, b) =>
      a.code.localeCompare(b.code) ||
      (a.goalId ?? '').localeCompare(b.goalId ?? '') ||
      (a.branchGroupId ?? '').localeCompare(b.branchGroupId ?? '') ||
      (a.windowId ?? '').localeCompare(b.windowId ?? '') ||
      (a.itemId ?? 0) - (b.itemId ?? 0),
    );
    return { valid: stableErrors.length === 0, errors: stableErrors };
  }
}

function inProbabilityRange(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function hasGoalCycle(strategy: BuildStrategySpecV1): boolean {
  const dependencies = new Map(strategy.goals.map((goal) => [goal.goalId, goal.prerequisiteGoalIds]));
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (goalId: string): boolean => {
    if (visiting.has(goalId)) return true;
    if (visited.has(goalId)) return false;
    visiting.add(goalId);
    for (const dependency of dependencies.get(goalId) ?? []) {
      if (!dependencies.has(dependency)) continue;
      if (visit(dependency)) return true;
    }
    visiting.delete(goalId);
    visited.add(goalId);
    return false;
  };

  return strategy.goals.some((goal) => visit(goal.goalId));
}
