import {
  RecommendationCandidate,
  RecommendationCandidateGeneratorRules,
  RecommendationDecisionState,
  RecommendationItemGraph,
  applyRecommendationCandidateTransitionV1,
  buildInventoryInstancesForRecommendation,
  createRecommendationItemGraph,
  generateRecommendationCandidates,
  resolveUpgradeExecutionPathV1,
} from '@deadlock-live-probe/build-domain';
import {
  AdaptiveActionV1,
  AdaptivePlanActionV1,
  AdaptiveRecommendationResultV1,
} from '@deadlock-live-probe/shared';
import type {
  AdaptiveReplayDecisionV1,
} from './adaptive-replay-v1.service';
import { StatlockerEvidenceBundleV1 } from './statlocker-evidence.service';

export const ADAPTIVE_REPLAY_CORRECTNESS_METRICS_V1 = [
  'illegalActionRate',
  'projectedInventoryDriftRate',
  'sellConsumedItemRate',
  'missedExecutableUpgradeRate',
  'unrelatedReplacementForUpgradeRate',
  'duplicateBarrierCardRate',
  'planActionBuildMismatchRate',
  'situationalTargetUnsupportedRate',
  'staleHeroTargetRate',
  'rulesetPatchMismatchRecommendationRate',
] as const;

export type AdaptiveReplayCorrectnessMetricNameV1 =
  (typeof ADAPTIVE_REPLAY_CORRECTNESS_METRICS_V1)[number];

export interface AdaptiveReplayCorrectnessMetricV1 {
  violations: number;
  opportunities: number;
  rate: number;
}

export interface AdaptiveReplayCorrectnessInputV1 {
  decision: AdaptiveReplayDecisionV1;
  evidence: StatlockerEvidenceBundleV1;
  result: AdaptiveRecommendationResultV1;
}

export interface AdaptiveReplayCorrectnessReportV1 {
  decisionId: string;
  matchId: string;
  metrics: Readonly<Record<AdaptiveReplayCorrectnessMetricNameV1, AdaptiveReplayCorrectnessMetricV1>>;
  releaseReady: boolean;
  violationCodes: readonly AdaptiveReplayCorrectnessMetricNameV1[];
}

export interface AdaptiveReplayCorrectnessAggregateV1 {
  replayCount: number;
  metrics: Readonly<Record<AdaptiveReplayCorrectnessMetricNameV1, AdaptiveReplayCorrectnessMetricV1>>;
  releaseReady: boolean;
}

export function evaluateAdaptiveReplayCorrectnessV1(
  input: AdaptiveReplayCorrectnessInputV1,
): AdaptiveReplayCorrectnessReportV1 {
  const graph = createRecommendationItemGraph(
    input.decision.itemDefinitions,
    input.decision.lineageEdges ?? [],
  );
  const state = replayDecisionState(input.decision, graph);
  const rules = replayCandidateRules(input.decision);
  const initialCandidates = generateRecommendationCandidates({ state, itemGraph: graph, rules });
  const nextCandidate = initialCandidates.find((candidate) => candidate.actionId === input.result.nextAction.actionKey);
  const transactionRecommendation = isTransactionAction(input.result.nextAction);
  const legalNextAction = !transactionRecommendation || Boolean(
    nextCandidate?.feasible && nextCandidate.recommendationEligible,
  );

  const projectionDrift = semanticProjectionDrift(input.result.planActions ?? [], state, graph, rules);
  const soldConsumed = sellsPreviouslyConsumedItem(input.result.planActions ?? []);
  const executableUpgrade = executableUpgradeCandidate(
    input.result,
    state,
    graph,
    initialCandidates,
  );
  const missedUpgrade = Boolean(
    executableUpgrade && input.result.nextAction.actionKey !== executableUpgrade.actionId,
  );
  const unrelatedReplacement = Boolean(
    executableUpgrade &&
    input.result.nextAction.type === 'REPLACE' &&
    !upgradeSourceItemIds(executableUpgrade).includes(input.result.nextAction.sellItemId ?? -1),
  );
  const duplicateCard = hasDuplicatePlanActionId(input.result.planActions ?? []);
  const planBuildMismatch = hasPlanActionBuildMismatch(input.result, graph);
  const unsupportedSituationalTarget = hasUnsupportedSituationalTarget(
    input.result.planActions ?? [],
    input.decision.enemyHeroIds,
  );
  const staleHeroTarget = hasStaleHeroTarget(input.result.planActions ?? [], input.evidence);
  const rulesetMismatch = transactionRecommendation && hasRulesetPatchMismatch(input);

  const metrics: Record<AdaptiveReplayCorrectnessMetricNameV1, AdaptiveReplayCorrectnessMetricV1> = {
    illegalActionRate: binaryMetric(!legalNextAction),
    projectedInventoryDriftRate: binaryMetric(projectionDrift),
    sellConsumedItemRate: binaryMetric(soldConsumed),
    missedExecutableUpgradeRate: binaryMetric(missedUpgrade),
    unrelatedReplacementForUpgradeRate: binaryMetric(unrelatedReplacement),
    duplicateBarrierCardRate: binaryMetric(duplicateCard),
    planActionBuildMismatchRate: binaryMetric(planBuildMismatch),
    situationalTargetUnsupportedRate: binaryMetric(unsupportedSituationalTarget),
    staleHeroTargetRate: binaryMetric(staleHeroTarget),
    rulesetPatchMismatchRecommendationRate: binaryMetric(rulesetMismatch),
  };
  const violationCodes = ADAPTIVE_REPLAY_CORRECTNESS_METRICS_V1.filter(
    (name) => metrics[name].violations > 0,
  );

  return {
    decisionId: input.decision.state.decisionId,
    matchId: input.decision.state.matchId,
    metrics,
    releaseReady: violationCodes.length === 0,
    violationCodes,
  };
}

export function aggregateAdaptiveReplayCorrectnessV1(
  reports: readonly AdaptiveReplayCorrectnessReportV1[],
): AdaptiveReplayCorrectnessAggregateV1 {
  const metrics = Object.fromEntries(
    ADAPTIVE_REPLAY_CORRECTNESS_METRICS_V1.map((name) => {
      const violations = reports.reduce((sum, report) => sum + report.metrics[name].violations, 0);
      const opportunities = reports.reduce((sum, report) => sum + report.metrics[name].opportunities, 0);
      return [name, {
        violations,
        opportunities,
        rate: opportunities === 0 ? 0 : violations / opportunities,
      }];
    }),
  ) as Record<AdaptiveReplayCorrectnessMetricNameV1, AdaptiveReplayCorrectnessMetricV1>;

  return {
    replayCount: reports.length,
    metrics,
    releaseReady: ADAPTIVE_REPLAY_CORRECTNESS_METRICS_V1.every((name) => metrics[name].violations === 0),
  };
}

function replayDecisionState(
  input: AdaptiveReplayDecisionV1,
  graph: RecommendationItemGraph,
): RecommendationDecisionState {
  const ownedItemIds = [...new Set(input.state.ownedItemIds)].sort((left, right) => left - right);
  const heldByItemId = buildInventoryInstancesForRecommendation(ownedItemIds, graph);
  return {
    decisionId: input.state.decisionId,
    matchId: input.state.matchId,
    playerSlot: input.state.playerSlot,
    gameTimeSec: input.state.gameTimeSec,
    rulesetId: input.state.rulesetId,
    heroId: input.state.heroId,
    inventory: {
      initializedFromSnapshot: true,
      heldByItemId,
      lifecycleCountByItemId: new Map(ownedItemIds.map((itemId) => [itemId, 1])),
      nextInstanceSequence: heldByItemId.size + 1,
    },
    economy: {
      spendableSouls: { ...input.state.spendableSouls },
      shopOpportunity: { ...input.state.shopOpportunity },
    },
  };
}

function replayCandidateRules(input: AdaptiveReplayDecisionV1): RecommendationCandidateGeneratorRules {
  const slots = input.slots;
  if (!slots || slots.mechanicsEvidence === 'UNKNOWN') {
    return {
      baseSlotsByType: { weapon: 0, vitality: 0, spirit: 0 },
      maxFlexSlots: 0,
      flexCapacityEvidence: 'UNKNOWN',
      maxActiveItems: 0,
      activeCapacityEvidence: 'UNKNOWN',
      allowSellOnlyActions: true,
      generateTargetedWaitActions: true,
    };
  }

  return {
    baseSlotsByType: slots.baseSlotsByType,
    maxFlexSlots: slots.maxFlexSlots,
    unlockedFlexSlots: slots.unlockedFlexSlots,
    flexCapacityEvidence: slots.flexEvidence,
    maxActiveItems: slots.maxActiveItems,
    activeCapacityEvidence: slots.mechanicsEvidence,
    allowSellOnlyActions: true,
    generateTargetedWaitActions: true,
  };
}

function semanticProjectionDrift(
  planActions: readonly AdaptivePlanActionV1[],
  initialState: RecommendationDecisionState,
  graph: RecommendationItemGraph,
  rules: RecommendationCandidateGeneratorRules,
): boolean {
  let state = initialState;
  for (const planAction of [...planActions].sort((left, right) => left.sequence - right.sequence)) {
    if (planAction.status !== 'READY') continue;
    if (!isTransactionAction(planAction.action)) continue;

    const candidates = generateRecommendationCandidates({ state, itemGraph: graph, rules });
    const candidate = candidates.find((entry) => entry.actionId === planAction.action.actionKey);
    if (!candidate?.feasible || !candidate.recommendationEligible) return true;
    if (
      candidate.action.type !== 'SELL_ITEM' &&
      canonicalTargetItemId(candidate) !== planAction.targetItemId
    ) return true;
    if (!sameNumbers(canonicalSourceItemIds(candidate), planAction.sourceItemIds)) return true;

    state = applyRecommendationCandidateTransitionV1(state, candidate, graph).state;
  }
  return false;
}

function sellsPreviouslyConsumedItem(planActions: readonly AdaptivePlanActionV1[]): boolean {
  const consumed = new Set<number>();
  for (const planAction of [...planActions].sort((left, right) => left.sequence - right.sequence)) {
    if (planAction.action.type === 'UPGRADE') {
      for (const itemId of planAction.sourceItemIds) consumed.add(itemId);
      for (const requirement of planAction.requirements) {
        if (requirement.type !== 'UPGRADE_COMPONENT') continue;
        for (const itemId of requirement.itemIds) consumed.add(itemId);
      }
      continue;
    }

    const soldItemId = planAction.action.type === 'SELL'
      ? planAction.action.sellItemId ?? planAction.action.itemId
      : planAction.action.type === 'REPLACE'
        ? planAction.action.sellItemId
        : undefined;
    if (soldItemId !== undefined && consumed.has(soldItemId)) return true;
  }
  return false;
}

function executableUpgradeCandidate(
  result: AdaptiveRecommendationResultV1,
  state: RecommendationDecisionState,
  graph: RecommendationItemGraph,
  candidates: readonly RecommendationCandidate[],
): RecommendationCandidate | undefined {
  const targetItemId = result.nextTargetItemId ??
    result.recommendedBuild.find((item) => item.status === 'NEXT')?.itemId ??
    transactionTargetItemId(result.nextAction);
  if (targetItemId === undefined) return undefined;

  const resolution = resolveUpgradeExecutionPathV1(state, targetItemId, graph);
  if (resolution.kind === 'DIRECT_UPGRADE') {
    return candidates.find((candidate) =>
      candidate.action.type === 'UPGRADE_ITEM' &&
      candidate.action.itemId === resolution.targetItemId &&
      candidate.action.recipeId === resolution.recipeId &&
      candidate.feasible &&
      candidate.recommendationEligible,
    );
  }
  if (resolution.kind === 'MULTI_STEP_UPGRADE') {
    return candidates.find((candidate) =>
      candidate.action.type === 'UPGRADE_ITEM' &&
      candidate.action.itemId === resolution.nextTargetItemId &&
      candidate.action.recipeId === resolution.nextRecipeId &&
      candidate.feasible &&
      candidate.recommendationEligible,
    );
  }
  return undefined;
}

function hasDuplicatePlanActionId(planActions: readonly AdaptivePlanActionV1[]): boolean {
  const ids = new Set<string>();
  for (const action of planActions) {
    if (ids.has(action.planActionId)) return true;
    ids.add(action.planActionId);
  }
  return false;
}

function hasPlanActionBuildMismatch(
  result: AdaptiveRecommendationResultV1,
  graph: RecommendationItemGraph,
): boolean {
  const first = [...(result.planActions ?? [])]
    .filter((action) => action.status !== 'OWNED' && action.status !== 'COMPLETED')
    .sort((left, right) => left.sequence - right.sequence)[0];
  const next = [...result.recommendedBuild]
    .sort((left, right) => left.position - right.position || left.itemId - right.itemId)
    .find((item) => item.status === 'NEXT');
  if (!first && !next) return false;
  if (!first || !next) return true;
  if (first.targetItemId === next.itemId) return false;
  return first.targetItemId === undefined || !graph.isComponentAncestor(first.targetItemId, next.itemId);
}

function hasUnsupportedSituationalTarget(
  planActions: readonly AdaptivePlanActionV1[],
  enemyHeroIds: readonly number[],
): boolean {
  const enemies = new Set(enemyHeroIds);
  return planActions.some((planAction) =>
    planAction.situational?.targetEnemies.some((target) =>
      !enemies.has(target.enemyHeroId) ||
      target.evidenceKinds.length === 0 ||
      !Number.isFinite(target.confidence) ||
      target.confidence <= 0,
    ) ?? false,
  );
}

function hasStaleHeroTarget(
  planActions: readonly AdaptivePlanActionV1[],
  evidence: StatlockerEvidenceBundleV1,
): boolean {
  const requiresMatchupEvidence = planActions.some((planAction) =>
    planAction.situational?.targetEnemies.some((target) => target.evidenceKinds.includes('MATCHUP_STAT')) ?? false,
  );
  if (!requiresMatchupEvidence) return false;

  const family = evidence.families.find((entry) => entry.dataset === 'VS_HERO_WPA');
  return family?.freshness !== 'FRESH' || family.payload === undefined;
}

function hasRulesetPatchMismatch(input: AdaptiveReplayCorrectnessInputV1): boolean {
  if (input.evidence.rulesetVersion !== input.decision.rulesetId) return true;
  if (input.evidence.catalogSha256.toLowerCase() !== input.decision.catalogSha256.toLowerCase()) return true;
  if (input.result.evidence.rulesetVersion !== input.decision.rulesetId) return true;
  if (input.result.evidence.catalogSha256.toLowerCase() !== input.decision.catalogSha256.toLowerCase()) return true;
  return input.evidence.families.some((family) => family.freshness === 'PATCH_MISMATCH') ||
    input.result.evidence.families.some((family) => family.freshness === 'PATCH_MISMATCH');
}

function canonicalTargetItemId(candidate: RecommendationCandidate): number | undefined {
  const action = candidate.action;
  if (action.type === 'BUY_ITEM' || action.type === 'UPGRADE_ITEM') return action.itemId;
  if (action.type === 'REPLACE_ITEM') return action.buyItemId;
  if (action.type === 'WAIT_SAVE') return action.targetItemId;
  return undefined;
}

function canonicalSourceItemIds(candidate: RecommendationCandidate): readonly number[] {
  const action = candidate.action;
  if (action.type === 'UPGRADE_ITEM') return [...action.consumedItemIds].sort((left, right) => left - right);
  if (action.type === 'REPLACE_ITEM') return [action.sellItemId];
  if (action.type === 'SELL_ITEM') return [action.itemId];
  return [];
}

function upgradeSourceItemIds(candidate: RecommendationCandidate): readonly number[] {
  return candidate.action.type === 'UPGRADE_ITEM'
    ? [...candidate.action.consumedItemIds]
    : [];
}

function transactionTargetItemId(action: AdaptiveActionV1): number | undefined {
  if (action.type === 'BUY' || action.type === 'UPGRADE') return action.itemId ?? action.targetItemId;
  if (action.type === 'REPLACE') return action.buyItemId ?? action.targetItemId;
  return action.targetItemId;
}

function isTransactionAction(action: AdaptiveActionV1): boolean {
  return action.type === 'BUY' || action.type === 'UPGRADE' || action.type === 'SELL' || action.type === 'REPLACE';
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  const a = [...new Set(left)].sort((x, y) => x - y);
  const b = [...new Set(right)].sort((x, y) => x - y);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function binaryMetric(violated: boolean): AdaptiveReplayCorrectnessMetricV1 {
  return {
    violations: violated ? 1 : 0,
    opportunities: 1,
    rate: violated ? 1 : 0,
  };
}
