import { RecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { PlannerTrajectoryV2 } from './planner-trajectory-v2';

export interface BuildArchetypeObservationV1 {
  heroId: number;
  rulesetId: string;
  catalogSha256: string;
  itemGraph: RecommendationItemGraph;
  trajectory: PlannerTrajectoryV2;
}

export interface MinedBuildArchetypeV1 {
  archetypeId: string;
  heroId: number;
  rulesetId: string;
  catalogSha256: string;
  supportCount: number;
  scopeProfileCount: number;
  confidence: number;
  orderedGoalIds: readonly string[];
  orderedTargetItemIds: readonly number[];
  terminalItemIds: readonly number[];
  committedChoices: readonly { groupId: string; itemIds: readonly number[] }[];
  situationalWindowIds: readonly string[];
}

interface NormalizedObservationV1 {
  scopeKey: string;
  signature: string;
  heroId: number;
  rulesetId: string;
  catalogSha256: string;
  orderedGoalIds: readonly string[];
  orderedTargetItemIds: readonly number[];
  terminalItemIds: readonly number[];
  committedChoices: readonly { groupId: string; itemIds: readonly number[] }[];
  situationalWindowIds: readonly string[];
}

export function mineBuildArchetypesV1(
  observations: readonly BuildArchetypeObservationV1[],
): readonly MinedBuildArchetypeV1[] {
  const normalized = observations.map(normalizeObservation);
  const scopeCounts = new Map<string, number>();
  const grouped = new Map<string, NormalizedObservationV1[]>();

  for (const observation of normalized) {
    scopeCounts.set(observation.scopeKey, (scopeCounts.get(observation.scopeKey) ?? 0) + 1);
    const key = `${observation.scopeKey}|${observation.signature}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(observation);
    grouped.set(key, bucket);
  }

  return [...grouped.entries()]
    .map(([key, bucket]) => {
      const exemplar = bucket[0];
      const scopeProfileCount = scopeCounts.get(exemplar.scopeKey) ?? bucket.length;
      return {
        archetypeId: `archetype:${stableHash(key)}`,
        heroId: exemplar.heroId,
        rulesetId: exemplar.rulesetId,
        catalogSha256: exemplar.catalogSha256,
        supportCount: bucket.length,
        scopeProfileCount,
        confidence: scopeProfileCount === 0 ? 0 : bucket.length / scopeProfileCount,
        orderedGoalIds: exemplar.orderedGoalIds,
        orderedTargetItemIds: exemplar.orderedTargetItemIds,
        terminalItemIds: exemplar.terminalItemIds,
        committedChoices: exemplar.committedChoices,
        situationalWindowIds: exemplar.situationalWindowIds,
      };
    })
    .sort((left, right) =>
      left.heroId - right.heroId ||
      left.rulesetId.localeCompare(right.rulesetId) ||
      left.catalogSha256.localeCompare(right.catalogSha256) ||
      right.supportCount - left.supportCount ||
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
  const situationalWindowIds = input.trajectory.terminalContract.situationalWindowStates
    .filter((window) => window.state === 'OPEN' || window.state === 'RESOLVED')
    .map((window) => window.windowId)
    .filter((windowId, index, values) => values.indexOf(windowId) === index)
    .sort();
  const scopeKey = `${input.heroId}|${input.rulesetId}|${input.catalogSha256.toLowerCase()}`;
  const signature = JSON.stringify({
    orderedGoalIds,
    orderedTargetItemIds,
    terminalItemIds,
    committedChoices,
    situationalWindowIds,
  });

  return {
    scopeKey,
    signature,
    heroId: input.heroId,
    rulesetId: input.rulesetId,
    catalogSha256: input.catalogSha256.toLowerCase(),
    orderedGoalIds,
    orderedTargetItemIds,
    terminalItemIds,
    committedChoices,
    situationalWindowIds,
  };
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

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
