import {
  RecommendationCandidate,
  RecommendationCandidateGeneratorRules,
  RecommendationDecisionState,
  applyRecommendationCandidateTransitionV1,
  flexUsedFor,
  generateRecommendationCandidates,
  resolveUpgradeExecutionPathV1,
} from '@deadlock-live-probe/build-domain';
import {
  AdaptiveActionV1,
  AdaptivePlanActionV1,
  AdaptivePlanRequirementV1,
  AdaptivePlannedItemV1,
  AdaptiveSituationalContextV1,
} from '@deadlock-live-probe/shared';
import { AdaptiveDecisionStateV1 } from './adaptive-decision-state-v1.service';

export interface BuildAdaptivePlanActionsInputV1 {
  stateRevision: string;
  decision: AdaptiveDecisionStateV1;
  nextAction: AdaptiveActionV1;
  recommendedBuild: readonly AdaptivePlannedItemV1[];
  situationalByTargetItemId?: ReadonlyMap<number, AdaptiveSituationalContextV1>;
  /** @deprecated Prefer situationalByTargetItemId so multi-step acquisition stays attached to the final semantic target. */
  situationalByActionKey?: ReadonlyMap<string, AdaptiveSituationalContextV1>;
}

export function buildAdaptivePlanActionsV1(
  input: BuildAdaptivePlanActionsInputV1,
): readonly AdaptivePlanActionV1[] {
  const rows = [...input.recommendedBuild]
    .filter((row) => row.status !== 'OWNED')
    .sort((left, right) => left.position - right.position || left.itemId - right.itemId);
  const actions: AdaptivePlanActionV1[] = [];
  let projectedState: RecommendationDecisionState = input.decision.state;
  let projectionBlocked = false;

  const preparatory = compilePreparatoryTransaction(input, projectedState, actions.length + 1);
  if (preparatory) {
    actions.push(preparatory.action);
    projectedState = applyRecommendationCandidateTransitionV1(
      projectedState,
      preparatory.candidate,
      input.decision.itemGraph,
    ).state;
  }

  for (const row of rows) {
    if (input.decision.itemGraph.isTargetSatisfied(row.itemId, projectedState.inventory.heldByItemId.keys())) {
      continue;
    }
    const sequence = actions.length + 1;
    const compiled = compileTargetAction(
      input,
      projectedState,
      row.itemId,
      sequence,
      projectionBlocked,
    );
    actions.push(compiled.action);

    if (compiled.candidate?.feasible && compiled.candidate.recommendationEligible && !projectionBlocked) {
      projectedState = applyRecommendationCandidateTransitionV1(
        projectedState,
        compiled.candidate,
        input.decision.itemGraph,
      ).state;
    } else {
      projectionBlocked = true;
    }
  }

  if (actions.length === 0 && input.nextAction.type !== 'ABSTAIN') {
    const targetItemId = targetItemIdForAdaptiveAction(input.nextAction);
    actions.push({
      planActionId: stablePlanActionId(input.stateRevision, 1, input.nextAction.actionKey),
      sequence: 1,
      status: input.nextAction.type === 'HOLD' || input.nextAction.type === 'WAIT' ? 'BLOCKED' : 'READY',
      action: input.nextAction,
      targetItemId,
      sourceItemIds: sourceItemIdsForAdaptiveAction(input.nextAction),
      requirements: [],
      reasonCodes: [...input.nextAction.reasonCodes],
      situational: situationalForTarget(input, targetItemId, input.nextAction.actionKey),
    });
  }

  return dedupePlanActionIds(actions);
}

function compilePreparatoryTransaction(
  input: BuildAdaptivePlanActionsInputV1,
  state: RecommendationDecisionState,
  sequence: number,
): { action: AdaptivePlanActionV1; candidate: RecommendationCandidate } | undefined {
  if (input.nextAction.type !== 'SELL' && input.nextAction.type !== 'REPLACE') return undefined;

  const rules = candidateRules(input.decision);
  const candidate = generateRecommendationCandidates({
    state,
    itemGraph: input.decision.itemGraph,
    rules,
  }).find((entry) =>
    entry.actionId === input.nextAction.actionKey && entry.feasible && entry.recommendationEligible,
  );
  if (!candidate) return undefined;

  const semanticTargetItemId = targetItemIdForAdaptiveAction(input.nextAction);
  const mapped = mapCandidateAction(candidate, semanticTargetItemId ?? candidateTargetItemId(candidate) ?? 0);
  const adaptiveAction: AdaptiveActionV1 = {
    ...mapped,
    ...(semanticTargetItemId === undefined ? {} : { targetItemId: semanticTargetItemId }),
    reasonCodes: uniqueStrings([...mapped.reasonCodes, ...input.nextAction.reasonCodes]),
  };
  return {
    candidate,
    action: {
      planActionId: stablePlanActionId(input.stateRevision, sequence, adaptiveAction.actionKey),
      sequence,
      status: 'READY',
      action: adaptiveAction,
      targetItemId: semanticTargetItemId ?? candidateTargetItemId(candidate),
      sourceItemIds: sourceItemIdsForCandidate(candidate),
      requirements: derivePlanRequirements(state, candidate, input.decision, rules),
      reasonCodes: uniqueStrings([
        ...adaptiveAction.reasonCodes,
        ...candidate.reasons,
        ...candidate.recommendationSuppressionReasons,
      ]),
      situational: situationalForTarget(input, semanticTargetItemId, adaptiveAction.actionKey),
    },
  };
}

function compileTargetAction(
  input: BuildAdaptivePlanActionsInputV1,
  state: RecommendationDecisionState,
  finalTargetItemId: number,
  sequence: number,
  projectionBlocked: boolean,
): { action: AdaptivePlanActionV1; candidate?: RecommendationCandidate } {
  const graph = input.decision.itemGraph;
  const rules = candidateRules(input.decision);
  const candidates = generateRecommendationCandidates({ state, itemGraph: graph, rules });
  const acquisition = resolveUpgradeExecutionPathV1(state, finalTargetItemId, graph);
  const candidate = candidateForResolution(candidates, acquisition);
  const adaptiveAction = candidate
    ? mapCandidateAction(candidate, finalTargetItemId)
    : waitForUnexecutableTarget(finalTargetItemId, acquisition.kind === 'NOT_EXECUTABLE'
      ? acquisition.reasonCodes
      : ['TARGET_ALREADY_SATISFIED']);
  const sourceItemIds = candidate ? sourceItemIdsForCandidate(candidate) : [];
  const requirements = candidate
    ? derivePlanRequirements(state, candidate, input.decision, rules)
    : [];
  const status = projectionBlocked
    ? 'PLANNED'
    : candidate?.feasible && candidate.recommendationEligible
      ? 'READY'
      : 'BLOCKED';
  const reasonCodes = uniqueStrings([
    ...adaptiveAction.reasonCodes,
    ...(candidate?.reasons ?? []),
    ...(candidate?.recommendationSuppressionReasons ?? []),
  ]);

  return {
    candidate,
    action: {
      planActionId: stablePlanActionId(input.stateRevision, sequence, adaptiveAction.actionKey),
      sequence,
      status,
      action: adaptiveAction,
      targetItemId: targetItemIdForAdaptiveAction(adaptiveAction) ?? finalTargetItemId,
      sourceItemIds,
      requirements,
      reasonCodes,
      situational: situationalForTarget(input, finalTargetItemId, adaptiveAction.actionKey),
    },
  };
}

function situationalForTarget(
  input: BuildAdaptivePlanActionsInputV1,
  finalTargetItemId: number | undefined,
  actionKey: string,
): AdaptiveSituationalContextV1 | undefined {
  if (finalTargetItemId !== undefined) {
    const exactTarget = input.situationalByTargetItemId?.get(finalTargetItemId);
    if (exactTarget) return exactTarget;
  }
  return input.situationalByActionKey?.get(actionKey);
}

function candidateForResolution(
  candidates: readonly RecommendationCandidate[],
  resolution: ReturnType<typeof resolveUpgradeExecutionPathV1>,
): RecommendationCandidate | undefined {
  switch (resolution.kind) {
    case 'DIRECT_UPGRADE':
      return candidates.find((candidate) =>
        candidate.action.type === 'UPGRADE_ITEM' &&
        candidate.action.itemId === resolution.targetItemId &&
        candidate.action.recipeId === resolution.recipeId,
      );
    case 'MULTI_STEP_UPGRADE':
      return candidates.find((candidate) =>
        candidate.action.type === 'UPGRADE_ITEM' &&
        candidate.action.itemId === resolution.nextTargetItemId &&
        candidate.action.recipeId === resolution.nextRecipeId,
      );
    case 'DIRECT_BUY':
      return candidates.find((candidate) =>
        candidate.action.type === 'BUY_ITEM' && candidate.action.itemId === resolution.targetItemId,
      );
    case 'EXACT_OWNED':
    case 'NOT_EXECUTABLE':
      return undefined;
  }
}

export function derivePlanRequirements(
  state: RecommendationDecisionState,
  candidate: RecommendationCandidate,
  decision: AdaptiveDecisionStateV1,
  rules: RecommendationCandidateGeneratorRules = candidateRules(decision),
): readonly AdaptivePlanRequirementV1[] {
  const requirements: AdaptivePlanRequirementV1[] = [];
  const wallet = state.economy.spendableSouls;
  const requiresSouls = candidate.action.type === 'BUY_ITEM' ||
    candidate.action.type === 'UPGRADE_ITEM' ||
    candidate.action.type === 'REPLACE_ITEM';

  if (requiresSouls && (candidate.reasons.includes('UNAFFORDABLE') || candidate.reasons.includes('SPENDABLE_SOULS_UNKNOWN'))) {
    const requiredSouls = Math.max(0, candidate.effectiveCostSouls);
    const currentSouls = wallet.evidence === 'UNKNOWN' ? undefined : wallet.value;
    requirements.push({
      type: 'SOULS',
      requiredSouls,
      currentSouls,
      shortfallSouls: currentSouls === undefined ? undefined : Math.max(0, requiredSouls - currentSouls),
      evidence: wallet.evidence,
    });
  }

  const currentIds = [...state.inventory.heldByItemId.keys()];
  const beforeFlex = flexUsedFor(currentIds, decision.itemGraph, rules);
  const afterFlex = flexUsedFor(candidate.resultingItemIds, decision.itemGraph, rules);
  if (
    afterFlex > beforeFlex &&
    (candidate.reasons.includes('FLEX_SLOT_CAPACITY_UNKNOWN') || candidate.reasons.includes('SLOT_LIMIT_EXCEEDED'))
  ) {
    requirements.push({
      type: 'FLEX_SLOT',
      requiredFlexSlots: afterFlex,
      unlockedFlexSlots: decision.slots.unlockedFlexSlots,
      evidence: decision.slots.flexEvidence,
    });
  }

  if (candidate.action.type === 'UPGRADE_ITEM') {
    requirements.push({
      type: 'UPGRADE_COMPONENT',
      itemIds: [...candidate.action.consumedItemIds].sort((left, right) => left - right),
    });
  }

  if (candidate.action.type === 'REPLACE_ITEM') {
    requirements.push({ type: 'SELL_ITEM', itemId: candidate.action.sellItemId });
  }

  if (candidate.reasons.includes('SHOP_UNAVAILABLE') || candidate.reasons.includes('SHOP_OPPORTUNITY_UNKNOWN')) {
    requirements.push({
      type: 'SHOP_OPPORTUNITY',
      available: state.economy.shopOpportunity.value === 'AVAILABLE'
        ? true
        : state.economy.shopOpportunity.value === 'UNAVAILABLE'
          ? false
          : undefined,
      evidence: state.economy.shopOpportunity.evidence,
    });
  }

  return dedupeRequirements(requirements);
}

export function stablePlanActionId(stateRevision: string, sequence: number, actionKey: string): string {
  return `${stateRevision}:${String(sequence).padStart(3, '0')}:${actionKey}`;
}

function candidateRules(decision: AdaptiveDecisionStateV1): RecommendationCandidateGeneratorRules {
  return {
    baseSlotsByType: decision.slots.baseSlotsByType,
    maxFlexSlots: decision.slots.maxFlexSlots,
    unlockedFlexSlots: decision.slots.unlockedFlexSlots,
    flexCapacityEvidence: decision.slots.flexEvidence,
    maxActiveItems: decision.slots.maxActiveItems,
    allowSellOnlyActions: true,
    generateTargetedWaitActions: true,
  };
}

function mapCandidateAction(candidate: RecommendationCandidate, finalTargetItemId: number): AdaptiveActionV1 {
  switch (candidate.action.type) {
    case 'BUY_ITEM':
      return {
        actionKey: candidate.actionId,
        type: 'BUY',
        itemId: candidate.action.itemId,
        targetItemId: candidate.action.itemId,
        reasonCodes: candidate.recommendationEligible ? ['LEGAL_BUY'] : [...candidate.recommendationSuppressionReasons],
      };
    case 'UPGRADE_ITEM':
      return {
        actionKey: candidate.actionId,
        type: 'UPGRADE',
        itemId: candidate.action.itemId,
        targetItemId: candidate.action.itemId,
        reasonCodes: candidate.action.itemId === finalTargetItemId
          ? ['UPGRADE_PATH']
          : ['MULTI_STEP_UPGRADE_PATH', `FINAL_TARGET_${finalTargetItemId}`],
      };
    case 'SELL_ITEM':
      return {
        actionKey: candidate.actionId,
        type: 'SELL',
        sellItemId: candidate.action.itemId,
        itemId: candidate.action.itemId,
        reasonCodes: ['LEGAL_SELL'],
      };
    case 'REPLACE_ITEM':
      return {
        actionKey: candidate.actionId,
        type: 'REPLACE',
        sellItemId: candidate.action.sellItemId,
        buyItemId: candidate.action.buyItemId,
        targetItemId: candidate.action.buyItemId,
        reasonCodes: candidate.recommendationEligible ? ['LEGAL_REPLACE'] : [...candidate.recommendationSuppressionReasons],
      };
    case 'WAIT_SAVE':
      return {
        actionKey: candidate.actionId,
        type: 'WAIT',
        targetItemId: candidate.action.targetItemId,
        reasonCodes: ['WAIT_FOR_REQUIREMENTS'],
      };
  }
}

function candidateTargetItemId(candidate: RecommendationCandidate): number | undefined {
  switch (candidate.action.type) {
    case 'BUY_ITEM':
    case 'UPGRADE_ITEM':
      return candidate.action.itemId;
    case 'REPLACE_ITEM':
      return candidate.action.buyItemId;
    case 'WAIT_SAVE':
      return candidate.action.targetItemId;
    case 'SELL_ITEM':
      return undefined;
  }
}

function waitForUnexecutableTarget(targetItemId: number, reasons: readonly string[]): AdaptiveActionV1 {
  return {
    actionKey: `WAIT:${targetItemId}`,
    type: 'WAIT',
    targetItemId,
    reasonCodes: [...reasons],
  };
}

function sourceItemIdsForCandidate(candidate: RecommendationCandidate): readonly number[] {
  if (candidate.action.type === 'UPGRADE_ITEM') {
    return [...candidate.action.consumedItemIds].sort((left, right) => left - right);
  }
  if (candidate.action.type === 'REPLACE_ITEM') return [candidate.action.sellItemId];
  if (candidate.action.type === 'SELL_ITEM') return [candidate.action.itemId];
  return [];
}

function sourceItemIdsForAdaptiveAction(action: AdaptiveActionV1): readonly number[] {
  return Number.isInteger(action.sellItemId) ? [Number(action.sellItemId)] : [];
}

function targetItemIdForAdaptiveAction(action: AdaptiveActionV1): number | undefined {
  const value = action.targetItemId ?? action.buyItemId ?? action.itemId;
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function dedupeRequirements(
  requirements: readonly AdaptivePlanRequirementV1[],
): readonly AdaptivePlanRequirementV1[] {
  const seen = new Set<string>();
  return requirements.filter((requirement) => {
    const key = JSON.stringify(requirement);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupePlanActionIds(actions: readonly AdaptivePlanActionV1[]): readonly AdaptivePlanActionV1[] {
  const seen = new Set<string>();
  const result: AdaptivePlanActionV1[] = [];
  for (const action of actions) {
    if (seen.has(action.planActionId)) continue;
    seen.add(action.planActionId);
    result.push(action);
  }
  return result;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
