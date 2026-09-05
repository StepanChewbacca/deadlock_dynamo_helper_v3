import { createHash } from 'crypto';
import { RecommendationItemGraph } from '@deadlock-live-probe/build-domain';

export type PlannerTransactionTypeV2 = 'BUY' | 'UPGRADE' | 'SELL' | 'REPLACE';

export interface PlannerInvestmentVectorV2 {
  weapon: number;
  vitality: number;
  spirit: number;
}

export interface PlannerTrajectoryTransactionInputV2 {
  actionType: PlannerTransactionTypeV2;
  gameTimeSec: number;
  targetItemId?: number;
  sellItemId?: number;
  consumedItemIds?: readonly number[];
  inventoryBefore: readonly number[];
  inventoryAfter: readonly number[];
  slotUsedBefore: number;
  slotUsedAfter: number;
  investmentBefore: PlannerInvestmentVectorV2;
  investmentAfter: PlannerInvestmentVectorV2;
}

export interface PlannerTrajectoryTransactionV2 extends PlannerTrajectoryTransactionInputV2 {
  sequence: number;
  familyId?: number;
  consumedItemIds: readonly number[];
  inventoryBefore: readonly number[];
  inventoryAfter: readonly number[];
}

export interface PlannerTrajectoryInputV2 {
  matchId: string;
  playerKey: string;
  heroId: number;
  patchId: string;
  rulesetId: string;
  catalogSha256: string;
  rankCohort: string;
  allyHeroIds: readonly number[];
  enemyHeroIds: readonly number[];
  finalOutcome?: number;
  transactions: readonly PlannerTrajectoryTransactionInputV2[];
}

export interface PlannerTrajectoryArchetypeFeaturePayloadV2 {
  heroId: number;
  patchId: string;
  rulesetId: string;
  rankCohort: string;
  allyHeroIds: readonly number[];
  enemyHeroIds: readonly number[];
  orderedFamilyIds: readonly number[];
  orderedActionTypes: readonly PlannerTransactionTypeV2[];
  timingSec: readonly number[];
  finalInvestment: PlannerInvestmentVectorV2;
  finalInventoryItemIds: readonly number[];
}

export interface PlannerTrajectoryV2 {
  schemaVersion: 2;
  traceId: string;
  traceSha256: string;
  matchId: string;
  playerKey: string;
  heroId: number;
  patchId: string;
  rulesetId: string;
  catalogSha256: string;
  rankCohort: string;
  allyHeroIds: readonly number[];
  enemyHeroIds: readonly number[];
  finalOutcome?: number;
  transactions: readonly PlannerTrajectoryTransactionV2[];
  archetypeFeaturePayload: PlannerTrajectoryArchetypeFeaturePayloadV2;
}

export type PlannerTrajectoryValidationCodeV2 =
  | 'EMPTY_TRACE'
  | 'TIME_NOT_MONOTONIC'
  | 'INVENTORY_DISCONTINUITY'
  | 'INVALID_ITEM_REFERENCE'
  | 'INVALID_CATALOG_SHA';

export interface PlannerTrajectoryValidationErrorV2 {
  code: PlannerTrajectoryValidationCodeV2;
  transactionIndex?: number;
  itemId?: number;
  message: string;
}

export function createPlannerTrajectoryV2(
  input: PlannerTrajectoryInputV2,
  graph: RecommendationItemGraph,
): PlannerTrajectoryV2 {
  const transactions = input.transactions.map((entry, index) => {
    const targetItemId = entry.targetItemId;
    return {
      ...entry,
      sequence: index,
      familyId: targetItemId === undefined ? undefined : plannerTrajectoryFamilyIdV2(targetItemId, graph),
      consumedItemIds: stableItemIds(entry.consumedItemIds ?? []),
      inventoryBefore: stableItemIds(entry.inventoryBefore),
      inventoryAfter: stableItemIds(entry.inventoryAfter),
    } satisfies PlannerTrajectoryTransactionV2;
  });
  const last = transactions[transactions.length - 1];
  const archetypeFeaturePayload: PlannerTrajectoryArchetypeFeaturePayloadV2 = {
    heroId: input.heroId,
    patchId: input.patchId,
    rulesetId: input.rulesetId,
    rankCohort: input.rankCohort,
    allyHeroIds: stableItemIds(input.allyHeroIds),
    enemyHeroIds: stableItemIds(input.enemyHeroIds),
    orderedFamilyIds: transactions
      .map((entry) => entry.familyId)
      .filter((familyId): familyId is number => familyId !== undefined),
    orderedActionTypes: transactions.map((entry) => entry.actionType),
    timingSec: transactions.map((entry) => entry.gameTimeSec),
    finalInvestment: last?.investmentAfter ?? { weapon: 0, vitality: 0, spirit: 0 },
    finalInventoryItemIds: last?.inventoryAfter ?? [],
  };
  const identityPayload = {
    matchId: input.matchId,
    playerKey: input.playerKey,
    heroId: input.heroId,
    patchId: input.patchId,
    rulesetId: input.rulesetId,
    catalogSha256: input.catalogSha256,
    transactions,
  };
  const traceSha256 = sha256(stableJson(identityPayload));
  return {
    schemaVersion: 2,
    traceId: `${input.matchId}:${input.playerKey}:${traceSha256.slice(0, 16)}`,
    traceSha256,
    matchId: input.matchId,
    playerKey: input.playerKey,
    heroId: input.heroId,
    patchId: input.patchId,
    rulesetId: input.rulesetId,
    catalogSha256: input.catalogSha256,
    rankCohort: input.rankCohort,
    allyHeroIds: stableItemIds(input.allyHeroIds),
    enemyHeroIds: stableItemIds(input.enemyHeroIds),
    finalOutcome: input.finalOutcome,
    transactions,
    archetypeFeaturePayload,
  };
}

export function validatePlannerTrajectoryV2(
  trajectory: PlannerTrajectoryV2,
  graph?: RecommendationItemGraph,
): readonly PlannerTrajectoryValidationErrorV2[] {
  const errors: PlannerTrajectoryValidationErrorV2[] = [];
  if (trajectory.transactions.length === 0) {
    errors.push({ code: 'EMPTY_TRACE', message: 'Trajectory has no transactions' });
  }
  if (!/^[a-f0-9]{64}$/i.test(trajectory.catalogSha256)) {
    errors.push({ code: 'INVALID_CATALOG_SHA', message: 'catalogSha256 must be a 64-character SHA256' });
  }
  for (let index = 0; index < trajectory.transactions.length; index += 1) {
    const current = trajectory.transactions[index];
    const previous = trajectory.transactions[index - 1];
    if (previous && current.gameTimeSec < previous.gameTimeSec) {
      errors.push({ code: 'TIME_NOT_MONOTONIC', transactionIndex: index, message: 'Transaction time moved backwards' });
    }
    if (previous && !sameNumberSet(previous.inventoryAfter, current.inventoryBefore)) {
      errors.push({ code: 'INVENTORY_DISCONTINUITY', transactionIndex: index, message: 'Inventory before does not equal prior inventory after' });
    }
    if (graph) {
      for (const itemId of stableItemIds([
        ...(current.targetItemId === undefined ? [] : [current.targetItemId]),
        ...(current.sellItemId === undefined ? [] : [current.sellItemId]),
        ...current.consumedItemIds,
        ...current.inventoryBefore,
        ...current.inventoryAfter,
      ])) {
        if (!graph.getItem(itemId)) {
          errors.push({ code: 'INVALID_ITEM_REFERENCE', transactionIndex: index, itemId, message: `Unknown item ${itemId}` });
        }
      }
    }
  }
  return errors.sort((a, b) => a.code.localeCompare(b.code) || (a.transactionIndex ?? -1) - (b.transactionIndex ?? -1));
}

export function plannerTrajectoryFamilyIdV2(itemId: number, graph: RecommendationItemGraph): number {
  const related = new Set<number>([
    itemId,
    ...graph.getTransitiveComponentIds(itemId),
    ...graph.getTransitiveUpgradeIds(itemId),
  ]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const current of [...related]) {
      for (const next of [...graph.getTransitiveComponentIds(current), ...graph.getTransitiveUpgradeIds(current)]) {
        if (!related.has(next)) {
          related.add(next);
          changed = true;
        }
      }
    }
  }
  return Math.min(...related);
}

function stableItemIds(values: readonly number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
}

function sameNumberSet(a: readonly number[], b: readonly number[]): boolean {
  const left = stableItemIds(a);
  const right = stableItemIds(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, stableValue(record[key])]));
}
