import {
  FactEvidence,
  ObservedFact,
  RecommendationItemGraph,
} from '@deadlock-live-probe/build-domain';

export type AdaptiveInvestmentTypeV1 = 'weapon' | 'vitality' | 'spirit';

export const ADAPTIVE_INVESTMENT_TYPES_V1: readonly AdaptiveInvestmentTypeV1[] = [
  'weapon',
  'vitality',
  'spirit',
];

export interface AdaptiveSlotStateV1 {
  baseSlots: number;
  maxFlexSlots: number;
  unlockedFlexSlots?: number;
  usedSlots: number;
  usedFlexSlots: number;
  provedFlexLowerBound: number;
  freeBaseSlots: number;
  freeFlexSlots?: number;
  totalCapacity?: number;
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
  maxFlexSlots: number;
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
  maxFlexSlots: number;
}

export const ADAPTIVE_UNIVERSAL_SLOT_RULES_V1: AdaptiveSlotRulesV1 = {
  baseSlots: 9,
  maxFlexSlots: 3,
};

const VERIFIED_RECOMMENDATION_ECONOMY_RULES_V1: readonly RecommendationEconomyRulesV1[] = [];

export function resolveRecommendationEconomyRulesV1(
  rulesetId: string,
  catalogSha256: string,
  registry: readonly RecommendationEconomyRulesV1[] = VERIFIED_RECOMMENDATION_ECONOMY_RULES_V1,
): RecommendationEconomyRulesV1 | undefined {
  return registry.find((entry) => entry.rulesetId === rulesetId && entry.catalogSha256 === catalogSha256);
}

export function deriveAdaptiveSlotStateV1(
  itemIds: readonly number[],
  _graph: RecommendationItemGraph,
  slotRules: AdaptiveSlotRulesV1,
  capacity: AdaptiveFlexCapacityInputV1 = { evidence: 'UNKNOWN' },
): AdaptiveSlotStateV1 {
  const baseSlots = Math.max(0, Math.floor(slotRules.baseSlots));
  const maxFlexSlots = Math.max(0, Math.floor(slotRules.maxFlexSlots));
  const usedSlots = new Set(itemIds).size;
  const usedFlexSlots = Math.max(0, usedSlots - baseSlots);
  const unlocked = capacity.evidence === 'UNKNOWN' || capacity.unlockedFlexSlots === undefined
    ? undefined
    : Math.min(maxFlexSlots, Math.max(0, Math.floor(capacity.unlockedFlexSlots)));

  return {
    baseSlots,
    maxFlexSlots,
    unlockedFlexSlots: unlocked,
    usedSlots,
    usedFlexSlots,
    provedFlexLowerBound: usedFlexSlots,
    freeBaseSlots: Math.max(0, baseSlots - usedSlots),
    freeFlexSlots: unlocked === undefined ? undefined : Math.max(0, unlocked - usedFlexSlots),
    totalCapacity: unlocked === undefined ? undefined : baseSlots + unlocked,
    evidence: capacity.evidence,
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
  const directValue = item.directPurchaseCost;
  if (directValue !== undefined) {
    const value = Math.max(0, directValue);
    memo.set(itemId, value);
    return value;
  }

  visiting.add(itemId);
  const recipeValues = item.upgradeRecipes.map((recipe) =>
    Math.max(0, recipe.soulsCost) + recipe.consumedItemIds.reduce(
      (sum, componentId) => sum + investmentValueForItemV1(componentId, graph, memo, visiting),
      0,
    ),
  );
  visiting.delete(itemId);

  const value = recipeValues.length === 0 ? 0 : Math.min(...recipeValues);
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
    const crossed: number[] = [];
    if (next.achievedBreakpoint !== undefined && next.achievedBreakpoint > (previous.achievedBreakpoint ?? 0)) {
      crossed.push(next.achievedBreakpoint);
    }
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
