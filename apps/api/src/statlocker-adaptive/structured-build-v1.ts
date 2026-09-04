import {
  ConsensusBuildCandidateV1,
  ConsensusBuildGroupTypeV1,
  ConsensusBuildGroupV1,
  ConsensusBuildPhaseV1,
  ConsensusSkeletonV1,
} from './statlocker-adaptive.types';

export function stableConsensusGroupIdV1(
  heroId: number,
  phase: ConsensusBuildPhaseV1,
  type: ConsensusBuildGroupTypeV1,
  itemIds: readonly number[],
): string {
  const sorted = [...new Set(itemIds)].sort((a, b) => a - b);
  return `hero:${heroId}:${phase}:${type}:${sorted.join(',')}`;
}

export function candidateItemIdsV1(group: ConsensusBuildGroupV1): readonly number[] {
  return group.candidates.map((candidate) => candidate.itemId).sort((a, b) => a - b);
}

export function findConsensusCandidateV1(
  skeleton: ConsensusSkeletonV1 | undefined,
  itemId: number,
): ConsensusBuildCandidateV1 | undefined {
  for (const group of skeleton?.groups ?? []) {
    const candidate = group.candidates.find((entry) => entry.itemId === itemId);
    if (candidate) return candidate;
  }
  return undefined;
}

export function findConsensusGroupByItemV1(
  skeleton: ConsensusSkeletonV1 | undefined,
  itemId: number,
): ConsensusBuildGroupV1 | undefined {
  return skeleton?.groups.find((group) => group.candidates.some((candidate) => candidate.itemId === itemId));
}

export function phaseOrderV1(phase: ConsensusBuildPhaseV1): number {
  if (phase === 'EARLY') return 0;
  if (phase === 'MID') return 1;
  return 2;
}
