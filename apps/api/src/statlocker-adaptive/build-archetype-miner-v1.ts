import { RecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { AdaptiveSlotRulesV1 } from './adaptive-economy-v1';
import { PlannerTrajectoryV2 } from './planner-trajectory-v2';

export interface BuildArchetypeObservationV1 {
  heroId: number;
  rulesetId: string;
  catalogSha256: string;
  itemGraph: RecommendationItemGraph;
  trajectory: PlannerTrajectoryV2;
}

export interface BuildArchetypeMiningPolicyV1 {
  maxClusterDistance: number;
  minSupportCount: number;
  minScopeShare: number;
  minStability: number;
}

export const DEFAULT_BUILD_ARCHETYPE_MINING_POLICY_V1: BuildArchetypeMiningPolicyV1 = Object.freeze({
  maxClusterDistance: 0.35,
  minSupportCount: 2,
  minScopeShare: 0.1,
  minStability: 0.65,
});

export interface BuildArchetypeGoalTargetV1 {
  goalId: string;
  targetItemId: number;
}

export interface BuildArchetypeBranchAlternativeProofV1 {
  itemIds: readonly number[];
  representativeDecisionId: string;
  beforeOwnedItemIds: readonly number[];
  actionIds: readonly string[];
}

export interface BuildArchetypeBranchAlternativesV1 {
  groupId: string;
  alternatives: readonly (readonly number[])[];
  proofs?: readonly BuildArchetypeBranchAlternativeProofV1[];
}

export interface MinedBuildArchetypeV1 {
  archetypeId: string;
  heroId: number;
  rulesetId: string;
  catalogSha256: string;
  supportCount: number;
  scopeProfileCount: number;
  confidence: number;
  stability: number;
  meanDistance: number;
  representativeDecisionId: string;
  representativeActionIds: readonly string[];
  representativeInitialOwnedItemIds: readonly number[];
  representativeSlotRules: AdaptiveSlotRulesV1;
  representativeTrajectory?: PlannerTrajectoryV2;
  orderedGoalTargets?: readonly BuildArchetypeGoalTargetV1[];
  orderedGoalIds: readonly string[];
  orderedTargetItemIds: readonly number[];
  terminalItemIds: readonly number[];
  committedChoices: readonly { groupId: string; itemIds: readonly number[] }[];
  branchAlternatives?: readonly BuildArchetypeBranchAlternativesV1[];
  situationalWindowIds: readonly string[];
  observedExitItemIds?: readonly number[];
}

interface NormalizedBranchProofV1 extends BuildArchetypeBranchAlternativeProofV1 {
  groupId: string;
}

interface NormalizedObservationV1 {
  scopeKey: string;
  featureSignature: string;
  heroId: number;
  rulesetId: string;
  catalogSha256: string;
  decisionId: string;
  trajectory: PlannerTrajectoryV2;
  actionIds: readonly string[];
  initialOwnedItemIds: readonly number[];
  slotRules: AdaptiveSlotRulesV1;
  orderedGoalTargets: readonly BuildArchetypeGoalTargetV1[];
  orderedGoalIds: readonly string[];
  orderedTargetItemIds: readonly number[];
  terminalItemIds: readonly number[];
  committedChoices: readonly { groupId: string; itemIds: readonly number[] }[];
  branchProofs: readonly NormalizedBranchProofV1[];
  situationalWindowIds: readonly string[];
  observedExitItemIds: readonly number[];
  normalizedTiming: readonly number[];
}

export function mineBuildArchetypesV1(
  observations: readonly BuildArchetypeObservationV1[],
  policy: BuildArchetypeMiningPolicyV1 = DEFAULT_BUILD_ARCHETYPE_MINING_POLICY_V1,
): readonly MinedBuildArchetypeV1[] {
  validatePolicy(policy);
  const normalized = observations.map(normalizeObservation);
  const byScope = new Map<string, NormalizedObservationV1[]>();
  for (const observation of normalized) {
    const bucket = byScope.get(observation.scopeKey) ?? [];
    bucket.push(observation);
    byScope.set(observation.scopeKey, bucket);
  }

  const archetypes: MinedBuildArchetypeV1[] = [];
  for (const scope of [...byScope.values()]) {
    const orderedScope = [...scope].sort(compareNormalizedObservations);
    const clusters = completeLinkageClusters(orderedScope, policy.maxClusterDistance);
    for (const cluster of clusters) {
      const supportCount = cluster.length;
      const scopeProfileCount = scope.length;
      const scopeShare = scopeProfileCount === 0 ? 0 : supportCount / scopeProfileCount;
      if (supportCount < policy.minSupportCount || scopeShare < policy.minScopeShare) continue;

      const medoid = chooseMedoid(cluster);
      const meanDistance = meanDistanceTo(medoid, cluster);
      const stability = clamp01(1 - meanDistance);
      if (stability < policy.minStability) continue;

      archetypes.push({
        archetypeId: `archetype:${stableHash(`${medoid.scopeKey}|${medoid.featureSignature}`)}`,
        heroId: medoid.heroId,
        rulesetId: medoid.rulesetId,
        catalogSha256: medoid.catalogSha256,
        supportCount,
        scopeProfileCount,
        confidence: clamp01(scopeShare * stability),
        stability,
        meanDistance,
        representativeDecisionId: medoid.decisionId,
        representativeActionIds: medoid.actionIds,
        representativeInitialOwnedItemIds: medoid.initialOwnedItemIds,
        representativeSlotRules: cloneSlotRules(medoid.slotRules),
        representativeTrajectory: medoid.trajectory,
        orderedGoalTargets: medoid.orderedGoalTargets,
        orderedGoalIds: medoid.orderedGoalIds,
        orderedTargetItemIds: medoid.orderedTargetItemIds,
        terminalItemIds: medoid.terminalItemIds,
        committedChoices: medoid.committedChoices,
        branchAlternatives: aggregateBranchAlternatives(cluster),
        situationalWindowIds: medoid.situationalWindowIds,
        observedExitItemIds: medoid.observedExitItemIds,
      });
    }
  }

  return archetypes.sort((left, right) =>
    left.heroId - right.heroId ||
    left.rulesetId.localeCompare(right.rulesetId) ||
    left.catalogSha256.localeCompare(right.catalogSha256) ||
    right.supportCount - left.supportCount ||
    right.stability - left.stability ||
    left.archetypeId.localeCompare(right.archetypeId),
  );
}

function normalizeObservation(input: BuildArchetypeObservationV1): NormalizedObservationV1 {
  if (!Number.isSafeInteger(input.heroId) || input.heroId <= 0) {
    throw new Error('Build archetype observation heroId is invalid');
  }
  if (!input.rulesetId.trim()) throw new Error('Build archetype observation rulesetId is required');
  if (!/^[a-f0-9]{64}$/i.test(input.catalogSha256)) {
    throw new Error('Build archetype observation catalogSha256 is invalid');
  }
  if (input.trajectory.heroId !== input.heroId) throw new Error('ARCHETYPE_TRAJECTORY_HERO_MISMATCH');
  if (input.trajectory.rulesetId !== input.rulesetId) throw new Error('ARCHETYPE_TRAJECTORY_RULESET_MISMATCH');
  if (input.trajectory.catalogSha256.toLowerCase() !== input.catalogSha256.toLowerCase()) {
    throw new Error('ARCHETYPE_TRAJECTORY_CATALOG_MISMATCH');
  }

  const orderedGoalTargets = dedupeGoalTargetsPreservingOrder(
    input.trajectory.steps
      .filter((step) => Boolean(step.goalId) && Number.isSafeInteger(step.targetItemId) && Number(step.targetItemId) > 0)
      .map((step) => ({ goalId: step.goalId!, targetItemId: Number(step.targetItemId) })),
  );
  const orderedGoalIds = dedupePreservingOrder(
    input.trajectory.steps
      .map((step) => step.goalId)
      .filter((goalId): goalId is string => Boolean(goalId)),
  );
  const orderedTargetItemIds = dedupeNumbersPreservingOrder(
    input.trajectory.steps
      .map((step) => step.targetItemId)
      .filter((itemId): itemId is number => Number.isSafeInteger(itemId) && itemId > 0),
  );
  const terminalItemIds = collapseTerminalLineage(
    input.trajectory.terminalOwnedItemIds,
    input.itemGraph,
  );
  const committedChoices = [...input.trajectory.terminalContract.committedChoiceItemIdsByGroup.entries()]
    .map(([groupId, itemIds]) => ({
      groupId,
      itemIds: [...new Set(itemIds)].sort((left, right) => left - right),
    }))
    .sort((left, right) => left.groupId.localeCompare(right.groupId));
  const branchProofs = buildBranchProofs(input.trajectory, committedChoices);
  const situationalWindowIds = input.trajectory.terminalContract.situationalWindowStates
    .filter((window) => window.state === 'OPEN' || window.state === 'RESOLVED')
    .map((window) => window.windowId)
    .filter((windowId, index, values) => values.indexOf(windowId) === index)
    .sort();
  const observedExitItemIds = [...new Set(
    input.trajectory.steps
      .filter((step) => step.actionType === 'SELL_ITEM' || step.actionType === 'REPLACE_ITEM')
      .flatMap((step) => step.sourceItemIds),
  )].sort((left, right) => left - right);
  const normalizedTiming = normalizeStepTiming(input.trajectory.steps.map((step) => step.gameTimeSec));
  const scopeKey = `${input.heroId}|${input.rulesetId}|${input.catalogSha256.toLowerCase()}`;
  const featureSignature = JSON.stringify({
    orderedGoalTargets,
    orderedTargetItemIds,
    terminalItemIds,
    committedChoices,
    situationalWindowIds,
    observedExitItemIds,
  });

  return {
    scopeKey,
    featureSignature,
    heroId: input.heroId,
    rulesetId: input.rulesetId,
    catalogSha256: input.catalogSha256.toLowerCase(),
    decisionId: input.trajectory.decisionId,
    trajectory: input.trajectory,
    actionIds: input.trajectory.steps
      .filter((step) => step.actionType !== 'WAIT_SAVE')
      .map((step) => step.actionId),
    initialOwnedItemIds: [...new Set(input.trajectory.initialOwnedItemIds)].sort((left, right) => left - right),
    slotRules: cloneSlotRules(input.trajectory.slotRules),
    orderedGoalTargets,
    orderedGoalIds,
    orderedTargetItemIds,
    terminalItemIds,
    committedChoices,
    branchProofs,
    situationalWindowIds,
    observedExitItemIds,
    normalizedTiming,
  };
}

function buildBranchProofs(
  trajectory: PlannerTrajectoryV2,
  committedChoices: readonly { groupId: string; itemIds: readonly number[] }[],
): readonly NormalizedBranchProofV1[] {
  const orderedSteps = [...trajectory.steps].sort((left, right) => left.index - right.index);
  return committedChoices.map((choice) => {
    const groupSteps = orderedSteps.filter((step) =>
      step.goalId === choice.groupId && step.actionType !== 'WAIT_SAVE',
    );
    return {
      groupId: choice.groupId,
      itemIds: [...choice.itemIds],
      representativeDecisionId: trajectory.decisionId,
      beforeOwnedItemIds: [...(groupSteps[0]?.beforeOwnedItemIds ?? trajectory.initialOwnedItemIds)],
      actionIds: groupSteps.map((step) => step.actionId),
    };
  });
}

function completeLinkageClusters(
  observations: readonly NormalizedObservationV1[],
  maxDistance: number,
): readonly NormalizedObservationV1[][] {
  const clusters: NormalizedObservationV1[][] = [];
  for (const observation of observations) {
    const eligible = clusters
      .map((cluster, index) => ({
        index,
        maxDistance: Math.max(...cluster.map((member) => observationDistance(observation, member))),
        meanDistance: mean(cluster.map((member) => observationDistance(observation, member))),
      }))
      .filter((entry) => entry.maxDistance <= maxDistance)
      .sort((left, right) => left.meanDistance - right.meanDistance || left.index - right.index);
    const selected = eligible[0];
    if (!selected) {
      clusters.push([observation]);
      continue;
    }
    clusters[selected.index].push(observation);
  }
  return clusters;
}

function chooseMedoid(cluster: readonly NormalizedObservationV1[]): NormalizedObservationV1 {
  return [...cluster]
    .map((candidate) => ({ candidate, distance: meanDistanceTo(candidate, cluster) }))
    .sort((left, right) =>
      left.distance - right.distance ||
      left.candidate.featureSignature.localeCompare(right.candidate.featureSignature) ||
      left.candidate.decisionId.localeCompare(right.candidate.decisionId),
    )[0].candidate;
}

function meanDistanceTo(
  candidate: NormalizedObservationV1,
  cluster: readonly NormalizedObservationV1[],
): number {
  if (cluster.length <= 1) return 0;
  return mean(cluster
    .filter((entry) => entry !== candidate)
    .map((entry) => observationDistance(candidate, entry)));
}

function observationDistance(left: NormalizedObservationV1, right: NormalizedObservationV1): number {
  const targetDistance = normalizedLevenshtein(left.orderedTargetItemIds, right.orderedTargetItemIds);
  const goalTargetDistance = normalizedLevenshtein(
    goalTargetTokens(left.orderedGoalTargets),
    goalTargetTokens(right.orderedGoalTargets),
  );
  const terminalDistance = jaccardDistance(left.terminalItemIds, right.terminalItemIds);
  const choiceDistance = jaccardDistance(choiceTokens(left.committedChoices), choiceTokens(right.committedChoices));
  const windowDistance = jaccardDistance(left.situationalWindowIds, right.situationalWindowIds);
  const exitDistance = jaccardDistance(left.observedExitItemIds, right.observedExitItemIds);
  const timingDistance = vectorDistance(left.normalizedTiming, right.normalizedTiming);

  return clamp01(
    targetDistance * 0.28 +
    goalTargetDistance * 0.18 +
    terminalDistance * 0.24 +
    choiceDistance * 0.10 +
    windowDistance * 0.05 +
    exitDistance * 0.05 +
    timingDistance * 0.10,
  );
}

function aggregateBranchAlternatives(
  cluster: readonly NormalizedObservationV1[],
): readonly BuildArchetypeBranchAlternativesV1[] {
  const byGroup = new Map<
    string,
    Map<string, { itemIds: readonly number[]; proof: BuildArchetypeBranchAlternativeProofV1 }>
  >();
  for (const observation of cluster) {
    for (const proof of observation.branchProofs) {
      const itemIds = [...new Set(proof.itemIds)].sort((left, right) => left - right);
      if (itemIds.length === 0) continue;
      const alternatives = byGroup.get(proof.groupId) ?? new Map();
      const signature = itemIds.join(',');
      const existing = alternatives.get(signature);
      const normalizedProof: BuildArchetypeBranchAlternativeProofV1 = {
        itemIds,
        representativeDecisionId: proof.representativeDecisionId,
        beforeOwnedItemIds: [...new Set(proof.beforeOwnedItemIds)].sort((left, right) => left - right),
        actionIds: [...proof.actionIds],
      };
      if (!existing || normalizedProof.representativeDecisionId < existing.proof.representativeDecisionId) {
        alternatives.set(signature, { itemIds, proof: normalizedProof });
      }
      byGroup.set(proof.groupId, alternatives);
    }
  }

  return [...byGroup.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([groupId, alternatives]) => {
      const ordered = [...alternatives.values()].sort((left, right) => compareNumberArrays(left.itemIds, right.itemIds));
      return {
        groupId,
        alternatives: ordered.map((entry) => entry.itemIds),
        proofs: ordered.map((entry) => entry.proof),
      };
    });
}

function compareNumberArrays(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a !== b) return a - b;
  }
  return 0;
}

function normalizeStepTiming(values: readonly number[]): readonly number[] {
  if (values.length === 0) return [];
  const valid = values.map((value) => Number.isFinite(value) && value >= 0 ? value : 0);
  const denominator = Math.max(1, valid[valid.length - 1]);
  return valid.map((value) => clamp01(value / denominator));
}

function vectorDistance(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  const length = Math.max(left.length, right.length);
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 1;
    const b = right[index] ?? 1;
    total += Math.abs(a - b);
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
      const substitutionCost = Object.is(left[i - 1], right[j - 1]) ? 0 : 1;
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + substitutionCost,
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
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : 1 - intersection / union;
}

function goalTargetTokens(values: readonly BuildArchetypeGoalTargetV1[]): readonly string[] {
  return values.map((entry) => `${entry.goalId}:${entry.targetItemId}`);
}

function choiceTokens(
  choices: readonly { groupId: string; itemIds: readonly number[] }[],
): readonly string[] {
  return choices.flatMap((choice) => choice.itemIds.map((itemId) => `${choice.groupId}:${itemId}`));
}

function collapseTerminalLineage(
  itemIds: readonly number[],
  graph: RecommendationItemGraph,
): readonly number[] {
  const unique = [...new Set(itemIds)].filter((itemId) => graph.getItem(itemId) !== undefined);
  return unique
    .filter((itemId) => !unique.some((otherItemId) =>
      otherItemId !== itemId && graph.isComponentAncestor(itemId, otherItemId),
    ))
    .sort((left, right) => left - right);
}

function compareNormalizedObservations(
  left: NormalizedObservationV1,
  right: NormalizedObservationV1,
): number {
  return left.featureSignature.localeCompare(right.featureSignature) || left.decisionId.localeCompare(right.decisionId);
}

function cloneSlotRules(rules: AdaptiveSlotRulesV1): AdaptiveSlotRulesV1 {
  return {
    baseSlotsByType: { ...rules.baseSlotsByType },
    maxFlexSlots: rules.maxFlexSlots,
    maxActiveItems: rules.maxActiveItems,
    evidence: rules.evidence,
  };
}

function dedupeGoalTargetsPreservingOrder(
  values: readonly BuildArchetypeGoalTargetV1[],
): readonly BuildArchetypeGoalTargetV1[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.goalId}:${value.targetItemId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupePreservingOrder(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function dedupeNumbersPreservingOrder(values: readonly number[]): readonly number[] {
  const seen = new Set<number>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function validatePolicy(policy: BuildArchetypeMiningPolicyV1): void {
  if (!Number.isFinite(policy.maxClusterDistance) || policy.maxClusterDistance < 0 || policy.maxClusterDistance > 1) {
    throw new Error('ARCHETYPE_MAX_CLUSTER_DISTANCE_INVALID');
  }
  if (!Number.isSafeInteger(policy.minSupportCount) || policy.minSupportCount <= 0) {
    throw new Error('ARCHETYPE_MIN_SUPPORT_INVALID');
  }
  if (!Number.isFinite(policy.minScopeShare) || policy.minScopeShare < 0 || policy.minScopeShare > 1) {
    throw new Error('ARCHETYPE_MIN_SCOPE_SHARE_INVALID');
  }
  if (!Number.isFinite(policy.minStability) || policy.minStability < 0 || policy.minStability > 1) {
    throw new Error('ARCHETYPE_MIN_STABILITY_INVALID');
  }
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
