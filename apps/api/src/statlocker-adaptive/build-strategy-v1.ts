import { InventorySlotType } from '@deadlock-live-probe/build-domain';

export type BuildStrategyPhaseV1 = 'EARLY' | 'MID' | 'LATE';

export type BuildGoalTypeV1 =
  | 'CORE'
  | 'POWER_SPIKE'
  | 'UPGRADE'
  | 'BRANCH'
  | 'INVESTMENT'
  | 'SITUATIONAL_RESERVATION'
  | 'TERMINAL';

export type BuildItemLifecycleV1 =
  | 'PERMANENT_CORE'
  | 'UPGRADE_COMPONENT'
  | 'TEMPORARY_EARLY'
  | 'SITUATIONAL'
  | 'REPLACEMENT_TARGET';

export type BuildGoalStateV1 =
  | 'LOCKED'
  | 'READY'
  | 'ACTIVE'
  | 'SATISFIED'
  | 'SKIPPED'
  | 'WAIVED'
  | 'BLOCKED';

export type BuildStatusV1 =
  | 'IN_PROGRESS'
  | 'WAITING'
  | 'COMPLETE'
  | 'REPLAN_REQUIRED'
  | 'OUT_OF_DISTRIBUTION';

export type BuildStrategyCommitmentV1 = 'PROVISIONAL' | 'COMMITTED' | 'DIVERGED' | 'OOD';

export type BuildSituationalPurposeV1 =
  | 'ANTI_CC'
  | 'ANTI_BURST'
  | 'ANTI_HEAL'
  | 'ANTI_BULLET'
  | 'ANTI_SPIRIT'
  | 'SURVIVABILITY'
  | 'CATCH'
  | 'DAMAGE'
  | 'COUNTER_ENEMY_HEROES'
  | 'UTILITY';

export interface BuildStrategyGoalV1 {
  goalId: string;
  type: BuildGoalTypeV1;
  phase: BuildStrategyPhaseV1;
  targetItemIds: readonly number[];
  minSelect: number;
  maxSelect: number;
  prerequisiteGoalIds: readonly string[];
  hard: boolean;
  lifecycleByItemId: Readonly<Record<number, BuildItemLifecycleV1>>;
  rationaleCodes: readonly string[];
}

export interface BuildStrategyBranchGroupV1 {
  branchGroupId: string;
  optionGoalIds: readonly string[];
  minSelect: number;
  maxSelect: number;
}

export interface BuildSituationalWindowV1 {
  windowId: string;
  afterGoalIds: readonly string[];
  beforeGoalIds: readonly string[];
  maxSlots: number;
  maxSouls: number;
  maxCoreDelaySouls: number;
  allowedPurposes: readonly BuildSituationalPurposeV1[];
  /**
   * Explicit strategy-owned candidate set. The planner never infers an item purpose from its name,
   * score or category. Omitted mappings keep the window reserved but not actionable.
   */
  candidateItemIdsByPurpose?: Readonly<Partial<Record<BuildSituationalPurposeV1, readonly number[]>>>;
}

export interface BuildInvestmentObjectiveV1 {
  objectiveId: string;
  type: InventorySlotType;
  hard: boolean;
  targetBreakpoint?: number;
  minimumValue?: number;
  activateAfterGoalIds: readonly string[];
  deactivateAfterGoalIds: readonly string[];
  reasonCodes: readonly string[];
}

export interface BuildInvestmentPolicyV1 {
  objectives: readonly BuildInvestmentObjectiveV1[];
  preferredWeights: Readonly<Record<InventorySlotType, number>>;
}

export interface BuildSlotPolicyV1 {
  reservedSituationalSlots: number;
  maxTemporarySlots: number;
}

export interface BuildTerminalPolicyV1 {
  requiredGoalIds: readonly string[];
  allowWaiveSoftGoals: boolean;
}

export interface BuildStrategySpecV1 {
  schemaVersion: 1;
  strategyId: string;
  heroId: number;
  rulesetId: string;
  sourcePatchId: string;
  support: number;
  stability: number;
  representativeTraceId: string;
  goals: readonly BuildStrategyGoalV1[];
  branchGroups: readonly BuildStrategyBranchGroupV1[];
  situationalWindows: readonly BuildSituationalWindowV1[];
  investmentPolicy: BuildInvestmentPolicyV1;
  slotPolicy: BuildSlotPolicyV1;
  terminalPolicy: BuildTerminalPolicyV1;
}

export interface BuildStrategyPosteriorV1 {
  strategyId: string;
  probability: number;
  conformance: number;
  evidenceCount: number;
}

export interface BuildStrategySelectionV1 {
  selectedStrategyId?: string;
  commitment: BuildStrategyCommitmentV1;
  posteriors: readonly BuildStrategyPosteriorV1[];
  reasonCodes: readonly string[];
}

export interface BuildSituationalDecisionV1 {
  windowId: string;
  purpose: BuildSituationalPurposeV1;
  targetItemId: number;
  enemyHeroIds: readonly number[];
  enemyItemIds: readonly number[];
  statisticalSupport: number;
  confidence: number;
  slotImpact: number;
  investmentImpact: number;
  coreInterruptionSouls: number;
  reasonCodes: readonly string[];
}

export interface BuildContractV1 {
  strategyId: string;
  status: BuildStatusV1;
  commitment: BuildStrategyCommitmentV1;
  currentGoalId?: string;
  goalStates: Readonly<Record<string, BuildGoalStateV1>>;
  selectedBranches: Readonly<Record<string, string>>;
  committedBranches: Readonly<Record<string, string>>;
  temporaryItemIds: readonly number[];
  reservedSituationalWindowIds: readonly string[];
  activeSituationalDecision?: BuildSituationalDecisionV1;
  remainingHardGoalIds: readonly string[];
  completionReasonCodes: readonly string[];
}

export interface BuildSlotPlanTransitionV1 {
  targetGoalId: string;
  targetItemId?: number;
  requirement: 'NONE' | 'UPGRADE' | 'SELL_TEMPORARY' | 'REPLACE' | 'FLEX_UNLOCK' | 'BLOCKED';
  sourceItemId?: number;
  requiredUnlockedFlexSlots?: number;
  reasonCodes: readonly string[];
}

export interface BuildSlotPlanV1 {
  currentUsedSlots: number;
  currentFlexUsed: number;
  unlockedFlexSlots?: number;
  reservedSituationalSlots: number;
  futureTransitions: readonly BuildSlotPlanTransitionV1[];
  feasible: boolean;
  reasonCodes: readonly string[];
}

export interface BuildInvestmentPlanObjectiveStateV1 {
  objectiveId: string;
  type: InventorySlotType;
  state: 'LOCKED' | 'ACTIVE' | 'SATISFIED' | 'WAIVED';
  currentValue: number;
  targetValue?: number;
  distance?: number;
  reasonCodes: readonly string[];
}

export interface BuildInvestmentPlanV1 {
  objectives: readonly BuildInvestmentPlanObjectiveStateV1[];
  activeObjectiveIds: readonly string[];
}

export interface AdaptiveStrategyPlanV1 {
  strategyId: string;
  buildStatus: BuildStatusV1;
  progress: {
    satisfiedHardGoals: number;
    totalHardGoals: number;
  };
  currentGoal?: {
    goalId: string;
    type: BuildGoalTypeV1;
    reasonCodes: readonly string[];
  };
  remainingGoalIds: readonly string[];
  remainingHardInvestmentObjectiveIds: readonly string[];
  slotPlan: BuildSlotPlanV1;
  investmentPlan: BuildInvestmentPlanV1;
  situationalDecision?: BuildSituationalDecisionV1;
}

export function phaseOrderBuildStrategyV1(phase: BuildStrategyPhaseV1): number {
  if (phase === 'EARLY') return 0;
  if (phase === 'MID') return 1;
  return 2;
}

export function buildStrategyGoalMapV1(strategy: BuildStrategySpecV1): ReadonlyMap<string, BuildStrategyGoalV1> {
  return new Map(strategy.goals.map((goal) => [goal.goalId, goal]));
}

export function hardStrategyGoalIdsV1(strategy: BuildStrategySpecV1): readonly string[] {
  return strategy.goals.filter((goal) => goal.hard).map((goal) => goal.goalId);
}

export function targetItemIdsForGoalV1(goal: BuildStrategyGoalV1): readonly number[] {
  return [...new Set(goal.targetItemIds)].sort((a, b) => a - b);
}
