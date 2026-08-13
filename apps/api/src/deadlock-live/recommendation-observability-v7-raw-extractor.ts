import type { RecommendationObservabilityV7SnapshotInput } from './recommendation-observability-v7-telemetry';

export interface RecommendationObservabilityV7RawTimelinePayload {
  entity_type?: string;
  steam_id?: string | number;
  hero_id?: number;
  game_time?: number;
  spendable_souls?: number;
  current_souls?: number;
  unspent_souls?: number;
  shop_available?: boolean;
  shop_type?: string;
  alive?: boolean;
  occupied_slots?: unknown;
  flex_slots_unlocked?: number;
  last_purchase_game_time_s?: number;
  last_inventory_mutation_game_time_s?: number;
  ruleset_id?: string | number;
  item_availability_version?: string | number;
  position?: unknown;
}

export function extractRecommendationObservabilityV7FromTimelinePayload(
  matchId: string,
  payload: RecommendationObservabilityV7RawTimelinePayload,
): RecommendationObservabilityV7SnapshotInput | undefined {
  if (
    !matchId.trim() ||
    !['player_controller', 'player_pawn'].includes(payload.entity_type ?? '') ||
    payload.steam_id === undefined ||
    !Number.isSafeInteger(payload.hero_id) ||
    (payload.hero_id ?? 0) <= 0 ||
    !Number.isFinite(payload.game_time) ||
    (payload.game_time ?? -1) < 0
  ) {
    return undefined;
  }

  const spendableSouls = firstDirectCurrency(payload);
  const occupiedSlots = normalizeOccupiedSlots(payload.occupied_slots);
  const position = normalizePosition(payload.position);
  const snapshot: RecommendationObservabilityV7SnapshotInput = {
    matchId: matchId.trim(),
    steamId: String(payload.steam_id),
    heroId: payload.hero_id as number,
    gameTimeS: payload.game_time as number,
    source: 'SERVER_STATE_DIRECT',
    ...(spendableSouls === undefined ? {} : { spendableSouls }),
    ...(payload.shop_available === undefined
      ? {}
      : { shopAvailable: payload.shop_available }),
    ...(payload.shop_type === undefined
      ? {}
      : { shopType: normalizeShopType(payload.shop_type) }),
    ...(payload.alive === undefined ? {} : { alive: payload.alive }),
    ...(occupiedSlots === undefined ? {} : { occupiedSlots }),
    ...(payload.flex_slots_unlocked === undefined
      ? {}
      : { flexSlotsUnlocked: payload.flex_slots_unlocked }),
    ...(payload.last_purchase_game_time_s === undefined
      ? {}
      : { lastPurchaseGameTimeS: payload.last_purchase_game_time_s }),
    ...(payload.last_inventory_mutation_game_time_s === undefined
      ? {}
      : {
          lastInventoryMutationGameTimeS:
            payload.last_inventory_mutation_game_time_s,
        }),
    ...(payload.ruleset_id === undefined
      ? {}
      : { rulesetId: String(payload.ruleset_id) }),
    ...(payload.item_availability_version === undefined
      ? {}
      : {
          itemAvailabilityVersion: String(
            payload.item_availability_version,
          ),
        }),
    ...(position === undefined ? {} : { position }),
  };

  return hasUsefulObservation(snapshot) ? snapshot : undefined;
}

function firstDirectCurrency(
  payload: RecommendationObservabilityV7RawTimelinePayload,
): number | undefined {
  for (const value of [
    payload.spendable_souls,
    payload.current_souls,
    payload.unspent_souls,
  ]) {
    if (Number.isSafeInteger(value) && (value ?? -1) >= 0) return value;
  }
  return undefined;
}

function normalizeShopType(value: string): 'BASE' | 'SECRET' | 'ANY' | 'UNKNOWN' {
  const normalized = value.trim().toUpperCase();
  if (normalized.includes('SECRET')) return 'SECRET';
  if (normalized.includes('BASE')) return 'BASE';
  if (normalized === 'ANY') return 'ANY';
  return 'UNKNOWN';
}

function normalizeOccupiedSlots(
  value: unknown,
): RecommendationObservabilityV7SnapshotInput['occupiedSlots'] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const slotOrder = Number(record.slotOrder ?? record.slot_order);
    const itemId = Number(record.itemId ?? record.item_id);
    if (
      !Number.isSafeInteger(slotOrder) ||
      slotOrder < 0 ||
      !Number.isSafeInteger(itemId) ||
      itemId <= 0
    ) {
      continue;
    }
    result.push({
      slotOrder,
      itemId,
      ...(record.slotType === undefined && record.slot_type === undefined
        ? {}
        : { slotType: String(record.slotType ?? record.slot_type) }),
    });
  }
  return result.length > 0 ? result : undefined;
}

function normalizePosition(
  value: unknown,
): RecommendationObservabilityV7SnapshotInput['position'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const z = Number(record.z);
  if (![x, y, z].every(Number.isFinite)) return undefined;
  return { x, y, z };
}

function hasUsefulObservation(
  snapshot: RecommendationObservabilityV7SnapshotInput,
): boolean {
  return [
    snapshot.spendableSouls,
    snapshot.shopAvailable,
    snapshot.shopType,
    snapshot.alive,
    snapshot.occupiedSlots,
    snapshot.flexSlotsUnlocked,
    snapshot.lastPurchaseGameTimeS,
    snapshot.lastInventoryMutationGameTimeS,
    snapshot.rulesetId,
    snapshot.itemAvailabilityVersion,
    snapshot.position,
  ].some((value) => value !== undefined);
}
