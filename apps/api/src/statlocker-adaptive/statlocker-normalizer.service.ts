import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  StatlockerFrequencyTierV1,
  StatlockerHeroLeaderboardV1,
  StatlockerNormalizedDatasetV1,
  StatlockerPatchControlV1,
  StatlockerProBuildAnalysisV1,
  StatlockerProBuildItemV1,
  StatlockerT4ChainV1,
  StatlockerT4ChainsV1,
  StatlockerVsHeroItemV1,
  StatlockerVsHeroSliceV1,
  StatlockerVsHeroWpaV1,
  StatlockerWpaFilteredItemsV1,
  StatlockerWpaItemV1,
  StatlockerWpaPatchDataV1,
} from './statlocker-adaptive.types';

export class StatlockerDatasetValidationError extends Error {
  constructor(public readonly dataset: string, message: string) {
    super(`${dataset}: ${message}`);
    this.name = 'StatlockerDatasetValidationError';
  }
}

@Injectable()
export class StatlockerNormalizerService {
  normalizePatches(raw: unknown): StatlockerPatchControlV1 {
    const root = requireRecord(raw, 'WPA_PATCHES', 'root');
    const current = requireString(root.current_minor_patch_id ?? root.currentMinorPatchId, 'WPA_PATCHES', 'current minor patch');
    const patches = requireArray(root.patches, 'WPA_PATCHES', 'patches')
      .map((value) => {
        const row = requireRecord(value, 'WPA_PATCHES', 'patch');
        return requireString(row.minor_patch_id ?? row.minorPatchId ?? row.id, 'WPA_PATCHES', 'minor patch id');
      });
    const availableMinorPatchIds = [...new Set([current, ...patches])].sort();
    return { currentMinorPatchId: current, availableMinorPatchIds };
  }

  normalizeWpaPatchData(raw: unknown, statlockerPatchId: string): StatlockerNormalizedDatasetV1<StatlockerWpaPatchDataV1> {
    const root = requireRecord(raw, 'WPA_PATCH_DATA', 'root');
    const patchId = requireString(root.patch ?? root.patch_id ?? root.patchId, 'WPA_PATCH_DATA', 'patch');
    if (patchId !== statlockerPatchId) throw new StatlockerDatasetValidationError('WPA_PATCH_DATA', `patch mismatch ${patchId}`);
    const items = requireArray(root.items, 'WPA_PATCH_DATA', 'items').map((row) => parseWpaItem(row, 'WPA_PATCH_DATA'));
    if (items.length === 0) throw new StatlockerDatasetValidationError('WPA_PATCH_DATA', 'items must not be empty');
    items.sort((a, b) => a.heroId - b.heroId || a.itemId - b.itemId);
    return wrap('WPA_PATCH_DATA', `patch:${patchId}`, statlockerPatchId, { patchId, items });
  }

  normalizeVsHeroWpa(raw: unknown, statlockerPatchId: string): StatlockerNormalizedDatasetV1<StatlockerVsHeroWpaV1> {
    const root = requireRecord(raw, 'VS_HERO_WPA', 'root');
    const source = root.data ?? root.slices ?? root.matchups;
    const slices = requireArray(source, 'VS_HERO_WPA', 'data').map((row) => parseVsHeroSlice(row));
    if (slices.length === 0 || slices.every((slice) => slice.items.length === 0)) {
      throw new StatlockerDatasetValidationError('VS_HERO_WPA', 'primary exact-enemy data must not be empty');
    }
    slices.sort((a, b) => a.heroId - b.heroId || a.enemyHeroId - b.enemyHeroId);
    return wrap('VS_HERO_WPA', 'global', statlockerPatchId, { slices });
  }

  normalizeT4Chains(raw: unknown, statlockerPatchId: string): StatlockerNormalizedDatasetV1<StatlockerT4ChainsV1> {
    const root = requireRecord(raw, 'T4_CHAINS', 'root');
    const byHero = requireRecord(root.by_hero ?? root.byHero, 'T4_CHAINS', 'by_hero');
    const chains: StatlockerT4ChainV1[] = [];
    for (const [heroKey, rawChains] of Object.entries(byHero)) {
      const heroId = parsePositiveInt(Number(heroKey), 'T4_CHAINS', 'hero id');
      for (const rawChain of requireArray(rawChains, 'T4_CHAINS', `hero ${heroKey}`)) {
        const row = requireRecord(rawChain, 'T4_CHAINS', 'chain');
        const itemIds = requireArray(row.item_ids ?? row.itemIds, 'T4_CHAINS', 'item ids')
          .map((itemId) => parsePositiveInt(itemId, 'T4_CHAINS', 'item id'));
        if (itemIds.length !== 2 && itemIds.length !== 3) continue;
        chains.push({
          heroId,
          itemIds,
          sampleSize: parseNonNegativeFinite(row.sample_size ?? row.sampleSize, 'T4_CHAINS', 'sample size'),
          meanWpa: optionalFinite(row.mean_wpa ?? row.meanWpa, 'T4_CHAINS', 'mean wpa'),
        });
      }
    }
    if (chains.length === 0) throw new StatlockerDatasetValidationError('T4_CHAINS', 'no 2/3-item chains');
    chains.sort((a, b) => a.heroId - b.heroId || compareNumberArrays(a.itemIds, b.itemIds));
    return wrap('T4_CHAINS', 'global', statlockerPatchId, { chains });
  }

  normalizeHeroLeaderboard(
    raw: unknown,
    statlockerPatchId: string,
    heroId: number,
  ): StatlockerNormalizedDatasetV1<StatlockerHeroLeaderboardV1> {
    const root = requireRecord(raw, 'HERO_LEADERBOARD', 'root');
    const responseHeroId = optionalPositiveInt(root.hero_id ?? root.heroId, 'HERO_LEADERBOARD', 'hero id') ?? heroId;
    if (responseHeroId !== heroId) throw new StatlockerDatasetValidationError('HERO_LEADERBOARD', 'hero mismatch');
    const profiles = requireArray(root.leaderboard ?? root.players ?? root.data, 'HERO_LEADERBOARD', 'leaderboard')
      .map((value) => {
        const row = requireRecord(value, 'HERO_LEADERBOARD', 'profile');
        return {
          accountId: requireString(row.account_id ?? row.accountId, 'HERO_LEADERBOARD', 'account id'),
          heroId,
          rank: parsePositiveInt(row.rank, 'HERO_LEADERBOARD', 'rank'),
          playerName: optionalString(row.player_name ?? row.playerName),
        };
      });
    if (profiles.length === 0) throw new StatlockerDatasetValidationError('HERO_LEADERBOARD', 'leaderboard must not be empty');
    profiles.sort((a, b) => a.rank - b.rank || a.accountId.localeCompare(b.accountId));
    return wrap('HERO_LEADERBOARD', `hero:${heroId}`, statlockerPatchId, { heroId, profiles });
  }

  normalizeProBuildAnalysis(
    raw: unknown,
    statlockerPatchId: string,
    accountId: string,
    heroId: number,
  ): StatlockerNormalizedDatasetV1<StatlockerProBuildAnalysisV1> {
    const root = requireRecord(raw, 'PRO_BUILD_ANALYSIS', 'root');
    const responseAccount = requireString(root.account_id ?? root.accountId, 'PRO_BUILD_ANALYSIS', 'account id');
    const responseHero = parsePositiveInt(root.hero_id ?? root.heroId, 'PRO_BUILD_ANALYSIS', 'hero id');
    if (responseAccount !== accountId || responseHero !== heroId) {
      throw new StatlockerDatasetValidationError('PRO_BUILD_ANALYSIS', 'profile scope mismatch');
    }
    const items: StatlockerProBuildItemV1[] = requireArray(root.items ?? root.build, 'PRO_BUILD_ANALYSIS', 'items')
      .map((value) => parseProBuildItem(value));
    if (items.length === 0) throw new StatlockerDatasetValidationError('PRO_BUILD_ANALYSIS', 'items must not be empty');
    items.sort((a, b) => a.medianBuyTimeS - b.medianBuyTimeS || a.itemId - b.itemId);
    return wrap('PRO_BUILD_ANALYSIS', `hero:${heroId}:account:${accountId}`, statlockerPatchId, {
      accountId,
      heroId,
      items,
    });
  }

  normalizeWpaFilteredItems(
    raw: unknown,
    statlockerPatchId: string,
    heroId: number,
  ): StatlockerNormalizedDatasetV1<StatlockerWpaFilteredItemsV1> {
    const root = requireRecord(raw, 'WPA_FILTERED_ITEMS', 'root');
    const responseHero = optionalPositiveInt(root.hero_id ?? root.heroId, 'WPA_FILTERED_ITEMS', 'hero id') ?? heroId;
    if (responseHero !== heroId) throw new StatlockerDatasetValidationError('WPA_FILTERED_ITEMS', 'hero mismatch');
    const items = requireArray(root.items, 'WPA_FILTERED_ITEMS', 'items')
      .map((row) => parseWpaItem(row, 'WPA_FILTERED_ITEMS', heroId));
    if (items.length === 0) throw new StatlockerDatasetValidationError('WPA_FILTERED_ITEMS', 'items must not be empty');
    items.sort((a, b) => a.itemId - b.itemId);
    return wrap('WPA_FILTERED_ITEMS', `hero:${heroId}`, statlockerPatchId, { heroId, items });
  }
}

function parseWpaItem(raw: unknown, dataset: string, fallbackHeroId?: number): StatlockerWpaItemV1 {
  const row = requireRecord(raw, dataset, 'item');
  const heroId = optionalPositiveInt(row.hero_id ?? row.heroId, dataset, 'hero id') ?? fallbackHeroId;
  if (!heroId) throw new StatlockerDatasetValidationError(dataset, 'hero id is required');
  return {
    heroId,
    itemId: parsePositiveInt(row.item_id ?? row.itemId, dataset, 'item id'),
    meanWpa: parseFinite(row.mean_wpa ?? row.meanWpa, dataset, 'mean wpa'),
    sampleSize: parseNonNegativeFinite(row.sample_size ?? row.sampleSize, dataset, 'sample size'),
    wpaConfidence: optionalFinite(row.wpa_confidence ?? row.wpaConfidence, dataset, 'wpa confidence'),
    gameState: {
      ahead: optionalFinite(row.ahead_wpa ?? row.aheadWpa, dataset, 'ahead wpa'),
      even: optionalFinite(row.even_wpa ?? row.evenWpa, dataset, 'even wpa'),
      behind: optionalFinite(row.behind_wpa ?? row.behindWpa, dataset, 'behind wpa'),
    },
    purchaseTiming: {
      medianPurchaseSec: optionalFinite(
        row.median_purchase_time_s ?? row.medianPurchaseTimeS ?? row.median_buy_time_s,
        dataset,
        'median purchase time',
      ),
      earlyWpa: optionalFinite(row.early_wpa ?? row.earlyWpa, dataset, 'early wpa'),
      midWpa: optionalFinite(row.mid_wpa ?? row.midWpa, dataset, 'mid wpa'),
      lateWpa: optionalFinite(row.late_wpa ?? row.lateWpa, dataset, 'late wpa'),
    },
    laneWpa: optionalFinite(row.lane_wpa ?? row.laneWpa, dataset, 'lane wpa'),
    postLaneWpa: optionalFinite(row.post_lane_wpa ?? row.postLaneWpa, dataset, 'post lane wpa'),
    enemyComposition: optionalNumericRecord(row.enemy_composition ?? row.enemyComposition, dataset, 'enemy composition'),
    ownBuild: optionalNumericRecord(row.build_breakdown ?? row.own_build ?? row.ownBuild, dataset, 'build breakdown'),
  };
}

function parseVsHeroSlice(raw: unknown): StatlockerVsHeroSliceV1 {
  const row = requireRecord(raw, 'VS_HERO_WPA', 'slice');
  const items: StatlockerVsHeroItemV1[] = requireArray(row.items, 'VS_HERO_WPA', 'items').map((value) => {
    const item = requireRecord(value, 'VS_HERO_WPA', 'item');
    return {
      itemId: parsePositiveInt(item.item_id ?? item.itemId, 'VS_HERO_WPA', 'item id'),
      deltaWpa: parseFinite(item.delta_wpa ?? item.deltaWpa, 'VS_HERO_WPA', 'delta wpa'),
      count: parseNonNegativeFinite(item.count ?? item.sample_size, 'VS_HERO_WPA', 'count'),
    };
  });
  items.sort((a, b) => a.itemId - b.itemId);
  return {
    heroId: parsePositiveInt(row.hero_id ?? row.heroId, 'VS_HERO_WPA', 'hero id'),
    enemyHeroId: parsePositiveInt(row.vs_hero_id ?? row.enemy_hero_id ?? row.enemyHeroId, 'VS_HERO_WPA', 'enemy hero id'),
    items,
  };
}

function parseProBuildItem(raw: unknown): StatlockerProBuildItemV1 {
  const row = requireRecord(raw, 'PRO_BUILD_ANALYSIS', 'item');
  const frequencyTier = normalizeFrequencyTier(
    requireString(row.frequencyTier ?? row.frequency_tier, 'PRO_BUILD_ANALYSIS', 'frequency tier'),
  );
  const relationships = Array.isArray(row.relationships)
    ? row.relationships.map((value) => {
        const relationship = requireRecord(value, 'PRO_BUILD_ANALYSIS', 'relationship');
        return {
          itemId: parsePositiveInt(relationship.itemId ?? relationship.item_id, 'PRO_BUILD_ANALYSIS', 'relationship item id'),
          strength: parseFinite(relationship.strength, 'PRO_BUILD_ANALYSIS', 'relationship strength'),
        };
      }).sort((a, b) => a.itemId - b.itemId)
    : [];
  return {
    itemId: parsePositiveInt(row.item_id ?? row.itemId, 'PRO_BUILD_ANALYSIS', 'item id'),
    purchaseRate: parseFinite(row.purchaseRate ?? row.purchase_rate, 'PRO_BUILD_ANALYSIS', 'purchase rate'),
    medianBuyTimeS: parseNonNegativeFinite(row.medianBuyTimeS ?? row.median_buy_time_s, 'PRO_BUILD_ANALYSIS', 'median buy time'),
    frequencyTier,
    phase: requireString(row.phase, 'PRO_BUILD_ANALYSIS', 'phase'),
    relationships,
  };
}

function normalizeFrequencyTier(value: string): StatlockerFrequencyTierV1 {
  const normalized = value.trim().toUpperCase();
  if (normalized === 'CORE' || normalized === 'FREQUENT' || normalized === 'SOMETIMES' || normalized === 'FLEX') {
    return normalized;
  }
  throw new StatlockerDatasetValidationError('PRO_BUILD_ANALYSIS', `unsupported frequency tier ${value}`);
}

function wrap<T extends StatlockerWpaPatchDataV1 | StatlockerVsHeroWpaV1 | StatlockerT4ChainsV1 | StatlockerHeroLeaderboardV1 | StatlockerProBuildAnalysisV1 | StatlockerWpaFilteredItemsV1>(
  dataset: StatlockerNormalizedDatasetV1<T>['dataset'],
  scopeKey: string,
  statlockerPatchId: string,
  payload: T,
): StatlockerNormalizedDatasetV1<T> {
  return {
    dataset,
    scopeKey,
    statlockerPatchId,
    contentSha256: createHash('sha256').update(stableJson(payload)).digest('hex'),
    payload,
  };
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) result[key] = stableValue(value[key]);
  return result;
}

function requireRecord(value: unknown, dataset: string, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new StatlockerDatasetValidationError(dataset, `${label} must be an object`);
  return value;
}

function requireArray(value: unknown, dataset: string, label: string): unknown[] {
  if (!Array.isArray(value)) throw new StatlockerDatasetValidationError(dataset, `${label} must be an array`);
  return value;
}

function requireString(value: unknown, dataset: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new StatlockerDatasetValidationError(dataset, `${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function parseFinite(value: unknown, dataset: string, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new StatlockerDatasetValidationError(dataset, `${label} must be finite`);
  }
  return value;
}

function optionalFinite(value: unknown, dataset: string, label: string): number | undefined {
  if (value === undefined) return undefined;
  return parseFinite(value, dataset, label);
}

function parseNonNegativeFinite(value: unknown, dataset: string, label: string): number {
  const number = parseFinite(value, dataset, label);
  if (number < 0) throw new StatlockerDatasetValidationError(dataset, `${label} must be non-negative`);
  return number;
}

function parsePositiveInt(value: unknown, dataset: string, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new StatlockerDatasetValidationError(dataset, `${label} must be a positive integer`);
  }
  return value;
}

function optionalPositiveInt(value: unknown, dataset: string, label: string): number | undefined {
  if (value === undefined) return undefined;
  return parsePositiveInt(value, dataset, label);
}

function optionalNumericRecord(
  value: unknown,
  dataset: string,
  label: string,
): Readonly<Record<string, number>> | undefined {
  if (value === undefined) return undefined;
  const source = requireRecord(value, dataset, label);
  const result: Record<string, number> = {};
  for (const key of Object.keys(source).sort()) result[key] = parseFinite(source[key], dataset, `${label}.${key}`);
  return result;
}

function compareNumberArrays(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
