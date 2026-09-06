import {
  FactEvidence,
  InventorySlotType,
  ObservedFact,
  RecommendationCandidateGeneratorRules,
  RecommendationItemGraph,
  recommendationSlotUsageFor,
} from '@deadlock-live-probe/build-domain';

export type AdaptiveInvestmentTypeV1 = 'weapon' | 'vitality' | 'spirit';

export const ADAPTIVE_INVESTMENT_TYPES_V1: readonly AdaptiveInvestmentTypeV1[] = [
  'weapon',
  'vitality',
  'spirit',
];

export interface AdaptiveSlotStateV1 {
  baseSlots: number;
  baseSlotsByType: Readonly<Record<InventorySlotType, number>>;
  maxFlexSlots: number;
  maxActiveItems: number;
  unlockedFlexSlots?: number;
  usedSlots: number;
  usedSlotsByType: Readonly<Record<InventorySlotType, number>>;
  overflowByType: Readonly<Record<InventorySlotType, number>>;
  usedFlexSlots: number;
  provedFlexLowerBound: number;
  freeBaseSlots: number;
  freeBaseSlotsByType: Readonly<Record<InventorySlotType, number>>;
  freeFlexSlots?: number;
  totalCapacity?: number;
  activeItemsUsed: number;
  freeActiveItemSlots: number;
  evidence: FactEvidence;
}

export interface AdaptiveInvestmentTrackStateV1 {
  type: AdaptiveInvestmentTypeV1;
  currentValue: number;
  achievedBreakpoint?: number;
  nextBreakpoint?: number;
  soulsToNextBreakpoint?: number;
}

export interface AdaptiveInvestmentStateV1 {
  tracks: Readonly<Record<AdaptiveInvestmentTypeV1, AdaptiveInvestmentTrackStateV1>>;
  /**
   * Phase acceleration currently accepts only RECONSTRUCTED evidence because achieved breakpoints
   * come from inventory plus exact economy rules. This is a provenance contract, not a ranking of
   * OBSERVED evidence; a future observed breakpoint source requires an explicit contract update.
   */
  evidence: FactEvidence;
}

export interface RecommendationEconomyRulesV1 {
  rulesetId: string;
  catalogSha256: string;
  baseSlots: number;
  baseSlotsByType: Readonly<Record<InventorySlotType, number>>;
  maxFlexSlots: number;
  maxActiveItems: number;
  investmentBreakpoints: Readonly<Record<AdaptiveInvestmentTypeV1, readonly number[]>>;
}

export function isCanonicalAdaptiveInvestmentStateV1(value: unknown): value is AdaptiveInvestmentStateV1 {
  if (!isRecord(value) || !isFactEvidence(value.evidence)) return false;
  const tracks = value.tracks;
  if (!isRecord(tracks)) return false;
  return ADAPTIVE_INVESTMENT_TYPES_V1.every((type) =>
    isCanonicalAdaptiveInvestmentTrackV1(tracks[type], type),
  );
}

export function isCanonicalAdaptiveInvestmentTrackV1(
  value: unknown,
  expectedType: AdaptiveInvestmentTypeV1,
): value is AdaptiveInvestmentTrackStateV1 {
  if (!isRecord(value) || value.type !== expectedType || typeof value.currentValue !== 'number' ||
    !Number.isFinite(value.currentValue) || value.currentValue < 0) return false;
  const achievedBreakpoint = value.achievedBreakpoint;
  return achievedBreakpoint === undefined ||
    (typeof achievedBreakpoint === 'number' && Number.isFinite(achievedBreakpoint) &&
      achievedBreakpoint > 0 && achievedBreakpoint <= value.currentValue);
}

export interface AdaptiveFlexCapacityInputV1 {
  unlockedFlexSlots?: number;
  evidence: FactEvidence;
}

export interface AdaptiveSlotRulesV1 {
  baseSlots: number;
  baseSlotsByType: Readonly<Record<InventorySlotType, number>>;
  maxFlexSlots: number;
  maxActiveItems: number;
}

/**
 * Compatibility fallback only. Serving correctness must prefer exact rules resolved by
 * rulesetId + catalogSha256. The values describe the current 4/4/4 + 4-flex shape, but
 * the UNKNOWN flex evidence remains fail-closed until the match-specific unlock count is known.
 */
export const ADAPTIVE_UNIVERSAL_SLOT_RULES_V1: AdaptiveSlotRulesV1 = {
  baseSlots: 12,
  baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
  maxFlexSlots: 4,
  maxActiveItems: 4,
};

export function createCanonicalEconomyRulesV1(
  rulesetId: string,
  catalogSha256: string,
): RecommendationEconomyRulesV1 {
  return {
    rulesetId,
    catalogSha256: catalogSha256.toLowerCase(),
    baseSlots: 12,
    baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
    maxFlexSlots: 4,
    maxActiveItems: 4,
    investmentBreakpoints: {
      weapon: [1600],
      vitality: [1600],
      spirit: [1600],
    },
  };
}

const VERIFIED_RECOMMENDATION_ECONOMY_RULES_V1: readonly RecommendationEconomyRulesV1[] = [];

export function resolveRecommendationEconomyRulesV1(
  rulesetId: string,
  catalogSha256: string,
  registry: readonly RecommendationEconomyRulesV1[] = VERIFIED_RECOMMENDATION_ECONOMY_RULES_V1,
): RecommendationEconomyRulesV1 | undefined {
  return registry.find((entry) => entry.rulesetId === rulesetId && entry.catalogSha256 === catalogSha256);
}

export function slotRulesFromEconomyRulesV1(
  rules: RecommendationEconomyRulesV1 | undefined,
): AdaptiveSlotRulesV1 {
  if (!rules) return ADAPTIVE_UNIVERSAL_SLOT_RULES_V1;
  return {
    baseSlots: rules.baseSlots,
    baseSlotsByType: rules.baseSlotsByType,
    maxFlexSlots: rules.maxFlexSlots,
    maxActiveItems: rules.maxActiveItems,
  };
}

export function candidateGeneratorRulesFromSlotStateV1(
  slots: AdaptiveSlotStateV1,
  overrides: Partial<Pick<
    RecommendationCandidateGeneratorRules,
    'allowSellOnlyActions' | 'generateTargetedWaitActions'
  >> = {},
): RecommendationCandidateGeneratorRules {
  const effectiveUnlocked = slots.unlockedFlexSlots ?? (slots.provedFlexLowerBound > 0 ? slots.provedFlexLowerBound : undefined);
  return {
    baseSlots: slots.baseSlots,
    baseSlotsByType: slots.baseSlotsByType,
    maxFlexSlots: slots.maxFlexSlots,
    unlockedFlexSlots: effectiveUnlocked,
    flexCapacityEvidence: effectiveUnlocked !== undefined && slots.evidence === 'UNKNOWN' ? 'OBSERVED' : slots.evidence,
    maxActiveItems: slots.maxActiveItems,
    allowSellOnlyActions: overrides.allowSellOnlyActions ?? true,
    generateTargetedWaitActions: overrides.generateTargetedWaitActions ?? true,
  };
}

export function deriveAdaptiveSlotStateV1(
  itemIds: readonly number[],
  graph: RecommendationItemGraph,
  slotRules: AdaptiveSlotRulesV1,
  capacity: AdaptiveFlexCapacityInputV1 = { evidence: 'UNKNOWN' },
): AdaptiveSlotStateV1 {
  const baseSlotsByType: Record<InventorySlotType, number> = {
    weapon: Math.max(0, Math.floor(slotRules.baseSlotsByType.weapon)),
    vitality: Math.max(0, Math.floor(slotRules.baseSlotsByType.vitality)),
    spirit: Math.max(0, Math.floor(slotRules.baseSlotsByType.spirit)),
  };
  const baseSlots = Object.values(baseSlotsByType).reduce((sum, value) => sum + value, 0);
  const maxFlexSlots = Math.max(0, Math.floor(slotRules.maxFlexSlots));
  const maxActiveItems = Math.max(0, Math.floor(slotRules.maxActiveItems));
  const usage = recommendationSlotUsageFor(itemIds, graph, {
    baseSlots,
    baseSlotsByType,
    maxFlexSlots,
    unlockedFlexSlots: capacity.unlockedFlexSlots,
    flexCapacityEvidence: capacity.evidence,
    maxActiveItems,
    allowSellOnlyActions: true,
    generateTargetedWaitActions: true,
  });
  const provedLowerBound = Math.min(maxFlexSlots, usage.flexUsed);
  const unlocked = capacity.evidence === 'UNKNOWN' || capacity.unlockedFlexSlots === undefined
    ? undefined
    : Math.min(maxFlexSlots, Math.max(provedLowerBound, Math.floor(capacity.unlockedFlexSlots)));
  const evidence = capacity.evidence;
  const freeBaseSlotsByType: Record<InventorySlotType, number> = {
    weapon: Math.max(0, baseSlotsByType.weapon - usage.usedByType.weapon),
    vitality: Math.max(0, baseSlotsByType.vitality - usage.usedByType.vitality),
    spirit: Math.max(0, baseSlotsByType.spirit - usage.usedByType.spirit),
  };

  return {
    baseSlots,
    baseSlotsByType,
    maxFlexSlots,
    maxActiveItems,
    unlockedFlexSlots: unlocked,
    usedSlots: usage.itemCount,
    usedSlotsByType: usage.usedByType,
    overflowByType: usage.overflowByType,
    usedFlexSlots: usage.flexUsed,
    provedFlexLowerBound: provedLowerBound,
    freeBaseSlots: freeBaseSlotsByType.weapon + freeBaseSlotsByType.vitality + freeBaseSlotsByType.spirit,
    freeBaseSlotsByType,
    freeFlexSlots: unlocked === undefined ? undefined : Math.max(0, unlocked - usage.flexUsed),
    totalCapacity: unlocked === undefined ? undefined : baseSlots + unlocked,
    activeItemsUsed: usage.activeItemsUsed,
    freeActiveItemSlots: Math.max(0, maxActiveItems - usage.activeItemsUsed),
    evidence,
  };
}

export function deriveAdaptiveInvestmentStateV1(
  itemIds: readonly number[],
  graph: RecommendationItemGraph,
  rules: RecommendationEconomyRulesV1 | undefined,
): AdaptiveInvestmentStateV1 {
  if (!rules) return unknownAdaptiveInvestmentStateV1();

  const totals: Record<AdaptiveInvestmentTypeV1, number> = { weapon: 0, vitality: 0, spirit: 0 };
  const valueMemo = new Map<number, number>();
  for (const itemId of itemIds) {
    const item = graph.getItem(itemId);
    if (!item) continue;
    totals[item.slotType] += investmentValueForItemV1(itemId, graph, valueMemo, new Set<number>());
  }

  return {
    tracks: {
      weapon: investmentTrack('weapon', totals.weapon, rules.investmentBreakpoints.weapon),
      vitality: investmentTrack('vitality', totals.vitality, rules.investmentBreakpoints.vitality),
      spirit: investmentTrack('spirit', totals.spirit, rules.investmentBreakpoints.spirit),
    },
    evidence: 'RECONSTRUCTED',
  };
}

function investmentValueForItemV1(
  itemId: number,
  graph: RecommendationItemGraph,
  memo: Map<number, number>,
  visiting: Set<number>,
): number {
  const cached = memo.get(itemId);
  if (cached !== undefined) return cached;
  if (visiting.has(itemId)) return 0;

  const item = graph.getItem(itemId);
  if (!item) return 0;

  visiting.add(itemId);
  const values: number[] = [];
  if (item.directPurchaseCost !== undefined) values.push(Math.max(0, item.directPurchaseCost));
  for (const recipe of item.upgradeRecipes) {
    values.push(
      Math.max(0, recipe.soulsCost) + recipe.consumedItemIds.reduce(
        (sum, componentId) => sum + investmentValueForItemV1(componentId, graph, memo, visiting),
        0,
      ),
    );
  }
  visiting.delete(itemId);

  const value = values.length === 0 ? 0 : Math.min(...values);
  memo.set(itemId, value);
  return value;
}

export function unknownAdaptiveInvestmentStateV1(): AdaptiveInvestmentStateV1 {
  return {
    tracks: {
      weapon: { type: 'weapon', currentValue: 0 },
      vitality: { type: 'vitality', currentValue: 0 },
      spirit: { type: 'spirit', currentValue: 0 },
    },
    evidence: 'UNKNOWN',
  };
}

export interface AdaptiveInvestmentDeltaV1 {
  type: AdaptiveInvestmentTypeV1;
  before: AdaptiveInvestmentTrackStateV1;
  after: AdaptiveInvestmentTrackStateV1;
  crossedBreakpoints: readonly number[];
}

export function deriveAdaptiveInvestmentDeltasV1(
  before: AdaptiveInvestmentStateV1,
  after: AdaptiveInvestmentStateV1,
): readonly AdaptiveInvestmentDeltaV1[] {
  if (before.evidence === 'UNKNOWN' || after.evidence === 'UNKNOWN') return [];
  return (['weapon', 'vitality', 'spirit'] as const).map((type) => {
    const previous = before.tracks[type];
    const next = after.tracks[type];
    const upper = next.achievedBreakpoint ?? 0;
    const lower = previous.achievedBreakpoint ?? 0;
    const crossed = upper > lower ? [upper] : [];
    return { type, before: previous, after: next, crossedBreakpoints: crossed };
  });
}

function investmentTrack(
  type: AdaptiveInvestmentTypeV1,
  currentValue: number,
  breakpoints: readonly number[],
): AdaptiveInvestmentTrackStateV1 {
  const normalized = [...new Set(breakpoints.filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b);
  const achievedBreakpoint = [...normalized].reverse().find((value) => value <= currentValue);
  const nextBreakpoint = normalized.find((value) => value > currentValue);
  return {
    type,
    currentValue,
    achievedBreakpoint,
    nextBreakpoint,
    soulsToNextBreakpoint: nextBreakpoint === undefined ? undefined : Math.max(0, nextBreakpoint - currentValue),
  };
}

function isFactEvidence(value: unknown): value is FactEvidence {
  return value === 'OBSERVED' || value === 'RECONSTRUCTED' || value === 'UNKNOWN';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function observedFlexCapacityV1(value: number, source: string): ObservedFact<number> {
  return { value, evidence: 'OBSERVED', source };
}
