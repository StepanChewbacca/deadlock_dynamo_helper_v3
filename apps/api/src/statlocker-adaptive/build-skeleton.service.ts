import { createHash } from 'crypto';
import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecommendationItemCatalogRecipeV1 } from '../deadlock-live/entities/recommendation-item-catalog-recipe-v1.entity';
import { RecommendationItemCatalogVersionV1 } from '../deadlock-live/entities/recommendation-item-catalog-version-v1.entity';
import {
  BuiltConsensusSkeletonV1,
  ConsensusBuildCandidateV1,
  ConsensusBuildGroupTypeV1,
  ConsensusBuildGroupV1,
  ConsensusBuildPhaseV1,
  ConsensusSkeletonComponentV1,
  ConsensusSkeletonItemV1,
  StatlockerFrequencyTierV1,
  StatlockerHeroLeaderboardV1,
  StatlockerProBuildAnalysisV1,
  StatlockerProBuildExplicitGroupV1,
  StatlockerProBuildItemV1,
} from './statlocker-adaptive.types';
import { ADAPTIVE_POLICY_V1_CONFIG } from './statlocker-adaptive.config';
import { stableJson } from './statlocker-normalizer.service';
import { phaseOrderV1, stableConsensusGroupIdV1 } from './structured-build-v1';
import { StatlockerSnapshotStoreService } from './statlocker-snapshot-store.service';

export interface RebuildConsensusSkeletonInputV1 {
  heroId: number;
  rulesetVersion: string;
  catalogSha256: string;
  statlockerPatchId: string;
}

const DEFAULT_MIN_PROFILES = 6;
const MAX_PROFILES = 10;
const SKELETON_SCHEMA_VERSION = 'statlocker-consensus-skeleton-v2';
const SKELETON_COLLECTOR_VERSION = 'internal-consensus-v1';
const SKELETON_NORMALIZER_VERSION = 'consensus-builder-v2';

const COMPONENT_WEIGHTS = {
  coverage: 0.35,
  purchaseRate: 0.25,
  frequencyTier: 0.20,
  orderConsistency: 0.15,
  relationship: 0.05,
} as const;

interface DerivedItemV1 {
  candidate: ConsensusBuildCandidateV1;
  phase: ConsensusBuildPhaseV1;
  components: ConsensusSkeletonComponentV1;
  explicitGroup?: StatlockerProBuildExplicitGroupV1;
}

@Injectable()
export class BuildSkeletonService {
  private readonly minProfiles = readInteger(
    process.env.STATLOCKER_CONSENSUS_MIN_PROFILES,
    DEFAULT_MIN_PROFILES,
    3,
    MAX_PROFILES,
  );

  constructor(
    private readonly store: StatlockerSnapshotStoreService,
    @Optional()
    @InjectRepository(RecommendationItemCatalogVersionV1)
    private readonly catalogVersionRepo?: Repository<RecommendationItemCatalogVersionV1>,
    @Optional()
    @InjectRepository(RecommendationItemCatalogRecipeV1)
    private readonly catalogRecipeRepo?: Repository<RecommendationItemCatalogRecipeV1>,
  ) {}

  async rebuild(input: RebuildConsensusSkeletonInputV1): Promise<BuiltConsensusSkeletonV1 | undefined> {
    validateInput(input);
    const leaderboardSnapshot = this.store.getActive({
      dataset: 'HERO_LEADERBOARD',
      rulesetVersion: input.rulesetVersion,
      catalogSha256: input.catalogSha256,
      statlockerPatchId: input.statlockerPatchId,
      scopeKey: `hero:${input.heroId}`,
    });
    const leaderboard = asLeaderboard(leaderboardSnapshot?.payload, input.heroId);
    if (!leaderboard) return this.getCurrentSkeleton(input);

    const selectedProfiles = [...leaderboard.profiles]
      .sort((a, b) => a.rank - b.rank || a.accountId.localeCompare(b.accountId))
      .slice(0, MAX_PROFILES);
    const profileSnapshots: Array<{ snapshotId: string; fetchedAt: Date; payload: StatlockerProBuildAnalysisV1 }> = [];

    for (const profile of selectedProfiles) {
      const snapshot = this.store.getActive({
        dataset: 'PRO_BUILD_ANALYSIS',
        rulesetVersion: input.rulesetVersion,
        catalogSha256: input.catalogSha256,
        statlockerPatchId: input.statlockerPatchId,
        scopeKey: `hero:${input.heroId}:account:${profile.accountId}`,
      });
      const payload = asProBuild(snapshot?.payload, profile.accountId, input.heroId);
      if (!snapshot || !payload) continue;
      profileSnapshots.push({ snapshotId: snapshot.snapshotId, fetchedAt: snapshot.fetchedAt, payload });
    }

    if (profileSnapshots.length < this.minProfiles) return this.getCurrentSkeleton(input);

    const componentClosureByItemId = await this.loadComponentClosures(input);
    const skeleton = deriveSkeleton(
      input.heroId,
      profileSnapshots.map((entry) => entry.payload),
      componentClosureByItemId,
    );
    const contentSha256 = createHash('sha256').update(stableJson(skeleton)).digest('hex');
    const scopeKey = `hero:${input.heroId}:consensus`;
    const fetchedAt = newestDate([
      leaderboardSnapshot?.fetchedAt,
      ...profileSnapshots.map((entry) => entry.fetchedAt),
    ]);
    await this.store.publish({
      dataset: 'CONSENSUS_SKELETON',
      rulesetVersion: input.rulesetVersion,
      catalogSha256: input.catalogSha256,
      statlockerPatchId: input.statlockerPatchId,
      scopeKey,
      contentSha256,
      fetchedAt,
      schemaVersion: SKELETON_SCHEMA_VERSION,
      collectorVersion: SKELETON_COLLECTOR_VERSION,
      normalizerVersion: SKELETON_NORMALIZER_VERSION,
      payload: skeleton as unknown as Record<string, unknown>,
      metadata: {
        leaderboardSnapshotId: leaderboardSnapshot?.snapshotId,
        profileSnapshotIds: profileSnapshots.map((entry) => entry.snapshotId).sort(),
      },
    });
    return skeleton;
  }

  private getCurrentSkeleton(input: RebuildConsensusSkeletonInputV1): BuiltConsensusSkeletonV1 | undefined {
    const current = this.store.getActive({
      dataset: 'CONSENSUS_SKELETON',
      rulesetVersion: input.rulesetVersion,
      catalogSha256: input.catalogSha256,
      statlockerPatchId: input.statlockerPatchId,
      scopeKey: `hero:${input.heroId}:consensus`,
    });
    return asSkeleton(current?.payload, input.heroId);
  }

  private async loadComponentClosures(
    input: RebuildConsensusSkeletonInputV1,
  ): Promise<ReadonlyMap<number, ReadonlySet<number>>> {
    if (!this.catalogVersionRepo || !this.catalogRecipeRepo) return new Map<number, ReadonlySet<number>>();
    const [version] = await this.catalogVersionRepo.find({
      where: {
        payloadSha256: input.catalogSha256,
        rulesetKey: input.rulesetVersion,
      },
      take: 1,
    });
    if (!version) return new Map<number, ReadonlySet<number>>();
    const recipes = await this.catalogRecipeRepo.find({
      where: { catalogVersionId: version.catalogVersionId },
      order: { parentItemId: 'ASC', componentOrder: 'ASC', componentItemId: 'ASC' },
    });
    return componentClosureMapFromRecipes(recipes);
  }
}

export function deriveSkeleton(
  heroId: number,
  profiles: readonly StatlockerProBuildAnalysisV1[],
  componentClosureByItemId: ReadonlyMap<number, ReadonlySet<number>> = new Map<number, ReadonlySet<number>>(),
): BuiltConsensusSkeletonV1 {
  const selected = [...profiles]
    .filter((profile) => profile.heroId === heroId)
    .sort((a, b) => a.accountId.localeCompare(b.accountId))
    .slice(0, MAX_PROFILES);
  const itemIds = [...new Set(selected.flatMap((profile) => profile.items.map((item) => item.itemId)))].sort((a, b) => a - b);
  const derived = itemIds.map((itemId) => deriveItem(itemId, selected));
  const groups = deriveGroups(heroId, derived, selected, componentClosureByItemId);
  const items: ConsensusSkeletonItemV1[] = derived
    .map((entry) => ({
      itemId: entry.candidate.itemId,
      medianBuyTimeS: entry.candidate.medianBuyTimeS,
      strength: entry.candidate.strength,
      tier: entry.candidate.frequencyTier,
      components: entry.components,
    }))
    .sort((a, b) => a.medianBuyTimeS - b.medianBuyTimeS || a.itemId - b.itemId);
  return { heroId, profileCount: selected.length, groups, items };
}

function deriveGroups(
  heroId: number,
  derived: readonly DerivedItemV1[],
  profiles: readonly StatlockerProBuildAnalysisV1[],
  componentClosureByItemId: ReadonlyMap<number, ReadonlySet<number>>,
): readonly ConsensusBuildGroupV1[] {
  const groups: ConsensusBuildGroupV1[] = [];
  const assigned = new Set<number>();
  const ambiguousChoiceLikeItemIds = new Set<number>();
  const explicitBuckets = new Map<string, DerivedItemV1[]>();

  for (const entry of derived) {
    const explicit = entry.explicitGroup;
    if (!explicit) continue;
    const key = [entry.phase, explicit.type, explicit.groupKey, explicit.minSelect, explicit.maxSelect].join('|');
    const bucket = explicitBuckets.get(key) ?? [];
    bucket.push(entry);
    explicitBuckets.set(key, bucket);
  }

  for (const entries of [...explicitBuckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value)) {
    const explicit = entries[0].explicitGroup as StatlockerProBuildExplicitGroupV1;
    const phase = entries[0].phase;
    const candidates = entries.map((entry) => entry.candidate).sort(compareCandidates);
    groups.push({
      groupId: stableConsensusGroupIdV1(heroId, phase, explicit.type, candidates.map((candidate) => candidate.itemId)),
      phase,
      type: explicit.type,
      minSelect: explicit.minSelect,
      maxSelect: explicit.maxSelect,
      candidates,
      confidence: average(candidates.map((candidate) => candidate.strength)),
      inferred: false,
    });
    for (const candidate of candidates) assigned.add(candidate.itemId);
  }

  const available = derived
    .filter((entry) => !assigned.has(entry.candidate.itemId))
    .sort(compareDerivedItems);

  for (let index = 0; index < available.length; index += 1) {
    const seed = available[index];
    if (assigned.has(seed.candidate.itemId)) continue;
    const clique: DerivedItemV1[] = [seed];
    for (let candidateIndex = index + 1; candidateIndex < available.length; candidateIndex += 1) {
      const candidate = available[candidateIndex];
      if (assigned.has(candidate.candidate.itemId)) continue;
      if (clique.every((member) =>
        choicePairConfidence(member, candidate, profiles, componentClosureByItemId) !== undefined,
      )) {
        clique.push(candidate);
      }
    }
    if (clique.length < 2) continue;
    const confidences: number[] = [];
    for (let left = 0; left < clique.length; left += 1) {
      for (let right = left + 1; right < clique.length; right += 1) {
        const confidence = choicePairConfidence(
          clique[left],
          clique[right],
          profiles,
          componentClosureByItemId,
        );
        if (confidence !== undefined) confidences.push(confidence);
      }
    }
    const confidence = average(confidences);
    if (confidence < ADAPTIVE_POLICY_V1_CONFIG.choice.inferenceMinConfidence) {
      for (const entry of clique) ambiguousChoiceLikeItemIds.add(entry.candidate.itemId);
      continue;
    }
    const candidates = clique.map((entry) => entry.candidate).sort(compareCandidates);
    const phase = clique[0].phase;
    groups.push({
      groupId: stableConsensusGroupIdV1(heroId, phase, 'CHOICE', candidates.map((candidate) => candidate.itemId)),
      phase,
      type: 'CHOICE',
      minSelect: 1,
      maxSelect: 1,
      candidates,
      confidence,
      inferred: true,
    });
    for (const candidate of candidates) assigned.add(candidate.itemId);
  }

  for (const entry of derived) {
    if (assigned.has(entry.candidate.itemId)) continue;
    const type: ConsensusBuildGroupTypeV1 = ambiguousChoiceLikeItemIds.has(entry.candidate.itemId)
      ? 'OPTIONAL'
      : entry.candidate.frequencyTier === 'CORE' || entry.candidate.frequencyTier === 'FREQUENT'
        ? 'REQUIRED'
        : 'OPTIONAL';
    groups.push({
      groupId: stableConsensusGroupIdV1(heroId, entry.phase, type, [entry.candidate.itemId]),
      phase: entry.phase,
      type,
      minSelect: type === 'OPTIONAL' ? 0 : 1,
      maxSelect: 1,
      candidates: [entry.candidate],
      confidence: entry.candidate.strength,
      inferred: true,
    });
  }

  return groups.sort((a, b) =>
    phaseOrderV1(a.phase) - phaseOrderV1(b.phase) ||
    groupMedianTime(a) - groupMedianTime(b) ||
    a.groupId.localeCompare(b.groupId),
  );
}

function deriveItem(itemId: number, profiles: readonly StatlockerProBuildAnalysisV1[]): DerivedItemV1 {
  const observed: StatlockerProBuildItemV1[] = [];
  for (const profile of profiles) {
    const item = profile.items.find((candidate) => candidate.itemId === itemId);
    if (item) observed.push(item);
  }

  const coverage = ratio(observed.length, profiles.length);
  const purchaseRate = average(observed.map((item) => clamp01(item.purchaseRate)));
  const frequencyTierScore = average(observed.map((item) => frequencyScore(item.frequencyTier)));
  const buyTimes = observed.map((item) => Math.max(0, item.medianBuyTimeS)).sort((a, b) => a - b);
  const medianBuyTimeS = median(buyTimes);
  const timingSpreadS = median(buyTimes.map((value) => Math.abs(value - medianBuyTimeS)).sort((a, b) => a - b));
  const meanAbsoluteDeviation = average(buyTimes.map((value) => Math.abs(value - medianBuyTimeS)));
  const orderConsistency = clamp01(1 - meanAbsoluteDeviation / Math.max(300, medianBuyTimeS || 300));
  const relationship = average(observed.map((item) => {
    if (item.relationships.length === 0) return 0;
    return Math.max(...item.relationships.map((entry) => clamp01(entry.strength)));
  }));
  const components = { coverage, purchaseRate, frequencyTier: frequencyTierScore, orderConsistency, relationship };
  const strength = clamp01(
    components.coverage * COMPONENT_WEIGHTS.coverage +
    components.purchaseRate * COMPONENT_WEIGHTS.purchaseRate +
    components.frequencyTier * COMPONENT_WEIGHTS.frequencyTier +
    components.orderConsistency * COMPONENT_WEIGHTS.orderConsistency +
    components.relationship * COMPONENT_WEIGHTS.relationship,
  );
  const frequencyTier = classifyTier(coverage, strength);
  const phase = dominantPhase(observed);
  const explicitGroup = dominantExplicitGroup(observed, phase);

  return {
    candidate: {
      itemId,
      medianBuyTimeS,
      timingSpreadS,
      strength,
      coverage,
      purchaseRate,
      sourceProfileCount: observed.length,
      frequencyTier,
      rushEvidence: deriveRushEvidence(phase, buyTimes),
    },
    phase,
    components,
    explicitGroup,
  };
}

function choicePairConfidence(
  a: DerivedItemV1,
  b: DerivedItemV1,
  profiles: readonly StatlockerProBuildAnalysisV1[],
  componentClosureByItemId: ReadonlyMap<number, ReadonlySet<number>>,
): number | undefined {
  const config = ADAPTIVE_POLICY_V1_CONFIG.choice;
  if (a.phase !== b.phase) return undefined;
  if (itemsAreUpgradeRelatives(a.candidate.itemId, b.candidate.itemId, componentClosureByItemId)) return undefined;
  if (a.candidate.coverage < config.inferenceMinCoverage || b.candidate.coverage < config.inferenceMinCoverage) return undefined;
  const timeDelta = Math.abs(a.candidate.medianBuyTimeS - b.candidate.medianBuyTimeS);
  if (timeDelta > config.inferenceMaxMedianTimeDeltaSec) return undefined;

  let countA = 0;
  let countB = 0;
  let both = 0;
  for (const profile of profiles) {
    const hasA = profile.items.some((item) => item.itemId === a.candidate.itemId);
    const hasB = profile.items.some((item) => item.itemId === b.candidate.itemId);
    if (hasA) countA += 1;
    if (hasB) countB += 1;
    if (hasA && hasB) both += 1;
  }
  const denominator = Math.min(countA, countB);
  if (denominator === 0) return undefined;
  const cooccurrenceRate = both / denominator;
  if (cooccurrenceRate > config.inferenceMaxCooccurrence) return undefined;

  const coverageScore = clamp01((a.candidate.coverage + b.candidate.coverage) / 2);
  const exclusivityScore = clamp01(1 - cooccurrenceRate);
  const timingScore = clamp01(1 - timeDelta / Math.max(1, config.inferenceMaxMedianTimeDeltaSec));
  return (coverageScore + exclusivityScore + timingScore) / 3;
}

function itemsAreUpgradeRelatives(
  aItemId: number,
  bItemId: number,
  componentClosureByItemId: ReadonlyMap<number, ReadonlySet<number>>,
): boolean {
  return componentClosureByItemId.get(aItemId)?.has(bItemId) === true ||
    componentClosureByItemId.get(bItemId)?.has(aItemId) === true;
}

function componentClosureMapFromRecipes(
  recipes: readonly RecommendationItemCatalogRecipeV1[],
): ReadonlyMap<number, ReadonlySet<number>> {
  const direct = new Map<number, number[]>();
  for (const recipe of recipes) {
    const parentItemId = Number(recipe.parentItemId);
    const componentItemId = Number(recipe.componentItemId);
    if (!Number.isInteger(parentItemId) || parentItemId <= 0 || !Number.isInteger(componentItemId) || componentItemId <= 0) continue;
    const components = direct.get(parentItemId) ?? [];
    if (!components.includes(componentItemId)) components.push(componentItemId);
    direct.set(parentItemId, components);
  }

  const memo = new Map<number, ReadonlySet<number>>();
  const visit = (itemId: number, visiting: Set<number>): ReadonlySet<number> => {
    const cached = memo.get(itemId);
    if (cached) return cached;
    if (visiting.has(itemId)) return new Set<number>();
    visiting.add(itemId);
    const result = new Set<number>();
    for (const componentId of (direct.get(itemId) ?? []).sort((a, b) => a - b)) {
      result.add(componentId);
      for (const nestedId of visit(componentId, visiting)) result.add(nestedId);
    }
    visiting.delete(itemId);
    memo.set(itemId, result);
    return result;
  };

  for (const itemId of [...direct.keys()].sort((a, b) => a - b)) visit(itemId, new Set<number>());
  return memo;
}

function dominantPhase(observed: readonly StatlockerProBuildItemV1[]): ConsensusBuildPhaseV1 {
  const counts: Record<ConsensusBuildPhaseV1, number> = { EARLY: 0, MID: 0, LATE: 0 };
  for (const item of observed) counts[normalizePhaseCompat(item.phase)] += 1;
  return (Object.keys(counts) as ConsensusBuildPhaseV1[])
    .sort((a, b) => counts[b] - counts[a] || phaseOrderV1(a) - phaseOrderV1(b))[0] ?? 'EARLY';
}

function dominantExplicitGroup(
  observed: readonly StatlockerProBuildItemV1[],
  phase: ConsensusBuildPhaseV1,
): StatlockerProBuildExplicitGroupV1 | undefined {
  const counts = new Map<string, { value: StatlockerProBuildExplicitGroupV1; count: number }>();
  for (const item of observed) {
    if (!item.explicitGroup || normalizePhaseCompat(item.phase) !== phase) continue;
    const value = item.explicitGroup;
    const key = [value.type, value.groupKey, value.minSelect, value.maxSelect].join('|');
    const entry = counts.get(key) ?? { value, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.entries()]
    .sort(([keyA, a], [keyB, b]) => b.count - a.count || keyA.localeCompare(keyB))[0]?.[1].value;
}

function deriveRushEvidence(phase: ConsensusBuildPhaseV1, buyTimes: readonly number[]): boolean {
  if (buyTimes.length === 0 || phase === 'EARLY') return false;
  const floor = phase === 'MID'
    ? ADAPTIVE_POLICY_V1_CONFIG.phase.midMinTimeSec
    : ADAPTIVE_POLICY_V1_CONFIG.phase.lateMinTimeSec;
  const margin = phase === 'MID' ? 120 : 300;
  const earlyCount = buyTimes.filter((time) => time <= Math.max(0, floor - margin)).length;
  return earlyCount / buyTimes.length >= 0.30;
}

function normalizePhaseCompat(value: ConsensusBuildPhaseV1 | string): ConsensusBuildPhaseV1 {
  const normalized = String(value).trim().toUpperCase();
  if (normalized === 'EARLY' || normalized === 'EARLY_GAME') return 'EARLY';
  if (normalized === 'MID' || normalized === 'MID_GAME') return 'MID';
  if (normalized === 'LATE' || normalized === 'LATE_GAME') return 'LATE';
  return 'EARLY';
}

function compareCandidates(a: ConsensusBuildCandidateV1, b: ConsensusBuildCandidateV1): number {
  return a.medianBuyTimeS - b.medianBuyTimeS || a.itemId - b.itemId;
}

function compareDerivedItems(a: DerivedItemV1, b: DerivedItemV1): number {
  return phaseOrderV1(a.phase) - phaseOrderV1(b.phase) || compareCandidates(a.candidate, b.candidate);
}

function groupMedianTime(group: ConsensusBuildGroupV1): number {
  return median(group.candidates.map((candidate) => candidate.medianBuyTimeS).sort((a, b) => a - b));
}

function classifyTier(coverage: number, strength: number): StatlockerFrequencyTierV1 {
  if (coverage >= 0.75 && strength >= 0.72) return 'CORE';
  if (coverage >= 0.50 && strength >= 0.50) return 'FREQUENT';
  if (coverage >= 0.30 && strength >= 0.35) return 'SOMETIMES';
  return 'FLEX';
}

function frequencyScore(value: StatlockerFrequencyTierV1): number {
  if (value === 'CORE') return 1;
  if (value === 'FREQUENT') return 0.65;
  if (value === 'SOMETIMES') return 0.30;
  return 0.10;
}

function asLeaderboard(value: unknown, heroId: number): StatlockerHeroLeaderboardV1 | undefined {
  if (!isRecord(value) || value.heroId !== heroId || !Array.isArray(value.profiles)) return undefined;
  const profiles = value.profiles.filter((entry): entry is StatlockerHeroLeaderboardV1['profiles'][number] =>
    isRecord(entry) &&
    typeof entry.accountId === 'string' &&
    entry.heroId === heroId &&
    Number.isInteger(entry.rank) &&
    (entry.rank as number) > 0,
  );
  if (profiles.length === 0) return undefined;
  return { heroId, profiles };
}

function asProBuild(value: unknown, accountId: string, heroId: number): StatlockerProBuildAnalysisV1 | undefined {
  if (!isRecord(value) || value.accountId !== accountId || value.heroId !== heroId || !Array.isArray(value.items)) return undefined;
  return value as unknown as StatlockerProBuildAnalysisV1;
}

function asSkeleton(value: unknown, heroId: number): BuiltConsensusSkeletonV1 | undefined {
  if (
    !isRecord(value) ||
    value.heroId !== heroId ||
    !Number.isInteger(value.profileCount) ||
    !Array.isArray(value.groups) ||
    !Array.isArray(value.items)
  ) {
    return undefined;
  }
  return value as unknown as BuiltConsensusSkeletonV1;
}

function newestDate(values: readonly (Date | undefined)[]): Date {
  const timestamps = values
    .filter((value): value is Date => value instanceof Date && Number.isFinite(value.getTime()))
    .map((value) => value.getTime());
  return new Date(timestamps.length > 0 ? Math.max(...timestamps) : Date.now());
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle];
  return (values[middle - 1] + values[middle]) / 2;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? clamp01(numerator / denominator) : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function readInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function validateInput(input: RebuildConsensusSkeletonInputV1): void {
  if (!Number.isInteger(input.heroId) || input.heroId <= 0) throw new Error('Invalid consensus heroId');
  if (!input.rulesetVersion || !/^[a-f0-9]{64}$/i.test(input.catalogSha256) || !input.statlockerPatchId) {
    throw new Error('Invalid consensus snapshot identity');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}