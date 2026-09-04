import { Injectable } from '@nestjs/common';
import { RecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import {
  AdaptiveEvidenceScorerV1Service,
  AdaptiveItemScoreContextV1,
  AdaptiveItemScoreV1,
} from './adaptive-evidence-scorer-v1.service';
import { ADAPTIVE_POLICY_V1_CONFIG } from './statlocker-adaptive.config';
import { ConsensusBuildGroupV1 } from './statlocker-adaptive.types';

export interface AdaptiveChoiceStateV1 {
  groupId: string;
  selectedItemIds: readonly number[];
  committedItemIds: readonly number[];
  selectedItemId?: number;
  committedItemId?: number;
  committed: boolean;
  confidence: number;
  externallyDiverged: boolean;
}

export interface AdaptiveChoiceResolutionContextV1 {
  scorerContext: AdaptiveItemScoreContextV1;
  itemGraph: RecommendationItemGraph;
  ownedItemIds: readonly number[];
  previousSelectedItemIds?: readonly number[];
  previousCommittedItemIds?: readonly number[];
  previousSelectedItemId?: number;
  previousCommittedItemId?: number;
}

export interface AdaptiveResolvedChoiceV1 extends AdaptiveChoiceStateV1 {
  scores: readonly AdaptiveItemScoreV1[];
}

@Injectable()
export class AdaptiveChoiceResolverV1Service {
  constructor(private readonly scorer: AdaptiveEvidenceScorerV1Service) {}

  reconstructChoiceState(
    group: ConsensusBuildGroupV1,
    ownedItemIds: readonly number[],
    itemGraph: RecommendationItemGraph,
    previousCommittedItemId?: number,
  ): AdaptiveChoiceStateV1 {
    return reconstructChoiceStateV1(group, ownedItemIds, itemGraph, previousCommittedItemId);
  }

  resolveChoice(
    group: ConsensusBuildGroupV1,
    context: AdaptiveChoiceResolutionContextV1,
  ): AdaptiveResolvedChoiceV1 {
    if (group.type !== 'CHOICE') throw new Error(`Group ${group.groupId} is not a CHOICE group`);
    const previousCommittedItemIds = normalizeChoiceIds(
      context.previousCommittedItemIds ?? optionalSingleton(context.previousCommittedItemId),
      group,
    );
    const previousSelectedItemIds = normalizeChoiceIds(
      context.previousSelectedItemIds ?? optionalSingleton(context.previousSelectedItemId),
      group,
    );
    const reconstructed = reconstructChoiceStateV1(
      group,
      context.ownedItemIds,
      context.itemGraph,
      previousCommittedItemIds,
    );
    const scores = group.candidates
      .map((candidate) => this.scorer.scoreItem(candidate.itemId, context.scorerContext))
      .sort(compareScores);

    if (reconstructed.externallyDiverged) {
      const selectedItemIds = previousSelectedItemIds.length > 0
        ? previousSelectedItemIds
        : reconstructed.committedItemIds;
      return withChoiceCompatibility({ ...reconstructed, selectedItemIds, scores });
    }

    const requiredCount = requiredChoiceCount(group);
    const committedItemIds = reconstructed.committedItemIds.slice(0, group.maxSelect);
    const remainingCount = Math.max(0, requiredCount - committedItemIds.length);
    const previousUncommitted = new Set(
      previousSelectedItemIds.filter((itemId) => !committedItemIds.includes(itemId)),
    );
    const available = scores
      .filter((entry) => !committedItemIds.includes(entry.itemId))
      .sort((a, b) => {
        const adjustedA = a.score + (previousUncommitted.has(a.itemId) ? ADAPTIVE_POLICY_V1_CONFIG.choice.switchMinImprovement : 0);
        const adjustedB = b.score + (previousUncommitted.has(b.itemId) ? ADAPTIVE_POLICY_V1_CONFIG.choice.switchMinImprovement : 0);
        return adjustedB - adjustedA || compareScores(a, b);
      });
    const selectedItemIds = [
      ...committedItemIds,
      ...available.slice(0, remainingCount).map((entry) => entry.itemId),
    ];
    const selectedScores = selectedItemIds
      .map((itemId) => scores.find((entry) => entry.itemId === itemId))
      .filter((entry): entry is AdaptiveItemScoreV1 => entry !== undefined);
    const confidence = selectedScores.length === 0
      ? reconstructed.confidence
      : selectedScores.reduce((sum, entry) => sum + entry.confidence, 0) / selectedScores.length;

    return withChoiceCompatibility({
      ...reconstructed,
      selectedItemIds,
      committedItemIds,
      committed: committedItemIds.length > 0,
      confidence,
      scores,
    });
  }
}

export function reconstructChoiceStateV1(
  group: ConsensusBuildGroupV1,
  ownedItemIds: readonly number[],
  itemGraph: RecommendationItemGraph,
  previousCommittedItemIdsOrId?: readonly number[] | number,
): AdaptiveChoiceStateV1 {
  const owned = new Set(ownedItemIds);
  const alternativeIds = group.candidates.map((candidate) => candidate.itemId).sort((a, b) => a - b);
  const previousCommittedItemIds = normalizeChoiceIds(
    Array.isArray(previousCommittedItemIdsOrId)
      ? previousCommittedItemIdsOrId
      : optionalSingleton(previousCommittedItemIdsOrId),
    group,
  );
  const ownedTargets = alternativeIds.filter((itemId) => owned.has(itemId));

  const closures = new Map<number, ReadonlySet<number>>();
  const componentOwners = new Map<number, number>();
  for (const itemId of alternativeIds) {
    const closure = componentClosureV1(itemId, itemGraph);
    closures.set(itemId, closure);
    for (const componentId of closure) componentOwners.set(componentId, (componentOwners.get(componentId) ?? 0) + 1);
  }

  const investedBranches = alternativeIds.filter((itemId) => {
    const closure = closures.get(itemId) ?? new Set<number>();
    for (const componentId of closure) {
      if ((componentOwners.get(componentId) ?? 0) === 1 && owned.has(componentId)) return true;
    }
    return false;
  });
  const evidencedItemIds = uniqueNumbers([...ownedTargets, ...investedBranches]).sort((a, b) => a - b);

  if (evidencedItemIds.length > group.maxSelect) {
    const validPrevious = previousCommittedItemIds.filter((itemId) => evidencedItemIds.includes(itemId));
    if (validPrevious.length > 0 && validPrevious.length <= group.maxSelect) {
      return withChoiceCompatibility({
        groupId: group.groupId,
        selectedItemIds: validPrevious,
        committedItemIds: validPrevious,
        committed: true,
        confidence: 1,
        externallyDiverged: false,
      });
    }
    return withChoiceCompatibility({
      groupId: group.groupId,
      selectedItemIds: evidencedItemIds,
      committedItemIds: evidencedItemIds,
      committed: false,
      confidence: 0,
      externallyDiverged: true,
    });
  }

  return withChoiceCompatibility({
    groupId: group.groupId,
    selectedItemIds: evidencedItemIds,
    committedItemIds: evidencedItemIds,
    committed: evidencedItemIds.length > 0,
    confidence: evidencedItemIds.length > 0 ? 1 : 0,
    externallyDiverged: false,
  });
}

export function componentClosureV1(itemId: number, itemGraph: RecommendationItemGraph): ReadonlySet<number> {
  const result = new Set<number>();
  const visiting = new Set<number>();
  const visit = (targetId: number): void => {
    if (visiting.has(targetId)) return;
    visiting.add(targetId);
    for (const componentId of itemGraph.getDirectComponentIds(targetId)) {
      if (!result.has(componentId)) result.add(componentId);
      visit(componentId);
    }
    visiting.delete(targetId);
  };
  visit(itemId);
  return result;
}

function requiredChoiceCount(group: ConsensusBuildGroupV1): number {
  const maxSelect = Math.max(1, Math.min(group.maxSelect, group.candidates.length));
  return Math.max(1, Math.min(maxSelect, group.minSelect));
}

function normalizeChoiceIds(
  itemIds: readonly number[],
  group: ConsensusBuildGroupV1,
): number[] {
  const allowed = new Set(group.candidates.map((candidate) => candidate.itemId));
  return uniqueNumbers(itemIds.filter((itemId) => allowed.has(itemId))).sort((a, b) => a - b);
}

function optionalSingleton(value: number | undefined): number[] {
  return value === undefined ? [] : [value];
}

function compareScores(a: AdaptiveItemScoreV1, b: AdaptiveItemScoreV1): number {
  return b.score - a.score || b.confidence - a.confidence || a.itemId - b.itemId;
}

function withChoiceCompatibility<T extends Omit<AdaptiveChoiceStateV1, 'selectedItemId' | 'committedItemId'>>(
  state: T,
): T & AdaptiveChoiceStateV1 {
  return {
    ...state,
    selectedItemId: state.selectedItemIds[0],
    committedItemId: state.committed ? state.committedItemIds[0] : undefined,
  };
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)];
}
