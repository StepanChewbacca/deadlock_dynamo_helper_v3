import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  ConsensusSkeletonItemV1,
  ConsensusSkeletonV1,
  StatlockerFrequencyTierV1,
  StatlockerHeroLeaderboardV1,
  StatlockerProBuildAnalysisV1,
  StatlockerProBuildItemV1,
} from './statlocker-adaptive.types';
import { stableJson } from './statlocker-normalizer.service';
import { StatlockerSnapshotStoreService } from './statlocker-snapshot-store.service';

export interface RebuildConsensusSkeletonInputV1 {
  heroId: number;
  rulesetVersion: string;
  catalogSha256: string;
  statlockerPatchId: string;
}

const DEFAULT_MIN_PROFILES = 6;
const MAX_PROFILES = 10;
const SKELETON_SCHEMA_VERSION = 'statlocker-consensus-skeleton-v1';
const SKELETON_COLLECTOR_VERSION = 'internal-consensus-v1';
const SKELETON_NORMALIZER_VERSION = 'consensus-builder-v1';

const COMPONENT_WEIGHTS = {
  coverage: 0.35,
  purchaseRate: 0.25,
  frequencyTier: 0.20,
  orderConsistency: 0.15,
  relationship: 0.05,
} as const;

@Injectable()
export class BuildSkeletonService {
  private readonly minProfiles = readInteger(
    process.env.STATLOCKER_CONSENSUS_MIN_PROFILES,
    DEFAULT_MIN_PROFILES,
    3,
    MAX_PROFILES,
  );

  constructor(private readonly store: StatlockerSnapshotStoreService) {}

  async rebuild(input: RebuildConsensusSkeletonInputV1): Promise<ConsensusSkeletonV1 | undefined> {
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

    const skeleton = deriveSkeleton(input.heroId, profileSnapshots.map((entry) => entry.payload));
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

  private getCurrentSkeleton(input: RebuildConsensusSkeletonInputV1): ConsensusSkeletonV1 | undefined {
    const current = this.store.getActive({
      dataset: 'CONSENSUS_SKELETON',
      rulesetVersion: input.rulesetVersion,
      catalogSha256: input.catalogSha256,
      statlockerPatchId: input.statlockerPatchId,
      scopeKey: `hero:${input.heroId}:consensus`,
    });
    return asSkeleton(current?.payload, input.heroId);
  }
}

export function deriveSkeleton(
  heroId: number,
  profiles: readonly StatlockerProBuildAnalysisV1[],
): ConsensusSkeletonV1 {
  const selected = [...profiles]
    .filter((profile) => profile.heroId === heroId)
    .sort((a, b) => a.accountId.localeCompare(b.accountId))
    .slice(0, MAX_PROFILES);
  const itemIds = [...new Set(selected.flatMap((profile) => profile.items.map((item) => item.itemId)))].sort((a, b) => a - b);
  const items = itemIds.map((itemId) => deriveItem(itemId, selected));
  items.sort((a, b) => a.medianBuyTimeS - b.medianBuyTimeS || a.itemId - b.itemId);
  return { heroId, profileCount: selected.length, items };
}

function deriveItem(itemId: number, profiles: readonly StatlockerProBuildAnalysisV1[]): ConsensusSkeletonItemV1 {
  const observed: StatlockerProBuildItemV1[] = [];
  for (const profile of profiles) {
    const item = profile.items.find((candidate) => candidate.itemId === itemId);
    if (item) observed.push(item);
  }

  const coverage = ratio(observed.length, profiles.length);
  const purchaseRate = average(observed.map((item) => clamp01(item.purchaseRate)));
  const frequencyTier = average(observed.map((item) => frequencyScore(item.frequencyTier)));
  const buyTimes = observed.map((item) => Math.max(0, item.medianBuyTimeS)).sort((a, b) => a - b);
  const medianBuyTimeS = median(buyTimes);
  const meanAbsoluteDeviation = average(buyTimes.map((value) => Math.abs(value - medianBuyTimeS)));
  const orderConsistency = clamp01(1 - meanAbsoluteDeviation / Math.max(300, medianBuyTimeS || 300));
  const relationship = average(observed.map((item) => {
    if (item.relationships.length === 0) return 0;
    return Math.max(...item.relationships.map((entry) => clamp01(entry.strength)));
  }));
  const components = { coverage, purchaseRate, frequencyTier, orderConsistency, relationship };
  const strength = clamp01(
    components.coverage * COMPONENT_WEIGHTS.coverage +
    components.purchaseRate * COMPONENT_WEIGHTS.purchaseRate +
    components.frequencyTier * COMPONENT_WEIGHTS.frequencyTier +
    components.orderConsistency * COMPONENT_WEIGHTS.orderConsistency +
    components.relationship * COMPONENT_WEIGHTS.relationship,
  );

  return {
    itemId,
    medianBuyTimeS,
    strength,
    tier: classifyTier(coverage, strength),
    components,
  };
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

function asSkeleton(value: unknown, heroId: number): ConsensusSkeletonV1 | undefined {
  if (!isRecord(value) || value.heroId !== heroId || !Number.isInteger(value.profileCount) || !Array.isArray(value.items)) return undefined;
  return value as unknown as ConsensusSkeletonV1;
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
