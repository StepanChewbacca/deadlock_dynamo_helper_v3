import { RecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { BuildArchetypeFeatureVectorV1 } from './build-archetype.types';
import { PlannerTrajectoryV2 } from './planner-trajectory-v2';

export function encodeBuildArchetypeFeaturesV1(
  trajectory: PlannerTrajectoryV2,
  graph: RecommendationItemGraph,
): BuildArchetypeFeatureVectorV1 {
  const familyWeights: Record<number, number> = {};
  const orderedFamilyIds: number[] = [];
  for (const transaction of trajectory.transactions) {
    if (transaction.familyId === undefined) continue;
    orderedFamilyIds.push(transaction.familyId);
    const timeWeight = transaction.gameTimeSec <= 600
      ? 1
      : transaction.gameTimeSec <= 1_500
        ? 0.72
        : 0.38;
    const actionWeight = transaction.actionType === 'UPGRADE'
      ? 1.15
      : transaction.actionType === 'SELL'
        ? 0.45
        : transaction.actionType === 'REPLACE'
          ? 0.8
          : 1;
    familyWeights[transaction.familyId] = (familyWeights[transaction.familyId] ?? 0) + timeWeight * actionWeight;
  }

  const maxTime = Math.max(1, ...trajectory.transactions.map((entry) => entry.gameTimeSec));
  const finalInvestment = trajectory.archetypeFeaturePayload.finalInvestment;
  const investmentTotal = Math.max(1, finalInvestment.weapon + finalInvestment.vitality + finalInvestment.spirit);
  const finalSlotShape = { weapon: 0, vitality: 0, spirit: 0 };
  for (const itemId of trajectory.archetypeFeaturePayload.finalInventoryItemIds) {
    const item = graph.getItem(itemId);
    if (item) finalSlotShape[item.slotType] += 1;
  }

  return {
    traceId: trajectory.traceId,
    heroId: trajectory.heroId,
    familyWeights,
    orderedFamilyIds,
    normalizedTiming: trajectory.transactions.map((entry) => entry.gameTimeSec / maxTime),
    investmentShare: {
      weapon: finalInvestment.weapon / investmentTotal,
      vitality: finalInvestment.vitality / investmentTotal,
      spirit: finalInvestment.spirit / investmentTotal,
    },
    finalSlotShape,
  };
}

export function buildArchetypeDistanceV1(a: BuildArchetypeFeatureVectorV1, b: BuildArchetypeFeatureVectorV1): number {
  if (a.heroId !== b.heroId) return 1;
  const family = weightedJaccardDistance(a.familyWeights, b.familyWeights);
  const sequence = lcsDistance(a.orderedFamilyIds, b.orderedFamilyIds);
  const timing = alignedTimingDistance(a.normalizedTiming, b.normalizedTiming);
  const investment = meanAbsoluteDistance(
    [a.investmentShare.weapon, a.investmentShare.vitality, a.investmentShare.spirit],
    [b.investmentShare.weapon, b.investmentShare.vitality, b.investmentShare.spirit],
  );
  const slot = normalizedSlotDistance(a.finalSlotShape, b.finalSlotShape);
  return clamp01(
    family * 0.34 +
    sequence * 0.30 +
    timing * 0.12 +
    investment * 0.14 +
    slot * 0.10,
  );
}

function weightedJaccardDistance(a: Readonly<Record<number, number>>, b: Readonly<Record<number, number>>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let minSum = 0;
  let maxSum = 0;
  for (const key of keys) {
    const left = a[Number(key)] ?? 0;
    const right = b[Number(key)] ?? 0;
    minSum += Math.min(left, right);
    maxSum += Math.max(left, right);
  }
  return maxSum <= 0 ? 0 : 1 - minSum / maxSum;
}

function lcsDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const matrix = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      matrix[i][j] = a[i - 1] === b[j - 1]
        ? matrix[i - 1][j - 1] + 1
        : Math.max(matrix[i - 1][j], matrix[i][j - 1]);
    }
  }
  const lcs = matrix[a.length][b.length];
  return 1 - lcs / Math.max(a.length, b.length, 1);
}

function alignedTimingDistance(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return a.length === b.length ? 0 : 1;
  let sum = 0;
  for (let index = 0; index < length; index += 1) sum += Math.abs(a[index] - b[index]);
  const missingPenalty = Math.abs(a.length - b.length) / Math.max(a.length, b.length, 1);
  return clamp01(sum / length * 0.7 + missingPenalty * 0.3);
}

function meanAbsoluteDistance(a: readonly number[], b: readonly number[]): number {
  const length = Math.max(a.length, b.length, 1);
  let sum = 0;
  for (let index = 0; index < length; index += 1) sum += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
  return clamp01(sum / length);
}

function normalizedSlotDistance(
  a: { weapon: number; vitality: number; spirit: number },
  b: { weapon: number; vitality: number; spirit: number },
): number {
  const sum = Math.abs(a.weapon - b.weapon) + Math.abs(a.vitality - b.vitality) + Math.abs(a.spirit - b.spirit);
  const scale = Math.max(1, a.weapon + a.vitality + a.spirit, b.weapon + b.vitality + b.spirit);
  return clamp01(sum / scale);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
