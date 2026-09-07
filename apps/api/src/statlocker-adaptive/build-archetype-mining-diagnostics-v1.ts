import { BuildArchetypeObservationV1 } from './build-archetype-miner-v1';

export type BuildArchetypeMiningMethodV1 =
  | 'FEATURE_VECTOR'
  | 'SEQUENCE_AWARE'
  | 'HIERARCHICAL_BASELINE';

export interface BuildArchetypeMiningMethodDiagnosticsV1 {
  method: BuildArchetypeMiningMethodV1;
  scopeCount: number;
  clusterCount: number;
  stableClusterCount: number;
  noiseCount: number;
  meanWithinClusterDistance: number;
}

export interface BuildArchetypeMiningComparisonV1 {
  observationCount: number;
  methods: readonly BuildArchetypeMiningMethodDiagnosticsV1[];
}

interface MiningDescriptorV1 {
  scopeKey: string;
  decisionId: string;
  targetSequence: readonly number[];
  goalTargetSequence: readonly string[];
  terminalItemIds: readonly number[];
  branchTokens: readonly string[];
  situationalWindowIds: readonly string[];
  normalizedTiming: readonly number[];
}

export function compareBuildArchetypeMiningMethodsV1(
  observations: readonly BuildArchetypeObservationV1[],
  maxDistance = 0.35,
  minStableSupport = 2,
): BuildArchetypeMiningComparisonV1 {
  if (!Number.isFinite(maxDistance) || maxDistance < 0 || maxDistance > 1) {
    throw new Error('ARCHETYPE_DIAGNOSTIC_DISTANCE_INVALID');
  }
  if (!Number.isSafeInteger(minStableSupport) || minStableSupport <= 0) {
    throw new Error('ARCHETYPE_DIAGNOSTIC_SUPPORT_INVALID');
  }

  const descriptors = observations.map(toDescriptor);
  const methods: BuildArchetypeMiningMethodV1[] = [
    'FEATURE_VECTOR',
    'SEQUENCE_AWARE',
    'HIERARCHICAL_BASELINE',
  ];

  return {
    observationCount: descriptors.length,
    methods: methods.map((method) =>
      diagnosticsForMethod(descriptors, method, maxDistance, minStableSupport),
    ),
  };
}

function diagnosticsForMethod(
  descriptors: readonly MiningDescriptorV1[],
  method: BuildArchetypeMiningMethodV1,
  maxDistance: number,
  minStableSupport: number,
): BuildArchetypeMiningMethodDiagnosticsV1 {
  const scopes = new Map<string, MiningDescriptorV1[]>();
  for (const descriptor of descriptors) {
    const bucket = scopes.get(descriptor.scopeKey) ?? [];
    bucket.push(descriptor);
    scopes.set(descriptor.scopeKey, bucket);
  }

  const clusters: MiningDescriptorV1[][] = [];
  for (const scope of scopes.values()) {
    const ordered = [...scope].sort((left, right) => left.decisionId.localeCompare(right.decisionId));
    clusters.push(...clusterScope(ordered, method, maxDistance));
  }

  const stableClusters = clusters.filter((cluster) => cluster.length >= minStableSupport);
  const noiseCount = clusters
    .filter((cluster) => cluster.length < minStableSupport)
    .reduce((sum, cluster) => sum + cluster.length, 0);
  const distances = stableClusters.flatMap((cluster) => pairwiseDistances(cluster, method));

  return {
    method,
    scopeCount: scopes.size,
    clusterCount: clusters.length,
    stableClusterCount: stableClusters.length,
    noiseCount,
    meanWithinClusterDistance: mean(distances),
  };
}

function clusterScope(
  descriptors: readonly MiningDescriptorV1[],
  method: BuildArchetypeMiningMethodV1,
  maxDistance: number,
): MiningDescriptorV1[][] {
  const clusters: MiningDescriptorV1[][] = [];
  for (const descriptor of descriptors) {
    const eligible = clusters
      .map((cluster, index) => ({
        index,
        maxDistance: Math.max(...cluster.map((member) => distance(descriptor, member, method))),
        meanDistance: mean(cluster.map((member) => distance(descriptor, member, method))),
      }))
      .filter((entry) => entry.maxDistance <= maxDistance)
      .sort((left, right) => left.meanDistance - right.meanDistance || left.index - right.index);
    if (eligible.length === 0) {
      clusters.push([descriptor]);
    } else {
      clusters[eligible[0].index].push(descriptor);
    }
  }
  return clusters;
}

function distance(
  left: MiningDescriptorV1,
  right: MiningDescriptorV1,
  method: BuildArchetypeMiningMethodV1,
): number {
  const feature = clamp01(
    jaccardDistance(left.terminalItemIds, right.terminalItemIds) * 0.4 +
    jaccardDistance(left.targetSequence, right.targetSequence) * 0.3 +
    jaccardDistance(left.branchTokens, right.branchTokens) * 0.2 +
    jaccardDistance(left.situationalWindowIds, right.situationalWindowIds) * 0.1,
  );
  const sequence = clamp01(
    normalizedLevenshtein(left.targetSequence, right.targetSequence) * 0.65 +
    normalizedLevenshtein(left.goalTargetSequence, right.goalTargetSequence) * 0.15 +
    timingDistance(left.normalizedTiming, right.normalizedTiming) * 0.2,
  );
  if (method === 'FEATURE_VECTOR') return feature;
  if (method === 'SEQUENCE_AWARE') return sequence;
  return clamp01(feature * 0.5 + sequence * 0.5);
}

function toDescriptor(input: BuildArchetypeObservationV1): MiningDescriptorV1 {
  if (input.trajectory.heroId !== input.heroId || input.trajectory.rulesetId !== input.rulesetId) {
    throw new Error('ARCHETYPE_DIAGNOSTIC_SCOPE_MISMATCH');
  }
  if (input.trajectory.catalogSha256.toLowerCase() !== input.catalogSha256.toLowerCase()) {
    throw new Error('ARCHETYPE_DIAGNOSTIC_CATALOG_MISMATCH');
  }
  const steps = [...input.trajectory.steps].sort((left, right) => left.index - right.index);
  const targetSequence = steps
    .map((step) => step.targetItemId)
    .filter((itemId): itemId is number => Number.isSafeInteger(itemId) && itemId > 0);
  const goalTargetSequence = steps
    .filter((step) => Boolean(step.goalId) && Number.isSafeInteger(step.targetItemId) && Number(step.targetItemId) > 0)
    .map((step) => `${step.goalId}:${step.targetItemId}`);
  const terminalItemIds = [...new Set(input.trajectory.terminalOwnedItemIds)].sort((left, right) => left - right);
  const branchTokens = [...input.trajectory.terminalContract.committedChoiceItemIdsByGroup.entries()]
    .flatMap(([groupId, itemIds]) => [...new Set(itemIds)].map((itemId) => `${groupId}:${itemId}`))
    .sort();
  const situationalWindowIds = input.trajectory.terminalContract.situationalWindowStates
    .filter((window) => window.state === 'OPEN' || window.state === 'RESOLVED')
    .map((window) => window.windowId)
    .filter((windowId, index, values) => values.indexOf(windowId) === index)
    .sort();
  const normalizedTiming = normalizeTiming(steps.map((step) => step.gameTimeSec));

  return {
    scopeKey: `${input.heroId}|${input.rulesetId}|${input.catalogSha256.toLowerCase()}`,
    decisionId: input.trajectory.decisionId,
    targetSequence,
    goalTargetSequence,
    terminalItemIds,
    branchTokens,
    situationalWindowIds,
    normalizedTiming,
  };
}

function pairwiseDistances(
  cluster: readonly MiningDescriptorV1[],
  method: BuildArchetypeMiningMethodV1,
): readonly number[] {
  const values: number[] = [];
  for (let left = 0; left < cluster.length; left += 1) {
    for (let right = left + 1; right < cluster.length; right += 1) {
      values.push(distance(cluster[left], cluster[right], method));
    }
  }
  return values;
}

function normalizeTiming(values: readonly number[]): readonly number[] {
  if (values.length === 0) return [];
  const valid = values.map((value) => Number.isFinite(value) && value >= 0 ? value : 0);
  const denominator = Math.max(1, valid[valid.length - 1]);
  return valid.map((value) => clamp01(value / denominator));
}

function timingDistance(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  const length = Math.max(left.length, right.length);
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    total += Math.abs((left[index] ?? 1) - (right[index] ?? 1));
  }
  return clamp01(total / length);
}

function normalizedLevenshtein<T>(left: readonly T[], right: readonly T[]): number {
  const denominator = Math.max(left.length, right.length);
  if (denominator === 0) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (Object.is(left[i - 1], right[j - 1]) ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length] / denominator;
}

function jaccardDistance<T>(left: readonly T[], right: readonly T[]): number {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return 1 - intersection / (a.size + b.size - intersection);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
