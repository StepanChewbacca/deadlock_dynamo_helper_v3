import { Injectable } from '@nestjs/common';
import {
  RecommendationCandidate,
  RecommendationDecisionState,
  RecommendationItemGraph,
  generateRecommendationCandidates,
  projectRecommendationCandidateState,
} from '@deadlock-live-probe/build-domain';
import {
  AdaptiveActionV1,
  AdaptiveBuildPlanChangeV1,
  AdaptivePlannedItemV1,
  AdaptiveScoredActionV1,
  AdaptiveScoreComponentV1,
} from '@deadlock-live-probe/shared';
import { AdaptiveDecisionStateV1 } from './adaptive-decision-state-v1.service';
import {
  AdaptiveInvestmentStateV1,
  AdaptiveSlotStateV1,
  candidateGeneratorRulesFromSlotStateV1,
  deriveAdaptiveInvestmentStateV1,
  deriveAdaptiveSlotStateV1,
  slotRulesFromEconomyRulesV1,
} from './adaptive-economy-v1';
import {
  AdaptiveEvidenceScorerV1Service,
  AdaptiveItemScoreContextV1,
  AdaptiveItemScoreV1,
} from './adaptive-evidence-scorer-v1.service';
import { classifyAdaptiveGameStateV1 } from './adaptive-game-state';
import { BuildContractV1Service } from './build-contract-v1.service';
import { BuildInvestmentPolicyV1Service } from './build-investment-policy-v1.service';
import { BuildSituationalResolverV1Service } from './build-situational-resolver-v1.service';
import { BuildSlotPlannerV1Service } from './build-slot-planner-v1.service';
import {
  AdaptiveStrategyPlanV1,
  BuildContractV1,
  BuildInvestmentPlanV1,
  BuildSlotPlanV1,
  BuildStrategyGoalV1,
  BuildStrategySpecV1,
} from './build-strategy-v1';
import { BuildStrategySelectionV1, BuildStrategySelectorV1Service } from './build-strategy-selector-v1.service';
import { BuildStrategySessionV1, BuildStrategySessionV1Service } from './build-strategy-session-v1.service';
import { StatlockerEvidenceBundleV1 } from './statlocker-evidence.service';

export interface StrategyFirstBuildPlannerV1Input {
  decision: AdaptiveDecisionStateV1;
  evidence: StatlockerEvidenceBundleV1;
  strategies: readonly BuildStrategySpecV1[];
  purchaseHistory?: readonly { itemId: number; gameTimeSec: number }[];
  previousSession?: BuildStrategySessionV1;
  previousContract?: BuildContractV1;
  planningDepth?: number;
  beamWidth?: number;
}

export interface StrategyFirstBuildPlannerV1Result {
  gameState: 'AHEAD' | 'EVEN' | 'BEHIND' | 'UNKNOWN';
  strategy: BuildStrategySpecV1;
  strategySelection: BuildStrategySelectionV1;
  strategySession: BuildStrategySessionV1;
  contract: BuildContractV1;
  strategyPlan: AdaptiveStrategyPlanV1;
  nextAction: AdaptiveActionV1;
  recommendedBuild: readonly AdaptivePlannedItemV1[];
  changes: readonly AdaptiveBuildPlanChangeV1[];
  rankedImmediateCandidates: readonly AdaptiveScoredActionV1[];
  totalScore: number;
  confidence: number;
  plannerVersion: 'strategy-first-build-planner-v1';
}

interface StrategyNodeV1 {
  decisionState: RecommendationDecisionState;
  slots: AdaptiveSlotStateV1;
  investment: AdaptiveInvestmentStateV1;
  contract: BuildContractV1;
  actions: readonly ScoredStrategyCandidateV1[];
  utility: number;
}

interface ScoredStrategyCandidateV1 {
  candidate: RecommendationCandidate;
  score: number;
  confidence: number;
  components: readonly AdaptiveScoreComponentV1[];
  reasonCodes: readonly string[];
}

@Injectable()
export class StrategyFirstBuildPlannerV1Service {
  readonly version = 'strategy-first-build-planner-v1' as const;
  private readonly selector = new BuildStrategySelectorV1Service();
  private readonly sessions = new BuildStrategySessionV1Service();
  private readonly contracts = new BuildContractV1Service();
  private readonly slots = new BuildSlotPlannerV1Service();
  private readonly investments = new BuildInvestmentPolicyV1Service();
  private readonly situational = new BuildSituationalResolverV1Service();

  constructor(private readonly scorer: AdaptiveEvidenceScorerV1Service) {}

  plan(input: StrategyFirstBuildPlannerV1Input): StrategyFirstBuildPlannerV1Result {
    if (input.strategies.length === 0) throw new Error('Strategy-first planner requires at least one strategy');
    const ownedItemIds = heldIds(input.decision.state);
    const selection = this.selector.select({
      strategies: input.strategies,
      itemGraph: input.decision.itemGraph,
      ownedItemIds,
      purchaseHistory: input.purchaseHistory ?? ownedItemIds.map((itemId, index) => ({ itemId, gameTimeSec: index })),
      allyHeroIds: input.decision.allyHeroIds,
      enemyHeroIds: input.decision.enemyHeroIds,
    });
    const session = this.sessions.reconcile({
      previous: input.previousSession,
      selection,
      gameTimeSec: input.decision.state.gameTimeSec,
    });
    const strategy = input.strategies.find((candidate) => candidate.strategyId === session.strategyId)
      ?? input.strategies.find((candidate) => candidate.strategyId === selection.selectedStrategyId)
      ?? [...input.strategies].sort((a, b) => b.support - a.support || b.stability - a.stability || a.strategyId.localeCompare(b.strategyId))[0];
    const scorerContext = this.baseScorerContext(input, ownedItemIds, strategy.strategyId);
    const branchState = this.resolveBranches(strategy, input, scorerContext);
    const initialContract = this.contracts.resolve({
      strategy,
      itemGraph: input.decision.itemGraph,
      ownedItemIds,
      selectedBranches: branchState.selected,
      committedBranches: branchState.committed,
      commitment: session.commitment,
    });
    const initialNode: StrategyNodeV1 = {
      decisionState: input.decision.state,
      slots: input.decision.slots,
      investment: input.decision.investment,
      contract: initialContract,
      actions: [],
      utility: 0,
    };

    const immediate = this.evaluateNode(input, strategy, initialNode, branchState, scorerContext);
    const best = this.search(input, strategy, initialNode, branchState, scorerContext);
    const first = best.actions[0] ?? immediate[0];
    const nextAction = first
      ? adaptiveAction(first.candidate, first.reasonCodes)
      : fallbackAction(initialContract);
    const displayContract = this.contracts.resolve({
      strategy,
      itemGraph: input.decision.itemGraph,
      ownedItemIds,
      selectedBranches: branchState.selected,
      committedBranches: branchState.committed,
      commitment: session.commitment,
      immediateMode: nextAction.type === 'WAIT' || nextAction.type === 'HOLD' ? 'WAIT' : 'TRANSACTION',
    });
    const slotPlan = this.slots.plan({
      strategy,
      contract: displayContract,
      itemGraph: input.decision.itemGraph,
      ownedItemIds,
      slots: input.decision.slots,
    });
    const investmentPlan = this.investments.resolve({ strategy, contract: displayContract, investment: input.decision.investment });
    const strategyPlan = makeStrategyPlan(strategy, displayContract, slotPlan, investmentPlan);
    const recommendedBuild = this.buildRecommendedBuild(
      strategy,
      displayContract,
      input,
      scorerContext,
      nextAction,
      first?.candidate,
    );

    return {
      gameState: classifyAdaptiveGameStateV1(input.decision.ourTeamSouls, input.decision.enemyTeamSouls, 0.08),
      strategy,
      strategySelection: selection,
      strategySession: session,
      contract: displayContract,
      strategyPlan,
      nextAction,
      recommendedBuild,
      changes: [],
      rankedImmediateCandidates: immediate.map(toAdaptiveScoredAction),
      totalScore: best.utility,
      confidence: first?.confidence ?? 0,
      plannerVersion: this.version,
    };
  }

  private resolveBranches(
    strategy: BuildStrategySpecV1,
    input: StrategyFirstBuildPlannerV1Input,
    scorerContext: AdaptiveItemScoreContextV1,
  ): { selected: Record<string, string>; committed: Record<string, string> } {
    const selected: Record<string, string> = { ...(input.previousContract?.selectedBranches ?? {}) };
    const committed: Record<string, string> = { ...(input.previousContract?.committedBranches ?? {}) };
    const owned = heldIds(input.decision.state);
    const goalById = new Map(strategy.goals.map((goal) => [goal.goalId, goal]));

    for (const branch of strategy.branchGroups) {
      if (committed[branch.branchGroupId]) {
        selected[branch.branchGroupId] = committed[branch.branchGroupId];
        continue;
      }
      const ownedOption = branch.optionGoalIds.find((goalId) => {
        const goal = goalById.get(goalId);
        return goal?.targetItemIds.some((itemId) => input.decision.itemGraph.isTargetSatisfied(itemId, owned));
      });
      if (ownedOption) {
        selected[branch.branchGroupId] = ownedOption;
        committed[branch.branchGroupId] = ownedOption;
        continue;
      }
      const best = branch.optionGoalIds
        .map((goalId) => ({ goalId, score: scoreGoal(goalById.get(goalId), this.scorer, scorerContext) }))
        .sort((a, b) => b.score - a.score || a.goalId.localeCompare(b.goalId))[0];
      if (best) selected[branch.branchGroupId] = best.goalId;
    }
    return { selected, committed };
  }

  private search(
    input: StrategyFirstBuildPlannerV1Input,
    strategy: BuildStrategySpecV1,
    initial: StrategyNodeV1,
    branches: { selected: Record<string, string>; committed: Record<string, string> },
    baseContext: AdaptiveItemScoreContextV1,
  ): StrategyNodeV1 {
    const depth = Math.max(1, Math.min(5, input.planningDepth ?? 3));
    const width = Math.max(1, Math.min(16, input.beamWidth ?? 8));
    let beam: StrategyNodeV1[] = [initial];
    let best = initial;
    for (let step = 0; step < depth; step += 1) {
      const next: StrategyNodeV1[] = [];
      for (const node of beam) {
        if (node.contract.status === 'COMPLETE' || node.contract.status === 'REPLAN_REQUIRED' || node.contract.status === 'OUT_OF_DISTRIBUTION') {
          if (node.utility > best.utility) best = node;
          continue;
        }
        const context: AdaptiveItemScoreContextV1 = {
          ...baseContext,
          ownedItemIds: heldIds(node.decisionState),
          plannedPrefixItemIds: node.actions.map((entry) => candidateTarget(entry.candidate)).filter((itemId): itemId is number => itemId !== undefined),
        };
        const candidates = this.evaluateNode(input, strategy, node, branches, context);
        for (const scored of candidates.slice(0, width)) {
          if (scored.candidate.action.type === 'WAIT_SAVE') {
            const waiting = { ...node, actions: [...node.actions, scored], utility: node.utility + scored.score * Math.pow(0.82, step) };
            if (waiting.utility > best.utility) best = waiting;
            continue;
          }
          const projectedDecision = projectRecommendationCandidateState(node.decisionState, scored.candidate, input.decision.itemGraph);
          const projectedItemIds = heldIds(projectedDecision);
          const projectedSlots = deriveAdaptiveSlotStateV1(
            projectedItemIds,
            input.decision.itemGraph,
            input.decision.economyRules
              ? slotRulesFromEconomyRulesV1(input.decision.economyRules)
              : {
                  baseSlots: node.slots.baseSlots,
                  baseSlotsByType: node.slots.baseSlotsByType,
                  maxFlexSlots: node.slots.maxFlexSlots,
                  maxActiveItems: node.slots.maxActiveItems,
                },
            { unlockedFlexSlots: node.slots.unlockedFlexSlots, evidence: node.slots.evidence },
          );
          const projectedInvestment = deriveAdaptiveInvestmentStateV1(projectedItemIds, input.decision.itemGraph, input.decision.economyRules);
          const projectedContract = this.contracts.resolve({
            strategy,
            itemGraph: input.decision.itemGraph,
            ownedItemIds: projectedItemIds,
            selectedBranches: branches.selected,
            committedBranches: branches.committed,
            commitment: node.contract.commitment,
          });
          const completionGain = resolvedHardCount(projectedContract) - resolvedHardCount(node.contract);
          const projected: StrategyNodeV1 = {
            decisionState: projectedDecision,
            slots: projectedSlots,
            investment: projectedInvestment,
            contract: projectedContract,
            actions: [...node.actions, scored],
            utility: node.utility + (scored.score + completionGain * 1.5) * Math.pow(0.82, step),
          };
          next.push(projected);
          if (projected.utility > best.utility || projectedContract.status === 'COMPLETE') best = projected;
        }
      }
      if (next.length === 0) break;
      beam = next.sort((a, b) => b.utility - a.utility || actionPathKey(a).localeCompare(actionPathKey(b))).slice(0, width);
    }
    return best.actions.length === 0 && beam[0]?.actions.length ? beam[0] : best;
  }

  private evaluateNode(
    input: StrategyFirstBuildPlannerV1Input,
    strategy: BuildStrategySpecV1,
    node: StrategyNodeV1,
    branches: { selected: Record<string, string>; committed: Record<string, string> },
    scorerContext: AdaptiveItemScoreContextV1,
  ): ScoredStrategyCandidateV1[] {
    const owned = heldIds(node.decisionState);
    const slotPlan = this.slots.plan({ strategy, contract: node.contract, itemGraph: input.decision.itemGraph, ownedItemIds: owned, slots: node.slots });
    const currentGoal = strategy.goals.find((goal) => goal.goalId === node.contract.currentGoalId);
    const rules = candidateGeneratorRulesFromSlotStateV1(node.slots, { allowSellOnlyActions: true, generateTargetedWaitActions: true });
    const all = generateRecommendationCandidates({ state: node.decisionState, itemGraph: input.decision.itemGraph, rules })
      .filter((candidate) => candidate.feasible && candidate.recommendationEligible);
    const relevant = all.filter((candidate) => this.candidateRelevant(candidate, currentGoal, slotPlan, input.decision.itemGraph));
    const transactions = relevant.filter((candidate) => candidate.action.type !== 'WAIT_SAVE');
    const candidates = transactions.length > 0
      ? relevant
      : relevant.length > 0
        ? relevant
        : all.filter((candidate) => candidate.action.type === 'WAIT_SAVE' && candidate.action.targetItemId === undefined);
    const beforeInvestmentPlan = this.investments.resolve({ strategy, contract: node.contract, investment: node.investment });

    return candidates.map((candidate) => {
      const targetItemId = candidateTarget(candidate);
      const itemScore = targetItemId === undefined ? undefined : safeScoreItem(this.scorer, targetItemId, scorerContext);
      const projectedDecision = projectRecommendationCandidateState(node.decisionState, candidate, input.decision.itemGraph);
      const projectedItemIds = heldIds(projectedDecision);
      const projectedContract = this.contracts.resolve({
        strategy,
        itemGraph: input.decision.itemGraph,
        ownedItemIds: projectedItemIds,
        selectedBranches: branches.selected,
        committedBranches: branches.committed,
        commitment: node.contract.commitment,
      });
      const projectedInvestment = deriveAdaptiveInvestmentStateV1(projectedItemIds, input.decision.itemGraph, input.decision.economyRules);
      const afterInvestmentPlan = this.investments.resolve({ strategy, contract: projectedContract, investment: projectedInvestment });
      const investmentUtility = this.investments.alignmentUtility(beforeInvestmentPlan, afterInvestmentPlan, strategy);
      const strategic = strategicCandidateUtility(candidate, currentGoal, node.contract, projectedContract, slotPlan, input.decision.itemGraph);
      const waitAdjustment = candidate.action.type === 'WAIT_SAVE' ? (transactions.length === 0 ? 0.12 : -0.25) : 0;
      const score = (itemScore?.score ?? 0) + strategic + investmentUtility * 0.45 + waitAdjustment;
      const reasonCodes = [
        ...(currentGoal ? [`STRATEGY_GOAL:${currentGoal.goalId}`, ...currentGoal.rationaleCodes] : []),
        ...candidate.recommendationSuppressionReasons,
        ...(strategic > 0 ? ['ADVANCES_SELECTED_STRATEGY'] : []),
        ...(investmentUtility > 0 ? ['ADVANCES_STRATEGIC_INVESTMENT'] : []),
      ];
      return {
        candidate,
        score,
        confidence: itemScore?.confidence ?? (candidate.action.type === 'WAIT_SAVE' ? 0.5 : 0.25),
        components: itemScore?.components ?? [],
        reasonCodes: [...new Set(reasonCodes)].sort(),
      };
    }).sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.candidate.actionId.localeCompare(b.candidate.actionId));
  }

  private candidateRelevant(
    candidate: RecommendationCandidate,
    currentGoal: BuildStrategyGoalV1 | undefined,
    slotPlan: BuildSlotPlanV1,
    graph: RecommendationItemGraph,
  ): boolean {
    if (!currentGoal) return candidate.action.type === 'WAIT_SAVE' && candidate.action.targetItemId === undefined;
    const relevant = new Set<number>();
    for (const target of currentGoal.targetItemIds) {
      relevant.add(target);
      for (const component of graph.getTransitiveComponentIds(target)) relevant.add(component);
    }
    const transition = slotPlan.futureTransitions.find((entry) => entry.targetGoalId === currentGoal.goalId);
    const action = candidate.action;
    if (action.type === 'WAIT_SAVE') return action.targetItemId === undefined || (action.targetItemId !== undefined && relevant.has(action.targetItemId));
    if (action.type === 'BUY_ITEM' || action.type === 'UPGRADE_ITEM') return relevant.has(action.itemId);
    if (action.type === 'REPLACE_ITEM') return relevant.has(action.buyItemId) && (!transition?.sourceItemId || transition.sourceItemId === action.sellItemId);
    if (action.type === 'SELL_ITEM') return transition?.requirement === 'SELL_TEMPORARY' && transition.sourceItemId === action.itemId;
    return false;
  }

  private buildRecommendedBuild(
    strategy: BuildStrategySpecV1,
    contract: BuildContractV1,
    input: StrategyFirstBuildPlannerV1Input,
    scorerContext: AdaptiveItemScoreContextV1,
    nextAction: AdaptiveActionV1,
    nextCandidate: RecommendationCandidate | undefined,
  ): readonly AdaptivePlannedItemV1[] {
    const owned = heldIds(input.decision.state);
    const rows: AdaptivePlannedItemV1[] = owned.map((itemId, index) => ({
      itemId,
      position: index + 1,
      status: 'OWNED',
      score: 0,
      confidence: 1,
      skeletonStrength: 0,
      contextualSupport: 1,
      reasonCodes: ['OWNED_ITEM', `STRATEGY:${strategy.strategyId}`],
    }));
    const seen = new Set(owned);
    const nextTransactionTarget = nextCandidate ? candidateTarget(nextCandidate) : undefined;
    if (nextTransactionTarget !== undefined && !seen.has(nextTransactionTarget) &&
      !input.decision.itemGraph.isTargetSatisfied(nextTransactionTarget, owned)) {
      const score = safeScoreItem(this.scorer, nextTransactionTarget, scorerContext);
      rows.push({
        itemId: nextTransactionTarget,
        position: rows.length + 1,
        status: nextAction.type === 'BUY' || nextAction.type === 'UPGRADE' || nextAction.type === 'REPLACE' ? 'NEXT' : 'PLANNED',
        score: score?.score ?? 0,
        confidence: score?.confidence ?? 0,
        skeletonStrength: 0,
        contextualSupport: score?.confidence ?? 0,
        reasonCodes: ['FIRST_LEGAL_STRATEGY_TRANSACTION', `STRATEGY:${strategy.strategyId}`],
      });
      seen.add(nextTransactionTarget);
    }

    for (const goal of strategy.goals) {
      const state = contract.goalStates[goal.goalId];
      if (state === 'SKIPPED' || state === 'WAIVED' || state === 'SATISFIED') continue;
      if (!goal.hard && contract.currentGoalId !== goal.goalId) continue;
      for (const itemId of goal.targetItemIds) {
        if (seen.has(itemId) || input.decision.itemGraph.isTargetSatisfied(itemId, owned)) continue;
        if (goal.type === 'BRANCH' && !Object.values(contract.selectedBranches).includes(goal.goalId)) continue;
        const score = safeScoreItem(this.scorer, itemId, scorerContext);
        rows.push({
          itemId,
          position: rows.length + 1,
          status: rows.every((entry) => entry.status !== 'NEXT') && nextAction.targetItemId === itemId ? 'NEXT' : 'PLANNED',
          score: score?.score ?? 0,
          confidence: score?.confidence ?? 0,
          skeletonStrength: 0,
          contextualSupport: score?.confidence ?? 0,
          reasonCodes: [`STRATEGY_GOAL:${goal.goalId}`, ...goal.rationaleCodes],
        });
        seen.add(itemId);
        if (goal.maxSelect === 1) break;
      }
    }
    return rows.map((row, index) => ({ ...row, position: index + 1 }));
  }

  private baseScorerContext(
    input: StrategyFirstBuildPlannerV1Input,
    ownedItemIds: readonly number[],
    strategyId: string,
  ): AdaptiveItemScoreContextV1 {
    const soulDelta = input.decision.ourTeamSouls === undefined || input.decision.enemyTeamSouls === undefined
      ? undefined
      : (input.decision.ourTeamSouls - input.decision.enemyTeamSouls) /
        Math.max(1, input.decision.ourTeamSouls + input.decision.enemyTeamSouls);
    const blend = soulDelta === undefined
      ? { ahead: 0, even: 0, behind: 0 }
      : soulDelta > 0.08
        ? { ahead: 1, even: 0, behind: 0 }
        : soulDelta < -0.08
          ? { ahead: 0, even: 0, behind: 1 }
          : { ahead: 0, even: 1, behind: 0 };
    return {
      heroId: input.decision.state.heroId,
      enemyHeroIds: input.decision.enemyHeroIds,
      gameTimeSec: input.decision.state.gameTimeSec,
      gameStateBlend: blend,
      ownedItemIds,
      plannedPrefixItemIds: [],
      evidence: input.evidence,
      ownBuildArchetype: strategyId,
      enemyCompositionKey: input.decision.enemyHeroIds.join(','),
    };
  }
}

function strategicCandidateUtility(
  candidate: RecommendationCandidate,
  currentGoal: BuildStrategyGoalV1 | undefined,
  before: BuildContractV1,
  after: BuildContractV1,
  slotPlan: BuildSlotPlanV1,
  graph: RecommendationItemGraph,
): number {
  let utility = 0;
  if (currentGoal && isResolved(after.goalStates[currentGoal.goalId]) && !isResolved(before.goalStates[currentGoal.goalId])) utility += 1.25;
  const target = candidateTarget(candidate);
  if (currentGoal && target !== undefined) {
    if (currentGoal.targetItemIds.includes(target)) utility += 0.55;
    else if (currentGoal.targetItemIds.some((goalTarget) => graph.isComponentAncestor(target, goalTarget))) utility += 0.25;
  }
  const transition = currentGoal ? slotPlan.futureTransitions.find((entry) => entry.targetGoalId === currentGoal.goalId) : undefined;
  if (transition?.requirement === 'SELL_TEMPORARY' && candidate.action.type === 'SELL_ITEM' && transition.sourceItemId === candidate.action.itemId) utility += 0.65;
  if (transition?.requirement === 'UPGRADE' && candidate.action.type === 'UPGRADE_ITEM') utility += 0.35;
  return utility;
}

function makeStrategyPlan(
  strategy: BuildStrategySpecV1,
  contract: BuildContractV1,
  slotPlan: BuildSlotPlanV1,
  investmentPlan: BuildInvestmentPlanV1,
): AdaptiveStrategyPlanV1 {
  const hardGoals = strategy.goals.filter((goal) => goal.hard && contract.goalStates[goal.goalId] !== 'SKIPPED');
  const satisfiedHardGoals = hardGoals.filter((goal) => isResolved(contract.goalStates[goal.goalId])).length;
  const currentGoal = strategy.goals.find((goal) => goal.goalId === contract.currentGoalId);
  return {
    strategyId: strategy.strategyId,
    buildStatus: slotPlan.feasible ? contract.status : 'REPLAN_REQUIRED',
    progress: { satisfiedHardGoals, totalHardGoals: hardGoals.length },
    currentGoal: currentGoal ? { goalId: currentGoal.goalId, type: currentGoal.type, reasonCodes: currentGoal.rationaleCodes } : undefined,
    remainingGoalIds: [...contract.remainingHardGoalIds],
    slotPlan,
    investmentPlan,
    situationalDecision: contract.activeSituationalDecision,
  };
}

function adaptiveAction(candidate: RecommendationCandidate, reasons: readonly string[]): AdaptiveActionV1 {
  const action = candidate.action;
  if (action.type === 'BUY_ITEM') return { actionKey: candidate.actionId, type: 'BUY', itemId: action.itemId, targetItemId: action.itemId, reasonCodes: reasons };
  if (action.type === 'UPGRADE_ITEM') return { actionKey: candidate.actionId, type: 'UPGRADE', itemId: action.itemId, targetItemId: action.itemId, reasonCodes: reasons };
  if (action.type === 'SELL_ITEM') return { actionKey: candidate.actionId, type: 'SELL', itemId: action.itemId, reasonCodes: reasons };
  if (action.type === 'REPLACE_ITEM') return { actionKey: candidate.actionId, type: 'REPLACE', sellItemId: action.sellItemId, buyItemId: action.buyItemId, targetItemId: action.buyItemId, reasonCodes: reasons };
  return { actionKey: candidate.actionId, type: 'WAIT', targetItemId: action.targetItemId, reasonCodes: reasons };
}

function fallbackAction(contract: BuildContractV1): AdaptiveActionV1 {
  return contract.status === 'COMPLETE'
    ? { actionKey: 'HOLD', type: 'HOLD', reasonCodes: ['BUILD_CONTRACT_COMPLETE'] }
    : { actionKey: 'WAIT', type: 'WAIT', reasonCodes: ['NO_LEGAL_STRATEGY_TRANSACTION', ...contract.completionReasonCodes] };
}

function toAdaptiveScoredAction(value: ScoredStrategyCandidateV1): AdaptiveScoredActionV1 {
  return {
    action: adaptiveAction(value.candidate, value.reasonCodes),
    score: value.score,
    confidence: value.confidence,
    components: value.components,
    reasonCodes: value.reasonCodes,
  };
}

function candidateTarget(candidate: RecommendationCandidate): number | undefined {
  const action = candidate.action;
  if (action.type === 'BUY_ITEM' || action.type === 'UPGRADE_ITEM') return action.itemId;
  if (action.type === 'REPLACE_ITEM') return action.buyItemId;
  if (action.type === 'WAIT_SAVE') return action.targetItemId;
  return undefined;
}

function scoreGoal(
  goal: BuildStrategyGoalV1 | undefined,
  scorer: AdaptiveEvidenceScorerV1Service,
  context: AdaptiveItemScoreContextV1,
): number {
  if (!goal) return Number.NEGATIVE_INFINITY;
  return Math.max(...goal.targetItemIds.map((itemId) => safeScoreItem(scorer, itemId, context)?.score ?? Number.NEGATIVE_INFINITY));
}

function safeScoreItem(
  scorer: AdaptiveEvidenceScorerV1Service,
  itemId: number,
  context: AdaptiveItemScoreContextV1,
): AdaptiveItemScoreV1 | undefined {
  try {
    return scorer.scoreItem(itemId, context);
  } catch {
    return undefined;
  }
}

function heldIds(state: RecommendationDecisionState): number[] {
  return [...state.inventory.heldByItemId.keys()].sort((a, b) => a - b);
}

function resolvedHardCount(contract: BuildContractV1): number {
  return Object.values(contract.goalStates).filter(isResolved).length;
}

function isResolved(value: string | undefined): boolean {
  return value === 'SATISFIED' || value === 'SKIPPED' || value === 'WAIVED';
}

function actionPathKey(node: StrategyNodeV1): string {
  return node.actions.map((entry) => entry.candidate.actionId).join('|');
}
