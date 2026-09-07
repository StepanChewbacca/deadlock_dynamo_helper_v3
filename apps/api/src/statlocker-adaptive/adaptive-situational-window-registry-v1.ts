import { AdaptiveSituationalPurposeV1 } from '@deadlock-live-probe/shared';

const PURPOSES: readonly AdaptiveSituationalPurposeV1[] = [
  'CATCH',
  'ANTI_CC',
  'CLEANSE',
  'ANTI_BULLET',
  'ANTI_SPIRIT',
  'ANTI_BURST',
  'ANTI_HEAL',
  'MOBILITY',
  'TEAM_UTILITY',
  'SURVIVAL',
];

export interface AdaptiveSituationalWindowRegistryEntryV1 {
  heroId: number;
  rulesetId: string;
  catalogSha256: string;
  windowId: string;
  purpose: AdaptiveSituationalPurposeV1;
  targetItemIds: readonly number[];
  maxItems: number;
  maxSoulsDelay: number;
  reservedSlots: number;
}

export function loadAdaptiveSituationalWindowRegistryV1(
  raw: string | undefined = process.env.ADAPTIVE_SITUATIONAL_WINDOWS_JSON,
): readonly AdaptiveSituationalWindowRegistryEntryV1[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const result: AdaptiveSituationalWindowRegistryEntryV1[] = [];
  for (const value of parsed) {
    const entry = parseEntry(value);
    if (!entry) return [];
    result.push(entry);
  }
  return result.sort((left, right) =>
    left.heroId - right.heroId ||
    left.rulesetId.localeCompare(right.rulesetId) ||
    left.catalogSha256.localeCompare(right.catalogSha256) ||
    left.windowId.localeCompare(right.windowId),
  );
}

export function resolveAdaptiveSituationalWindowsV1(
  registry: readonly AdaptiveSituationalWindowRegistryEntryV1[],
  heroId: number,
  rulesetId: string,
  catalogSha256: string,
): readonly AdaptiveSituationalWindowRegistryEntryV1[] {
  const sha = catalogSha256.toLowerCase();
  return registry.filter((entry) =>
    entry.heroId === heroId &&
    entry.rulesetId === rulesetId &&
    entry.catalogSha256 === sha,
  );
}

function parseEntry(value: unknown): AdaptiveSituationalWindowRegistryEntryV1 | undefined {
  if (!isRecord(value)) return undefined;
  if (!Number.isSafeInteger(value.heroId) || Number(value.heroId) <= 0) return undefined;
  if (typeof value.rulesetId !== 'string' || !value.rulesetId.trim()) return undefined;
  if (typeof value.catalogSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.catalogSha256)) return undefined;
  if (typeof value.windowId !== 'string' || !value.windowId.trim()) return undefined;
  if (!PURPOSES.includes(value.purpose as AdaptiveSituationalPurposeV1)) return undefined;
  if (!Array.isArray(value.targetItemIds) || value.targetItemIds.length === 0 ||
      !value.targetItemIds.every((itemId) => Number.isSafeInteger(itemId) && Number(itemId) > 0)) return undefined;
  if (!Number.isSafeInteger(value.maxItems) || Number(value.maxItems) <= 0) return undefined;
  if (!Number.isFinite(value.maxSoulsDelay) || Number(value.maxSoulsDelay) < 0) return undefined;
  if (!Number.isSafeInteger(value.reservedSlots) || Number(value.reservedSlots) <= 0) return undefined;

  return {
    heroId: Number(value.heroId),
    rulesetId: value.rulesetId.trim(),
    catalogSha256: value.catalogSha256.toLowerCase(),
    windowId: value.windowId.trim(),
    purpose: value.purpose as AdaptiveSituationalPurposeV1,
    targetItemIds: [...new Set(value.targetItemIds.map(Number))].sort((left, right) => left - right),
    maxItems: Math.min(Number(value.maxItems), value.targetItemIds.length),
    maxSoulsDelay: Number(value.maxSoulsDelay),
    reservedSlots: Number(value.reservedSlots),
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
