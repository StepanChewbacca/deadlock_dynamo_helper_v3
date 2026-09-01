export type AdaptiveGameStateV1 = 'AHEAD' | 'EVEN' | 'BEHIND' | 'UNKNOWN';

export interface AdaptiveGameStateBlendV1 {
  ahead: number;
  even: number;
  behind: number;
}

export function classifyAdaptiveGameStateV1(
  ourTeamSouls: number | undefined,
  enemyTeamSouls: number | undefined,
  threshold = 0.08,
): AdaptiveGameStateV1 {
  if (!isFiniteNonNegative(ourTeamSouls) || !isFinitePositive(enemyTeamSouls)) return 'UNKNOWN';
  const soulDelta = ((ourTeamSouls as number) - (enemyTeamSouls as number)) / (enemyTeamSouls as number);
  if (soulDelta >= threshold) return 'AHEAD';
  if (soulDelta <= -threshold) return 'BEHIND';
  return 'EVEN';
}

export function computeAdaptiveGameStateBlendV1(
  soulDelta: number,
  threshold = 0.08,
  blendWidth = 0.03,
): AdaptiveGameStateBlendV1 {
  if (!Number.isFinite(soulDelta) || !Number.isFinite(threshold) || threshold <= 0 || !Number.isFinite(blendWidth) || blendWidth < 0) {
    return { ahead: 0, even: 0, behind: 0 };
  }
  if (blendWidth === 0) {
    if (soulDelta >= threshold) return { ahead: 1, even: 0, behind: 0 };
    if (soulDelta <= -threshold) return { ahead: 0, even: 0, behind: 1 };
    return { ahead: 0, even: 1, behind: 0 };
  }

  const ahead = smoothBoundaryWeight(soulDelta, threshold, blendWidth);
  const behind = smoothBoundaryWeight(-soulDelta, threshold, blendWidth);
  const even = clamp01(1 - ahead - behind);
  const total = ahead + even + behind;
  if (total <= 0) return { ahead: 0, even: 0, behind: 0 };
  return {
    ahead: ahead / total,
    even: even / total,
    behind: behind / total,
  };
}

export function computeSoulDeltaV1(
  ourTeamSouls: number | undefined,
  enemyTeamSouls: number | undefined,
): number | undefined {
  if (!isFiniteNonNegative(ourTeamSouls) || !isFinitePositive(enemyTeamSouls)) return undefined;
  return ((ourTeamSouls as number) - (enemyTeamSouls as number)) / (enemyTeamSouls as number);
}

function smoothBoundaryWeight(value: number, threshold: number, blendWidth: number): number {
  const lower = threshold - blendWidth;
  const upper = threshold + blendWidth;
  if (value <= lower) return 0;
  if (value >= upper) return 1;
  const t = clamp01((value - lower) / Math.max(Number.EPSILON, upper - lower));
  return t * t * (3 - 2 * t);
}

function isFiniteNonNegative(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isFinitePositive(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
