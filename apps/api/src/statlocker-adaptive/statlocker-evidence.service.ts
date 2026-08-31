import { Injectable } from '@nestjs/common';
import { AdaptiveEvidenceFreshnessV1 } from '@deadlock-live-probe/shared';
import {
  StatlockerDatasetV1,
  StatlockerEvidenceFamilyV1,
  StatlockerNormalizedPayloadV1,
} from './statlocker-adaptive.types';
import { StatlockerRefreshService } from './statlocker-refresh.service';
import {
  StatlockerSnapshotStoreService,
  StatlockerStoredSnapshotV1,
} from './statlocker-snapshot-store.service';

export type AdaptiveScoringDatasetV1 =
  | 'WPA_PATCH_DATA'
  | 'VS_HERO_WPA'
  | 'T4_CHAINS'
  | 'CONSENSUS_SKELETON'
  | 'WPA_FILTERED_ITEMS';

export interface StatlockerEvidenceRequestV1 {
  heroId: number;
  rulesetVersion: string;
  catalogSha256: string;
  statlockerPatchId: string;
  nowMs?: number;
}

export interface StatlockerEvidenceBundleV1 {
  heroId: number;
  rulesetVersion: string;
  catalogSha256: string;
  statlockerPatchId: string;
  usable: boolean;
  snapshotIds: readonly string[];
  degradedReasons: readonly string[];
  families: readonly StatlockerEvidenceFamilyV1[];
  byDataset: Record<AdaptiveScoringDatasetV1, StatlockerEvidenceFamilyV1>;
}

interface FreshnessPolicyV1 {
  refreshAfterMs: number;
  maxStaleAgeMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const POLICIES: Record<AdaptiveScoringDatasetV1, FreshnessPolicyV1> = {
  WPA_PATCH_DATA: { refreshAfterMs: 30 * MINUTE, maxStaleAgeMs: 4 * HOUR },
  VS_HERO_WPA: { refreshAfterMs: 30 * MINUTE, maxStaleAgeMs: 4 * HOUR },
  T4_CHAINS: { refreshAfterMs: 30 * MINUTE, maxStaleAgeMs: 4 * HOUR },
  CONSENSUS_SKELETON: { refreshAfterMs: 60 * MINUTE, maxStaleAgeMs: 12 * HOUR },
  WPA_FILTERED_ITEMS: { refreshAfterMs: 30 * MINUTE, maxStaleAgeMs: 4 * HOUR },
};

const DATASET_ORDER: readonly AdaptiveScoringDatasetV1[] = [
  'WPA_PATCH_DATA',
  'VS_HERO_WPA',
  'T4_CHAINS',
  'CONSENSUS_SKELETON',
  'WPA_FILTERED_ITEMS',
];

@Injectable()
export class StatlockerEvidenceService {
  constructor(
    private readonly store: StatlockerSnapshotStoreService,
    private readonly refresh: StatlockerRefreshService,
  ) {}

  getEvidence(input: StatlockerEvidenceRequestV1): StatlockerEvidenceBundleV1 {
    validateRequest(input);
    const nowMs = input.nowMs ?? Date.now();
    const rows = this.store.listActive();
    const byDataset = {} as Record<AdaptiveScoringDatasetV1, StatlockerEvidenceFamilyV1>;

    for (const dataset of DATASET_ORDER) {
      byDataset[dataset] = this.resolveFamily(dataset, scopeFor(dataset, input), input, rows, nowMs);
    }

    const families = DATASET_ORDER.map((dataset) => byDataset[dataset]);
    const snapshotIds = families
      .filter((family) => family.payload !== undefined && family.snapshotId !== undefined)
      .map((family) => family.snapshotId as string)
      .sort();
    const degradedReasons = families
      .filter((family) => family.freshness !== 'FRESH' && family.dataset !== 'WPA_FILTERED_ITEMS')
      .map((family) => `${family.dataset}:${family.freshness}`)
      .sort();
    const usable = families.some((family) =>
      family.dataset !== 'WPA_FILTERED_ITEMS' &&
      (family.freshness === 'FRESH' || family.freshness === 'STALE_USABLE') &&
      family.payload !== undefined,
    );

    this.refresh.observeGameIdentity({
      rulesetVersion: input.rulesetVersion,
      catalogSha256: input.catalogSha256,
    }, nowMs);
    if (needsGlobalRefresh(byDataset)) {
      void this.refresh.refreshGlobalNow(false, nowMs).catch(() => undefined);
    }
    if (needsHeroRefresh(byDataset.CONSENSUS_SKELETON)) {
      this.refresh.enqueueHeroRefresh(input.heroId, nowMs);
    }

    return {
      heroId: input.heroId,
      rulesetVersion: input.rulesetVersion,
      catalogSha256: input.catalogSha256.toLowerCase(),
      statlockerPatchId: input.statlockerPatchId,
      usable,
      snapshotIds,
      degradedReasons,
      families,
      byDataset,
    };
  }

  private resolveFamily(
    dataset: AdaptiveScoringDatasetV1,
    scopeKey: string,
    input: StatlockerEvidenceRequestV1,
    rows: readonly StatlockerStoredSnapshotV1[],
    nowMs: number,
  ): StatlockerEvidenceFamilyV1 {
    const candidates = rows
      .filter((row) => row.dataset === dataset && row.scopeKey === scopeKey)
      .sort(compareNewest);
    const exact = candidates.find((row) =>
      row.rulesetVersion === input.rulesetVersion &&
      row.catalogSha256.toLowerCase() === input.catalogSha256.toLowerCase() &&
      row.statlockerPatchId === input.statlockerPatchId,
    );

    if (exact) return familyFromExact(dataset, exact, POLICIES[dataset], nowMs);
    if (candidates.length > 0) {
      const mismatch = candidates[0];
      return {
        dataset,
        scopeKey,
        snapshotId: mismatch.snapshotId,
        contentSha256: mismatch.contentSha256,
        fetchedAt: mismatch.fetchedAt.toISOString(),
        freshness: 'PATCH_MISMATCH',
        confidence: 0,
      };
    }

    return {
      dataset,
      scopeKey,
      freshness: 'UNAVAILABLE',
      confidence: 0,
    };
  }
}

function familyFromExact(
  dataset: AdaptiveScoringDatasetV1,
  snapshot: StatlockerStoredSnapshotV1,
  policy: FreshnessPolicyV1,
  nowMs: number,
): StatlockerEvidenceFamilyV1 {
  const ageMs = Math.max(0, nowMs - snapshot.fetchedAt.getTime());
  const freshness = classifyFreshness(ageMs, policy);
  const confidence = freshnessConfidence(ageMs, policy, freshness);
  const canUse = freshness === 'FRESH' || freshness === 'STALE_USABLE';
  return {
    dataset,
    scopeKey: snapshot.scopeKey,
    snapshotId: snapshot.snapshotId,
    contentSha256: snapshot.contentSha256,
    fetchedAt: snapshot.fetchedAt.toISOString(),
    freshness,
    confidence,
    payload: canUse ? snapshot.payload as unknown as StatlockerNormalizedPayloadV1 : undefined,
  };
}

function classifyFreshness(ageMs: number, policy: FreshnessPolicyV1): AdaptiveEvidenceFreshnessV1 {
  if (ageMs <= policy.refreshAfterMs) return 'FRESH';
  if (ageMs <= policy.maxStaleAgeMs) return 'STALE_USABLE';
  return 'UNAVAILABLE';
}

function freshnessConfidence(
  ageMs: number,
  policy: FreshnessPolicyV1,
  freshness: AdaptiveEvidenceFreshnessV1,
): number {
  if (freshness === 'FRESH') return 1;
  if (freshness !== 'STALE_USABLE') return 0;
  const width = Math.max(1, policy.maxStaleAgeMs - policy.refreshAfterMs);
  const remaining = clamp01((policy.maxStaleAgeMs - ageMs) / width);
  return 0.25 + 0.75 * remaining;
}

function scopeFor(dataset: AdaptiveScoringDatasetV1, input: StatlockerEvidenceRequestV1): string {
  if (dataset === 'WPA_PATCH_DATA') return `patch:${input.statlockerPatchId}`;
  if (dataset === 'VS_HERO_WPA' || dataset === 'T4_CHAINS') return 'global';
  if (dataset === 'CONSENSUS_SKELETON') return `hero:${input.heroId}:consensus`;
  return `hero:${input.heroId}`;
}

function needsGlobalRefresh(byDataset: Record<AdaptiveScoringDatasetV1, StatlockerEvidenceFamilyV1>): boolean {
  return ['WPA_PATCH_DATA', 'VS_HERO_WPA', 'T4_CHAINS'].some((dataset) =>
    needsRefresh(byDataset[dataset as AdaptiveScoringDatasetV1]),
  );
}

function needsHeroRefresh(family: StatlockerEvidenceFamilyV1): boolean {
  return needsRefresh(family);
}

function needsRefresh(family: StatlockerEvidenceFamilyV1): boolean {
  return family.freshness !== 'FRESH';
}

function compareNewest(a: StatlockerStoredSnapshotV1, b: StatlockerStoredSnapshotV1): number {
  return b.fetchedAt.getTime() - a.fetchedAt.getTime() || a.snapshotId.localeCompare(b.snapshotId);
}

function validateRequest(input: StatlockerEvidenceRequestV1): void {
  if (!Number.isInteger(input.heroId) || input.heroId <= 0) throw new Error('Invalid evidence heroId');
  if (!input.rulesetVersion || !/^[a-f0-9]{64}$/i.test(input.catalogSha256) || !input.statlockerPatchId) {
    throw new Error('Invalid evidence identity');
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
