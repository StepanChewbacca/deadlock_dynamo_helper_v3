import {
  FactEvidence,
  ObservedFact,
  RecommendationItemGraph,
} from '@deadlock-live-probe/build-domain';
import { InventorySlotType } from '@deadlock-live-probe/build-domain';

export type AdaptiveInvestmentTypeV1 = 'weapon' | 'vitality' | 'spirit';

export interface AdaptiveSlotStateV1 {
  baseByType: Readonly<Record<InventorySlotType, number>>;
  maxFlexSlots: number;
  unlockedFlexSlots?: number;
  usedFlexSlots: number;
  provedFlexLowerBound: number;
  freeBaseByType: Readonly<Record<InventorySlotType, number>>;
  freeFlexSlots?: number;
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
  evidence: FactEvidence;
}

export interface RecommendationEconomyRulesV1 {
  rulesetId: string;
  catalogSha256: string;
  baseSlotsByType: Readonly<Record<InventorySlotType, number>>;
  maxFlexSlots: number;
  investmentBreakpoints: Readonly<Record<AdaptiveInvestmentTypeV1, readonly number[]>>;
}

export interface AdaptiveFlexCapacityInputV1 {
  unlockedFlexSlots?: number;
  evidence: FactEvidence;
}

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
  graph: RecommendationItemGraph,
  slotRules: Pick<RecommendationEconomyRulesV1, 'baseSlotsByType' | 'maxFlexSlots'>,
  capacity: AdaptiveFlexCapacityInputV1 = { evidence: 'UNKNOWN' },
): AdaptiveSlotStateV1 {
  const counts: Record<InventorySlotType, number> = { weapon: 0, vitality: 0, spirit: 0 };
  for (const itemId of itemIds) {
    const type = graph.getItem(itemId)?.slotType;
    if (type) counts[type] += 1;
  }

  const freeBaseByType: Record<InventorySlotType, number> = { weapon: 0, vitality: 0, spirit: 0 };
  let usedFlexSlots = 0;
  for (const type of Object.keys(counts) as InventorySlotType[]) {
    freeBaseByType[type] = Math.max(0, slotRules.baseSlotsByType[type] - counts[type]);
    usedFlexSlots += Math.max(0, counts[type] - slotRules.baseSlotsByType[type]);
  }

  const unlocked = capacity.unlockedFlexSlots === undefined
    ? undefined
    : Math.min(slotRules.maxFlexSlots, Math.max(0, Math.floor(capacity.unlockedFlexSlots)));

  return {
    baseByType: { ...slotRules.baseSlotsByType },
    maxFlexSlots: slotRules.maxFlexSlots,
    unlockedFlexSlots: unlocked,
    usedFlexSlots,
    provedFlexLowerBound: usedFlexSlots,
    freeBaseByType,
    freeFlexSlots: unlocked === undefined ? undefined : Math.max(0, unlocked - usedFlexSlots),
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
  for (const itemId of itemIds) {
    const item = graph.getItem(itemId);
    if (!item) continue;
    totals[item.slotType] += Math.max(0, item.directPurchaseCost ?? 0);
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

export function observedFlexCapacityV1(value: number, source: string): ObservedFact<number> {
  return { value, evidence: 'OBSERVED', source };
}
