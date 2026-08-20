export const RECOMMENDATION_FEATURE_CONTRACT_VERSION = 'recommendation-features-v8' as const;

export interface RecommendationFeatureHistoryEventV8 {
  occurredAtMs: number;
  eventType: string;
  actionKey?: string;
  itemId?: number;
  value?: number;
}

export interface RecommendationFeatureInventoryItemV8 {
  itemId: number;
  slotType: 'weapon' | 'vitality' | 'spirit';
  active: boolean;
  acquiredAtMs?: number;
}

export interface RecommendationFeatureStateV8 {
  contractVersion: typeof RECOMMENDATION_FEATURE_CONTRACT_VERSION;
  decisionId: string;
  matchId: string;
  playerKey: string;
  decisionAtMs: number;
  stateSourceAtMs: number;
  gameTimeSec: number;
  heroId: number;
  teamId?: number;
  level?: number;
  healthFraction?: number;
  verifiedSpendableSouls?: number;
  spendableSoulsVerificationContract?: string;
  shopOpportunity: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  inventorySnapshotSha256: string;
  inventory: readonly RecommendationFeatureInventoryItemV8[];
  history: readonly RecommendationFeatureHistoryEventV8[];
  rulesetVersion: string;
  catalogSha256: string;
}

export interface RecommendationActionFeatureV8 {
  actionKey: string;
  actionType: 'WAIT_SAVE' | 'BUY_ITEM' | 'UPGRADE_ITEM' | 'SELL_ITEM' | 'REPLACE_ITEM';
  targetItemId?: number;
  sellItemId?: number;
  recipeId?: string;
  effectiveCostSouls: number;
}

export interface RecommendationFeatureValidationV8 {
  valid: boolean;
  errors: readonly string[];
}

export function validateRecommendationFeatureStateV8(
  state: RecommendationFeatureStateV8,
): RecommendationFeatureValidationV8 {
  const errors: string[] = [];
  if (state.contractVersion !== RECOMMENDATION_FEATURE_CONTRACT_VERSION) errors.push('FEATURE_CONTRACT_MISMATCH');
  if (!state.decisionId) errors.push('DECISION_ID_REQUIRED');
  if (!state.matchId) errors.push('MATCH_ID_REQUIRED');
  if (!state.playerKey) errors.push('PLAYER_KEY_REQUIRED');
  if (!Number.isFinite(state.decisionAtMs)) errors.push('DECISION_TIMESTAMP_INVALID');
  if (!Number.isFinite(state.stateSourceAtMs)) errors.push('STATE_SOURCE_TIMESTAMP_INVALID');
  if (state.stateSourceAtMs > state.decisionAtMs) errors.push('FUTURE_STATE_LEAKAGE');
  if (!Number.isFinite(state.gameTimeSec) || state.gameTimeSec < 0) errors.push('GAME_TIME_INVALID');
  if (!Number.isInteger(state.heroId) || state.heroId <= 0) errors.push('HERO_ID_INVALID');
  if (state.healthFraction !== undefined && (!Number.isFinite(state.healthFraction) || state.healthFraction < 0 || state.healthFraction > 1)) {
    errors.push('HEALTH_FRACTION_INVALID');
  }
  if (state.verifiedSpendableSouls !== undefined) {
    if (!Number.isFinite(state.verifiedSpendableSouls) || state.verifiedSpendableSouls < 0) errors.push('VERIFIED_SPENDABLE_SOULS_INVALID');
    if (!state.spendableSoulsVerificationContract) errors.push('SPENDABLE_SOULS_VERIFICATION_CONTRACT_REQUIRED');
  } else if (state.spendableSoulsVerificationContract) {
    errors.push('SPENDABLE_SOULS_VALUE_REQUIRED');
  }
  if (!isSha256(state.inventorySnapshotSha256)) errors.push('INVENTORY_SNAPSHOT_SHA_INVALID');
  if (!state.rulesetVersion) errors.push('RULESET_VERSION_REQUIRED');
  if (!isSha256(state.catalogSha256)) errors.push('CATALOG_SHA_INVALID');
  const itemIds = new Set<number>();
  for (const item of state.inventory) {
    if (!Number.isInteger(item.itemId) || item.itemId <= 0) errors.push(`INVENTORY_ITEM_ID_INVALID:${item.itemId}`);
    if (itemIds.has(item.itemId)) errors.push(`INVENTORY_DUPLICATE_ITEM:${item.itemId}`);
    itemIds.add(item.itemId);
    if (item.acquiredAtMs !== undefined && item.acquiredAtMs > state.decisionAtMs) {
      errors.push(`FUTURE_INVENTORY_ACQUISITION:${item.itemId}`);
    }
  }
  let previousHistoryTime = -Infinity;
  for (let index = 0; index < state.history.length; index += 1) {
    const event = state.history[index];
    if (!Number.isFinite(event.occurredAtMs)) errors.push(`HISTORY_TIMESTAMP_INVALID:${index}`);
    if (event.occurredAtMs >= state.decisionAtMs) errors.push(`NON_CAUSAL_HISTORY_EVENT:${index}`);
    if (event.occurredAtMs < previousHistoryTime) errors.push(`HISTORY_ORDER_INVALID:${index}`);
    previousHistoryTime = event.occurredAtMs;
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)].sort() };
}

export function recommendationStateTokensV8(state: RecommendationFeatureStateV8): string[] {
  const validation = validateRecommendationFeatureStateV8(state);
  if (!validation.valid) throw new Error(`Invalid recommendation feature state: ${validation.errors.join(',')}`);
  const tokens = [
    `HERO:${state.heroId}`,
    `TIME5M:${Math.floor(state.gameTimeSec / 300)}`,
    `SHOP:${state.shopOpportunity}`,
    `RULESET:${state.rulesetVersion}`,
  ];
  if (state.teamId !== undefined) tokens.push(`TEAM:${state.teamId}`);
  if (state.level !== undefined) tokens.push(`LEVEL3:${Math.floor(state.level / 3)}`);
  if (state.healthFraction !== undefined) tokens.push(`HEALTH10:${Math.min(9, Math.floor(state.healthFraction * 10))}`);
  if (state.verifiedSpendableSouls !== undefined) tokens.push(`WALLET800:${Math.floor(state.verifiedSpendableSouls / 800)}`);
  else tokens.push('WALLET:UNKNOWN');
  for (const item of [...state.inventory].sort((a, b) => a.itemId - b.itemId)) {
    tokens.push(`OWNED:${item.itemId}`);
  }
  return tokens;
}

export function recommendationActionTokensV8(action: RecommendationActionFeatureV8): string[] {
  const tokens = [`ACTION:${action.actionType}`, `ACTION_KEY:${action.actionKey}`];
  if (action.targetItemId !== undefined) tokens.push(`TARGET_ITEM:${action.targetItemId}`);
  if (action.sellItemId !== undefined) tokens.push(`SELL_ITEM:${action.sellItemId}`);
  if (action.recipeId !== undefined) tokens.push(`RECIPE:${action.recipeId}`);
  tokens.push(`COST800:${Math.trunc(action.effectiveCostSouls / 800)}`);
  return tokens;
}

export function recommendationHistoryTokensV8(
  state: RecommendationFeatureStateV8,
  maximumEvents = 64,
): string[] {
  if (!Number.isInteger(maximumEvents) || maximumEvents < 0) throw new Error('maximumEvents must be a non-negative integer');
  const validation = validateRecommendationFeatureStateV8(state);
  if (!validation.valid) throw new Error(`Invalid recommendation feature state: ${validation.errors.join(',')}`);
  return state.history.slice(Math.max(0, state.history.length - maximumEvents)).flatMap((event) => {
    const tokens = [`EVENT:${event.eventType}`];
    if (event.actionKey) tokens.push(`EVENT_ACTION:${event.actionKey}`);
    if (event.itemId !== undefined) tokens.push(`EVENT_ITEM:${event.itemId}`);
    return tokens;
  });
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}
