import { Injectable } from '@nestjs/common';
import { RecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { BuildStrategyGoalV1, BuildStrategySpecV1 } from './build-strategy-v1';
import { ConsensusSkeletonV1 } from './statlocker-adaptive.types';

@Injectable()
export class ConsensusStrategyFallbackV1Service {
  compile(
    skeleton: ConsensusSkeletonV1,
    graph: RecommendationItemGraph,
    rulesetId: string,
    patchId: string,
  ): BuildStrategySpecV1 {
    const goals: BuildStrategyGoalV1[] = [];
    const branchGroups: BuildStrategySpecV1['branchGroups'][number][] = [];
    let prerequisiteGoalIds: string[] = [];

    for (const group of skeleton.groups) {
      if (group.type === 'CHOICE') {
        const optionGoalIds: string[] = [];
        for (const candidate of group.candidates) {
          const goalId = `fallback:${group.groupId}:choice:${candidate.itemId}`;
          const candidateLifecycle = lifecycleFor(candidate.itemId, skeleton, graph);
          const isTemp = candidateLifecycle === 'TEMPORARY_EARLY';
          goals.push({
            goalId,
            type: 'BRANCH',
            phase: group.phase,
            targetItemIds: [candidate.itemId],
            minSelect: 1,
            maxSelect: 1,
            prerequisiteGoalIds: [...prerequisiteGoalIds],
            hard: group.minSelect > 0 && !isTemp,
            lifecycleByItemId: { [candidate.itemId]: candidateLifecycle },
            rationaleCodes: ['CONSENSUS_FALLBACK_CHOICE', `GROUP:${group.groupId}`, `CONFIDENCE:${group.confidence.toFixed(3)}`],
          });
          optionGoalIds.push(goalId);
        }
        branchGroups.push({
          branchGroupId: `fallback:${group.groupId}`,
          optionGoalIds,
          minSelect: Math.max(1, group.minSelect),
          maxSelect: Math.max(1, Math.min(group.maxSelect, optionGoalIds.length)),
        });
        prerequisiteGoalIds = optionGoalIds;
        continue;
      }

      const goalId = `fallback:${group.groupId}`;
      const lifecycleByItemId = Object.fromEntries(group.candidates.map((candidate) => [
        candidate.itemId,
        lifecycleFor(candidate.itemId, skeleton, graph),
      ]));
      const isTemporary = Object.values(lifecycleByItemId).some((lifecycle) => lifecycle === 'TEMPORARY_EARLY');
      const hard = group.type === 'REQUIRED' && !isTemporary;
      goals.push({
        goalId,
        type: 'CORE',
        phase: group.phase,
        targetItemIds: group.candidates.map((candidate) => candidate.itemId).sort((a, b) => a - b),
        minSelect: hard ? Math.max(1, group.minSelect) : 0,
        maxSelect: Math.max(1, Math.min(group.maxSelect, Math.max(1, group.candidates.length))),
        prerequisiteGoalIds: [...prerequisiteGoalIds],
        hard,
        lifecycleByItemId,
        rationaleCodes: [
          group.type === 'REQUIRED' ? 'CONSENSUS_FALLBACK_REQUIRED' : 'CONSENSUS_FALLBACK_OPTIONAL',
          `GROUP:${group.groupId}`,
          `CONFIDENCE:${group.confidence.toFixed(3)}`,
        ],
      });
      if (hard) prerequisiteGoalIds = [goalId];
    }

    const groupConfidence = skeleton.groups.length === 0
      ? 0
      : skeleton.groups.reduce((sum, group) => sum + group.confidence, 0) / skeleton.groups.length;
    return {
      schemaVersion: 1,
      strategyId: `consensus-fallback:hero:${skeleton.heroId}:${patchId}`,
      heroId: skeleton.heroId,
      rulesetId,
      sourcePatchId: patchId,
      support: Math.min(1, skeleton.profileCount / 10),
      stability: Math.min(0.55, groupConfidence * 0.55),
      representativeTraceId: 'CONSENSUS_FALLBACK_NO_OBSERVED_MEDOID',
      goals,
      branchGroups,
      situationalWindows: [],
      investmentPolicy: {
        objectives: [],
        preferredWeights: { weapon: 0, vitality: 0, spirit: 0 },
      },
      slotPolicy: {
        reservedSituationalSlots: 0,
        maxTemporarySlots: goals.filter((goal) => Object.values(goal.lifecycleByItemId).includes('TEMPORARY_EARLY')).length,
      },
      terminalPolicy: {
        requiredGoalIds: goals
          .filter((goal) => goal.hard && !branchGroups.some((branch) => branch.optionGoalIds.includes(goal.goalId)))
          .filter((goal) => Object.values(goal.lifecycleByItemId).every((lifecycle) => lifecycle !== 'TEMPORARY_EARLY'))
          .map((goal) => goal.goalId)
          .slice(-16),
        allowWaiveSoftGoals: true,
      },
    };
  }
}

function lifecycleFor(
  itemId: number,
  skeleton: ConsensusSkeletonV1,
  graph: RecommendationItemGraph,
): 'PERMANENT_CORE' | 'UPGRADE_COMPONENT' | 'TEMPORARY_EARLY' {
  const item = graph.getItem(itemId);
  const cost = item?.directPurchaseCost ?? 0;
  const isEarly = skeleton.groups.some((group) =>
    group.phase === 'EARLY' && group.candidates.some((candidate) => candidate.itemId === itemId),
  );
  const hasLaterPhases = skeleton.groups.some((group) => group.phase === 'MID' || group.phase === 'LATE');
  if (hasLaterPhases && isEarly && cost <= 800) {
    const upgradedLater = skeleton.groups.some((group) =>
      group.phase !== 'EARLY' &&
      group.candidates.some((candidate) => graph.isComponentAncestor(itemId, candidate.itemId)),
    );
    if (!upgradedLater) {
      return 'TEMPORARY_EARLY';
    }
  }

  const isComponent = skeleton.groups.some((group) =>
    group.candidates.some((candidate) => candidate.itemId !== itemId && graph.isComponentAncestor(itemId, candidate.itemId)),
  );
  return isComponent ? 'UPGRADE_COMPONENT' : 'PERMANENT_CORE';
}
