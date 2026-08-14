const MAX_ACCOUNT_ID = 0xffffffff;

export interface RecommendationObservabilityV7DirectIdentityIndex {
  byHeroId: Map<number, number>;
  conflictingHeroCount: number;
  playerWithAccountIdCount: number;
}

export function buildRecommendationObservabilityV7DirectIdentityIndex(
  payload: Record<string, unknown>,
): RecommendationObservabilityV7DirectIdentityIndex {
  const matchInfo = toRecord(payload.match_info);
  const players = Array.isArray(matchInfo?.players) ? matchInfo.players : [];
  const identitiesByHero = new Map<number, Set<number>>();
  let playerWithAccountIdCount = 0;

  for (const entry of players) {
    const player = toRecord(entry);
    const heroId = getPositiveSafeInteger(player, 'hero_id');
    const accountId = getPositiveSafeInteger(player, 'account_id');
    if (
      heroId === undefined ||
      accountId === undefined ||
      accountId > MAX_ACCOUNT_ID
    ) {
      continue;
    }
    playerWithAccountIdCount += 1;
    const values = identitiesByHero.get(heroId) ?? new Set<number>();
    values.add(accountId);
    identitiesByHero.set(heroId, values);
  }

  const byHeroId = new Map<number, number>();
  let conflictingHeroCount = 0;
  for (const [heroId, accountIds] of identitiesByHero) {
    if (accountIds.size !== 1) {
      conflictingHeroCount += 1;
      continue;
    }
    byHeroId.set(heroId, [...accountIds][0]);
  }

  return { byHeroId, conflictingHeroCount, playerWithAccountIdCount };
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getPositiveSafeInteger(
  record: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  if (!record) return undefined;
  const value = record[key];
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
