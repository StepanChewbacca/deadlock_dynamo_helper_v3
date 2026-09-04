import { Injectable } from '@nestjs/common';
import {
  AdaptiveInvestmentStateV1,
  ADAPTIVE_INVESTMENT_TYPES_V1,
  isCanonicalAdaptiveInvestmentStateV1,
} from './adaptive-economy-v1';
import { AdaptiveGameStateV1 } from './adaptive-game-state';
import { ADAPTIVE_POLICY_V1_CONFIG } from './statlocker-adaptive.config';
import { ConsensusBuildGroupV1, ConsensusSkeletonV1 } from './statlocker-adaptive.types';
import { phaseOrderV1 } from './structured-build-v1';
import { RecommendationItemGraph } from '@deadlock-live-probe/build-domain';

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
  investment: AdaptiveInvestmentStateV1;
  itemGraph?: RecommendationItemGraph;
}

@Injectable()
export class AdaptivePhaseEligibilityV1Service {
  evaluateGroup(
    group: ConsensusBuildGroupV1,
    context: AdaptivePhaseEligibilityContextV1,
  ): AdaptiveGroupEligibilityV1 {
    if (context.skippedGroupIds?.has(group.groupId)) return 'SKIPPED';
    if (context.completedGroupIds?.has(group.groupId) || groupCompletedV1(group, context.ownedItemIds, context.itemGraph)) return 'COMPLETED';
    if (context.committedOtherGroupIds?.has(group.groupId)) return 'COMMITTED_OTHER_BRANCH';
    if (group.phase === 'EARLY') return 'ELIGIBLE';
    if (group.candidates.some((candidate) => candidate.rushEvidence)) return 'ELIGIBLE';
    if (!requiredPriorGroupsComplete(group, context)) return 'NOT_YET_ELIGIBLE';

    const effectiveTimeSec = Math.max(0, context.gameTimeSec) + investmentProgressAccelerationSec(context.investment);
    if (group.phase === 'MID' && effectiveTimeSec >= ADAPTIVE_POLICY_V1_CONFIG.phase.midMinTimeSec) return 'ELIGIBLE';
    if (group.phase === 'LATE' && effectiveTimeSec >= ADAPTIVE_POLICY_V1_CONFIG.phase.lateMinTimeSec) return 'ELIGIBLE';
    return 'NOT_YET_ELIGIBLE';
  }
}

function investmentProgressAccelerationSec(investment: AdaptiveInvestmentStateV1): number {
  // RECONSTRUCTED is required because achieved breakpoints are derived from inventory plus exact rules.
  // A future observed breakpoint source needs an explicit provenance contract before it can accelerate phases.
  if (!isCanonicalAdaptiveInvestmentStateV1(investment) || investment.evidence !== 'RECONSTRUCTED') return 0;

  let achievedBreakpointCount = 0;
  for (const type of ADAPTIVE_INVESTMENT_TYPES_V1) {
    const track = investment.tracks[type];
    if (track.achievedBreakpoint !== undefined) achievedBreakpointCount += 1;
  }

  return achievedBreakpointCount >= ADAPTIVE_POLICY_V1_CONFIG.phase.strongInvestmentMinAchievedBreakpoints
    ? ADAPTIVE_POLICY_V1_CONFIG.phase.strongInvestmentProgressAccelerationSec
    : 0;
}

export function groupCompletedV1(group: ConsensusBuildGroupV1, ownedItemIds: ReadonlySet<number>, itemGraph?: RecommendationItemGraph): boolean {
  const satisfies = (candidateId: number): boolean => ownedItemIds.has(candidateId) || Boolean(itemGraph && [...ownedItemIds].some((ownedId) => {
    const closure = new Set<number>();
    const visit = (id: number): void => {
      for (const componentId of itemGraph.getDirectComponentIds(id)) {
        if (closure.has(componentId)) continue;
        closure.add(componentId);
        visit(componentId);
      }
    };
    visit(ownedId);
    return closure.has(candidateId);
  }));
  const ownedCount = group.candidates.reduce((count, candidate) => count + (satisfies(candidate.itemId) ? 1 : 0), 0);
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
      groupCompletedV1(candidate, context.ownedItemIds, context.itemGraph),
    );
}
