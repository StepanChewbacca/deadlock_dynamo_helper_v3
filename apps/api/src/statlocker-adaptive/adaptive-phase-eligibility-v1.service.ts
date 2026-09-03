import { Injectable } from '@nestjs/common';
import { AdaptiveGameStateV1 } from './adaptive-game-state';
import { ADAPTIVE_POLICY_V1_CONFIG } from './statlocker-adaptive.config';
import { ConsensusBuildGroupV1, ConsensusSkeletonV1 } from './statlocker-adaptive.types';
import { phaseOrderV1 } from './structured-build-v1';

export type AdaptiveGroupEligibilityV1 =
  | 'ELIGIBLE'
  | 'NOT_YET_ELIGIBLE'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'COMMITTED_OTHER_BRANCH';

export interface AdaptivePhaseEligibilityContextV1 {
  skeleton: ConsensusSkeletonV1;
  ownedItemIds: ReadonlySet<number>;
  completedGroupIds?: ReadonlySet<string>;
  skippedGroupIds?: ReadonlySet<string>;
  committedOtherGroupIds?: ReadonlySet<string>;
  gameTimeSec: number;
  gameState: AdaptiveGameStateV1;
}

@Injectable()
export class AdaptivePhaseEligibilityV1Service {
  evaluateGroup(
    group: ConsensusBuildGroupV1,
    context: AdaptivePhaseEligibilityContextV1,
  ): AdaptiveGroupEligibilityV1 {
    if (context.skippedGroupIds?.has(group.groupId)) return 'SKIPPED';
    if (context.completedGroupIds?.has(group.groupId) || groupCompletedV1(group, context.ownedItemIds)) return 'COMPLETED';
    if (context.committedOtherGroupIds?.has(group.groupId)) return 'COMMITTED_OTHER_BRANCH';
    if (group.phase === 'EARLY') return 'ELIGIBLE';
    if (group.candidates.some((candidate) => candidate.rushEvidence)) return 'ELIGIBLE';
    if (!requiredPriorGroupsComplete(group, context)) return 'NOT_YET_ELIGIBLE';

    const effectiveTimeSec = Math.max(0, context.gameTimeSec) +
      (context.gameState === 'AHEAD' ? ADAPTIVE_POLICY_V1_CONFIG.phase.aheadProgressAccelerationSec : 0);
    if (group.phase === 'MID' && effectiveTimeSec >= ADAPTIVE_POLICY_V1_CONFIG.phase.midMinTimeSec) return 'ELIGIBLE';
    if (group.phase === 'LATE' && effectiveTimeSec >= ADAPTIVE_POLICY_V1_CONFIG.phase.lateMinTimeSec) return 'ELIGIBLE';
    return 'NOT_YET_ELIGIBLE';
  }
}

export function groupCompletedV1(group: ConsensusBuildGroupV1, ownedItemIds: ReadonlySet<number>): boolean {
  const ownedCount = group.candidates.reduce((count, candidate) => count + (ownedItemIds.has(candidate.itemId) ? 1 : 0), 0);
  if (group.type === 'OPTIONAL') return ownedCount > 0;
  return ownedCount >= Math.max(1, group.minSelect);
}

function requiredPriorGroupsComplete(
  group: ConsensusBuildGroupV1,
  context: AdaptivePhaseEligibilityContextV1,
): boolean {
  const targetOrder = phaseOrderV1(group.phase);
  return context.skeleton.groups
    .filter((candidate) => candidate.type === 'REQUIRED' && phaseOrderV1(candidate.phase) < targetOrder)
    .every((candidate) =>
      context.completedGroupIds?.has(candidate.groupId) ||
      context.skippedGroupIds?.has(candidate.groupId) ||
      groupCompletedV1(candidate, context.ownedItemIds),
    );
}
