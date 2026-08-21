export const DIRECT_SHOP_SOURCE_ALLOWLIST_ENV = 'RECOMMENDATION_DIRECT_SHOP_SOURCE_ALLOWLIST' as const;

export function directShopSourceApprovalKey(source: string, sourceField: string): string {
  return `${source.trim()}:${sourceField.trim()}`;
}

export function parseDirectShopSourceAllowlist(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function configuredDirectShopSourceAllowlist(): readonly string[] {
  return [...parseDirectShopSourceAllowlist(process.env[DIRECT_SHOP_SOURCE_ALLOWLIST_ENV])].sort();
}
