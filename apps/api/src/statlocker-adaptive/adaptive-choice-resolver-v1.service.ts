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
    const reconstructed = reconstructChoiceStateV1(
      group,
      context.ownedItemIds,
      context.itemGraph,
      context.previousCommittedItemId,
    );
    const scores = group.candidates
      .map((candidate) => this.scorer.scoreItem(candidate.itemId, context.scorerContext))
      .sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.itemId - b.itemId);

    if (reconstructed.committed && reconstructed.committedItemId !== undefined) {
      const score = scores.find((entry) => entry.itemId === reconstructed.committedItemId);
      return {
        ...reconstructed,
        selectedItemId: reconstructed.committedItemId,
        confidence: score?.confidence ?? reconstructed.confidence,
        scores,
      };
    }

    if (reconstructed.externallyDiverged) {
      const selectedItemId = group.candidates.some((candidate) => candidate.itemId === context.previousSelectedItemId)
        ? context.previousSelectedItemId
        : undefined;
      return { ...reconstructed, selectedItemId, scores };
    }

    const best = scores[0];
    if (!best) return { ...reconstructed, scores };
    const previous = context.previousSelectedItemId === undefined
      ? undefined
      : scores.find((entry) => entry.itemId === context.previousSelectedItemId);
    const selected = previous && best.score - previous.score < ADAPTIVE_POLICY_V1_CONFIG.choice.switchMinImprovement
      ? previous
      : best;
    return {
      ...reconstructed,
      selectedItemId: selected.itemId,
      confidence: selected.confidence,
      scores,
    };
  }
}

export function reconstructChoiceStateV1(
  group: ConsensusBuildGroupV1,
  ownedItemIds: readonly number[],
  itemGraph: RecommendationItemGraph,
  previousCommittedItemId?: number,
): AdaptiveChoiceStateV1 {
  const owned = new Set(ownedItemIds);
  const alternativeIds = group.candidates.map((candidate) => candidate.itemId).sort((a, b) => a - b);
  const ownedTargets = alternativeIds.filter((itemId) => owned.has(itemId));
  if (ownedTargets.length === 1) return committedState(group.groupId, ownedTargets[0]);
  if (ownedTargets.length > 1) {
    if (previousCommittedItemId !== undefined && ownedTargets.includes(previousCommittedItemId)) {
      return committedState(group.groupId, previousCommittedItemId);
    }
    return divergedState(group.groupId);
  }

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

  if (investedBranches.length === 1) return committedState(group.groupId, investedBranches[0]);
  if (investedBranches.length > 1) {
    if (previousCommittedItemId !== undefined && investedBranches.includes(previousCommittedItemId)) {
      return committedState(group.groupId, previousCommittedItemId);
    }
    return divergedState(group.groupId);
  }

  return {
    groupId: group.groupId,
    committed: false,
    confidence: 0,
    externallyDiverged: false,
  };
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
  };
  visit(itemId);
  return result;
}

function committedState(groupId: string, itemId: number): AdaptiveChoiceStateV1 {
  return {
    groupId,
    selectedItemId: itemId,
    committedItemId: itemId,
    committed: true,
    confidence: 1,
    externallyDiverged: false,
  };
}

function divergedState(groupId: string): AdaptiveChoiceStateV1 {
  return {
    groupId,
    committed: false,
    confidence: 0,
    externallyDiverged: true,
  };
}
