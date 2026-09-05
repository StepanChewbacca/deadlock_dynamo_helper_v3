import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { RecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import {
  BuildArchetypeMiningConfigV1,
  BuildArchetypeMiningResultV1,
  BuildArchetypeV1,
} from './build-archetype.types';
import {
  buildArchetypeDistanceV1,
  encodeBuildArchetypeFeaturesV1,
} from './build-archetype-features-v1';
import { PlannerTrajectoryV2 } from './planner-trajectory-v2';

const DEFAULT_CONFIG: BuildArchetypeMiningConfigV1 = {
  distanceThreshold: 0.42,
  minClusterSize: 3,
};

@Injectable()
export class BuildArchetypeMinerV1Service {
  mine(
    trajectories: readonly PlannerTrajectoryV2[],
    graph: RecommendationItemGraph,
    config: Partial<BuildArchetypeMiningConfigV1> = {},
  ): BuildArchetypeMiningResultV1 {
    const resolved: BuildArchetypeMiningConfigV1 = {
      distanceThreshold: clamp01(config.distanceThreshold ?? DEFAULT_CONFIG.distanceThreshold),
      minClusterSize: Math.max(2, Math.floor(config.minClusterSize ?? DEFAULT_CONFIG.minClusterSize)),
    };
    const traces = [...trajectories].sort((a, b) => a.traceId.localeCompare(b.traceId));
    if (traces.length === 0) return { archetypes: [], noiseTraceIds: [], pairwiseDistances: {}, traceCount: 0 };

    const features = new Map(traces.map((trace) => [trace.traceId, encodeBuildArchetypeFeaturesV1(trace, graph)]));
    const pairwise = new Map<string, number>();
    for (let i = 0; i < traces.length; i += 1) {
      for (let j = i + 1; j < traces.length; j += 1) {
        const left = features.get(traces[i].traceId)!;
        const right = features.get(traces[j].traceId)!;
        pairwise.set(pairKey(left.traceId, right.traceId), buildArchetypeDistanceV1(left, right));
      }
    }

    const components = connectedComponents(traces, pairwise, resolved.distanceThreshold);
    const accepted = components.filter((component) => component.length >= resolved.minClusterSize);
    const noise = components.filter((component) => component.length < resolved.minClusterSize).flat();
    const archetypes = accepted
      .map((members, index) => buildArchetype(members, traces, pairwise, accepted, index, resolved.distanceThreshold))
      .sort((a, b) => b.support - a.support || b.stability - a.stability || a.archetypeId.localeCompare(b.archetypeId));

    return {
      archetypes,
      noiseTraceIds: noise.map((trace) => trace.traceId).sort(),
      pairwiseDistances: Object.fromEntries([...pairwise.entries()].sort(([a], [b]) => a.localeCompare(b))),
      traceCount: traces.length,
    };
  }
}

function connectedComponents(
  traces: readonly PlannerTrajectoryV2[],
  pairwise: ReadonlyMap<string, number>,
  threshold: number,
): PlannerTrajectoryV2[][] {
  const byId = new Map(traces.map((trace) => [trace.traceId, trace]));
  const remaining = new Set(byId.keys());
  const result: PlannerTrajectoryV2[][] = [];
  while (remaining.size > 0) {
    const seed = [...remaining].sort()[0];
    remaining.delete(seed);
    const queue = [seed];
    const memberIds = [seed];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const candidate of [...remaining].sort()) {
        if ((pairwise.get(pairKey(current, candidate)) ?? 1) > threshold) continue;
        remaining.delete(candidate);
        queue.push(candidate);
        memberIds.push(candidate);
      }
    }
    result.push(memberIds.map((id) => byId.get(id)!).sort((a, b) => a.traceId.localeCompare(b.traceId)));
  }
  return result;
}

function buildArchetype(
  members: readonly PlannerTrajectoryV2[],
  all: readonly PlannerTrajectoryV2[],
  pairwise: ReadonlyMap<string, number>,
  accepted: readonly (readonly PlannerTrajectoryV2[])[],
  clusterIndex: number,
  threshold: number,
): BuildArchetypeV1 {
  const medoid = [...members].sort((a, b) => {
    const da = totalDistance(a.traceId, members, pairwise);
    const db = totalDistance(b.traceId, members, pairwise);
    return da - db || a.traceId.localeCompare(b.traceId);
  })[0];
  const withinPairs: number[] = [];
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      withinPairs.push(pairwise.get(pairKey(members[i].traceId, members[j].traceId)) ?? 1);
    }
  }
  const within = withinPairs.length === 0 ? 0 : mean(withinPairs);
  const otherMembers = accepted
    .filter((_, index) => index !== clusterIndex)
    .flat();
  const nearestOther = otherMembers.length === 0
    ? undefined
    : Math.min(...members.flatMap((member) => otherMembers.map((other) => pairwise.get(pairKey(member.traceId, other.traceId)) ?? 1)));
  const stability = clamp01(1 - within / Math.max(0.001, threshold));
  const signature = stableSignature(members.map((entry) => entry.traceId));
  return {
    schemaVersion: 1,
    archetypeId: `hero:${medoid.heroId}:archetype:${signature.slice(0, 16)}`,
    heroId: medoid.heroId,
    patchId: medoid.patchId,
    rulesetId: medoid.rulesetId,
    support: members.length / Math.max(1, all.length),
    stability,
    representativeTraceId: medoid.traceId,
    memberTraceIds: members.map((entry) => entry.traceId).sort(),
    representativeFamilyIds: [...new Set(medoid.archetypeFeaturePayload.orderedFamilyIds)],
    withinClusterDistance: within,
    nearestOtherClusterDistance: nearestOther,
    sourceTraceCount: all.length,
  };
}

function totalDistance(
  traceId: string,
  members: readonly PlannerTrajectoryV2[],
  pairwise: ReadonlyMap<string, number>,
): number {
  return members.reduce((sum, other) => sum + (traceId === other.traceId ? 0 : pairwise.get(pairKey(traceId, other.traceId)) ?? 1), 0);
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function stableSignature(values: readonly string[]): string {
  return createHash('sha256').update([...values].sort().join('\n')).digest('hex');
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
