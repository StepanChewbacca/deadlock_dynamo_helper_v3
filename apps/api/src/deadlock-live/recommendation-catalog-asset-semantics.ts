export interface RecommendationCatalogAssetSemanticsInput {
  itemType?: string;
  activationType?: string;
  shopable?: boolean;
  disabled?: boolean;
  active?: boolean;
  isActiveItem?: boolean;
  rawPayload?: unknown;
}

export interface ResolvedRecommendationCatalogAssetSemantics {
  itemType: string;
  activationType?: string;
  shopable: boolean;
  disabled: boolean;
  active: boolean;
  isActiveItem: boolean;
}

export function resolveRecommendationCatalogAssetSemantics(
  input: RecommendationCatalogAssetSemanticsInput,
): ResolvedRecommendationCatalogAssetSemantics {
  const raw = isRecord(input.rawPayload) ? input.rawPayload : {};
  const disabled = input.disabled ?? rawBoolean(raw, 'disabled') ?? false;
  const active = input.active ?? rawBoolean(raw, 'active') ?? !disabled;

  return {
    itemType: input.itemType ?? rawString(raw, 'type') ?? rawString(raw, 'item_type') ?? 'unknown',
    activationType: input.activationType
      ?? rawString(raw, 'activation_type')
      ?? rawString(raw, 'activation')
      ?? rawString(raw, 'ability_activation'),
    shopable: input.shopable ?? rawBoolean(raw, 'shopable') ?? false,
    disabled,
    active,
    isActiveItem: input.isActiveItem ?? rawBoolean(raw, 'is_active_item') ?? false,
  };
}

function rawString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function rawBoolean(raw: Record<string, unknown>, key: string): boolean | undefined {
  const value = raw[key];
  return typeof value === 'boolean' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
