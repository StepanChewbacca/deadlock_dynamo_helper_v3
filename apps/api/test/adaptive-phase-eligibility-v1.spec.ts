import { AdaptivePhaseEligibilityV1Service } from '../src/statlocker-adaptive/adaptive-phase-eligibility-v1.service';
import { AdaptiveInvestmentStateV1 } from '../src/statlocker-adaptive/adaptive-economy-v1';
import { ConsensusBuildGroupV1, ConsensusSkeletonV1 } from '../src/statlocker-adaptive/statlocker-adaptive.types';

function candidate(itemId: number, rushEvidence = false) {
  return {
    itemId,
    strength: 0.8,
    coverage: 0.8,
    purchaseRate: 0.8,
    medianBuyTimeS: 600,
    timingSpreadS: 30,
    sourceProfileCount: 8,
    frequencyTier: 'CORE' as const,
    rushEvidence,
  };
}

function group(groupId: string, phase: 'EARLY' | 'MID' | 'LATE', itemId: number, rush = false): ConsensusBuildGroupV1 {
  return {
    groupId,
    phase,
    type: 'REQUIRED',
    minSelect: 1,
    maxSelect: 1,
    candidates: [candidate(itemId, rush)],
    confidence: 0.8,
    inferred: true,
  };
}

function context(
  target: ConsensusBuildGroupV1,
  gameTimeSec: number,
  owned: number[] = [],
  gameState: 'AHEAD' | 'EVEN' | 'BEHIND' | 'UNKNOWN' = 'EVEN',
  investmentState: AdaptiveInvestmentStateV1 = investment('UNKNOWN', 0),
) {
  const early = group('early', 'EARLY', 1);
  const groups = target.groupId === 'early' ? [target] : [early, target];
  const skeleton: ConsensusSkeletonV1 = { heroId: 10, profileCount: 10, groups };
  return {
    skeleton,
    ownedItemIds: new Set(owned),
    gameTimeSec,
    gameState,
    investment: investmentState,
  };
}

function investment(evidence: 'OBSERVED' | 'RECONSTRUCTED' | 'UNKNOWN', achievedBreakpointCount: number): AdaptiveInvestmentStateV1 {
  const achieved = (index: number) => index < achievedBreakpointCount ? 1_600 : undefined;
  return {
    evidence,
    tracks: {
      weapon: { type: 'weapon', currentValue: 1_600, achievedBreakpoint: achieved(0) },
      vitality: { type: 'vitality', currentValue: 1_600, achievedBreakpoint: achieved(1) },
      spirit: { type: 'spirit', currentValue: 1_600, achievedBreakpoint: achieved(2) },
    },
  };
}

describe('AdaptivePhaseEligibilityV1Service', () => {
  const service = new AdaptivePhaseEligibilityV1Service();

  it('makes EARLY eligible immediately', () => {
    const target = group('early', 'EARLY', 1);
    expect(service.evaluateGroup(target, context(target, 120))).toBe('ELIGIBLE');
  });

  it('hard-gates MID before its time floor even when otherwise unresolved', () => {
    const target = group('mid', 'MID', 2);
    expect(service.evaluateGroup(target, context(target, 120, [1]))).toBe('NOT_YET_ELIGIBLE');
  });

  it('keeps rushed LATE gated behind an unfinished required MID group', () => {
    const early = group('early', 'EARLY', 1);
    const mid = group('mid', 'MID', 2);
    const target = group('late', 'LATE', 3, true);
    const skeleton: ConsensusSkeletonV1 = { heroId: 10, profileCount: 10, groups: [early, mid, target] };
    expect(service.evaluateGroup(target, {
      skeleton,
      ownedItemIds: new Set([1]),
      gameTimeSec: 2_000,
      gameState: 'AHEAD',
      investment: investment('UNKNOWN', 0),
    })).toBe('NOT_YET_ELIGIBLE');
  });

  it.each(['AHEAD', 'EVEN', 'BEHIND', 'UNKNOWN'] as const)(
    'allows rushed MID with completed prerequisites regardless of %s game state',
    (gameState) => {
      const target = group('mid', 'MID', 2, true);
      expect(service.evaluateGroup(target, context(target, 1, [1], gameState))).toBe('ELIGIBLE');
    },
  );

  it('requires prior REQUIRED phases to be completed after the time floor', () => {
    const target = group('mid', 'MID', 2);
    expect(service.evaluateGroup(target, context(target, 700))).toBe('NOT_YET_ELIGIBLE');
    expect(service.evaluateGroup(target, context(target, 700, [1]))).toBe('ELIGIBLE');
  });

  it('accelerates MID only for reconstructed strong achieved investment breakpoints', () => {
    const target = group('mid', 'MID', 2);
    expect(service.evaluateGroup(target, context(target, 480, [1], 'EVEN', investment('RECONSTRUCTED', 2)))).toBe('ELIGIBLE');
  });

  it('does not accelerate MID from identical UNKNOWN investment tracks', () => {
    const target = group('mid', 'MID', 2);
    expect(service.evaluateGroup(target, context(target, 480, [1], 'EVEN', investment('UNKNOWN', 2)))).toBe('NOT_YET_ELIGIBLE');
  });

  it('does not accelerate MID from non-reconstructed investment tracks', () => {
    const target = group('mid', 'MID', 2);
    expect(service.evaluateGroup(target, context(target, 480, [1], 'EVEN', investment('OBSERVED', 2)))).toBe('NOT_YET_ELIGIBLE');
  });

  it('fails closed instead of throwing for a null reconstructed investment track', () => {
    const target = group('mid', 'MID', 2);
    const malformed = investment('RECONSTRUCTED', 2) as unknown as { tracks: Record<string, unknown> };
    malformed.tracks.weapon = null;

    expect(service.evaluateGroup(target, context(
      target,
      480,
      [1],
      'EVEN',
      malformed as unknown as AdaptiveInvestmentStateV1,
    ))).toBe('NOT_YET_ELIGIBLE');
  });

  it.each([
    ['a missing track', (state: { tracks: Record<string, unknown> }) => { delete state.tracks.weapon; }],
    ['a non-finite current value', (state: { tracks: Record<string, any> }) => { state.tracks.weapon.currentValue = Number.NaN; }],
    ['a zero achieved breakpoint', (state: { tracks: Record<string, any> }) => { state.tracks.weapon.achievedBreakpoint = 0; }],
    ['a non-finite achieved breakpoint', (state: { tracks: Record<string, any> }) => { state.tracks.weapon.achievedBreakpoint = Number.POSITIVE_INFINITY; }],
    ['an achieved breakpoint above its current value', (state: { tracks: Record<string, any> }) => { state.tracks.weapon.achievedBreakpoint = 1_601; }],
  ])('does not accelerate MID from %s', (_description, corrupt) => {
    const target = group('mid', 'MID', 2);
    const malformed = investment('RECONSTRUCTED', 2) as unknown as { tracks: Record<string, unknown> };
    corrupt(malformed);

    expect(service.evaluateGroup(target, context(
      target,
      480,
      [1],
      'EVEN',
      malformed as unknown as AdaptiveInvestmentStateV1,
    ))).toBe('NOT_YET_ELIGIBLE');
  });

  it('keeps LATE gated before its own floor', () => {
    const early = group('early', 'EARLY', 1);
    const mid = group('mid', 'MID', 2);
    const target = group('late', 'LATE', 3);
    const skeleton: ConsensusSkeletonV1 = { heroId: 10, profileCount: 10, groups: [early, mid, target] };
    expect(service.evaluateGroup(target, {
      skeleton,
      ownedItemIds: new Set([1, 2]),
      gameTimeSec: 1200,
      gameState: 'EVEN',
      investment: investment('UNKNOWN', 0),
    })).toBe('NOT_YET_ELIGIBLE');
  });

  it('does not accelerate the time floor from AHEAD contextual evidence', () => {
    const target = group('mid', 'MID', 2);
    expect(service.evaluateGroup(target, context(target, 500, [1], 'EVEN'))).toBe('NOT_YET_ELIGIBLE');
    expect(service.evaluateGroup(target, context(target, 500, [1], 'AHEAD'))).toBe('NOT_YET_ELIGIBLE');
  });

  it('returns structural terminal states before phase checks', () => {
    const target = group('mid', 'MID', 2);
    const base = context(target, 120, [2]);
    expect(service.evaluateGroup(target, base)).toBe('COMPLETED');
    expect(service.evaluateGroup(target, { ...base, ownedItemIds: new Set(), skippedGroupIds: new Set(['mid']) })).toBe('SKIPPED');
    expect(service.evaluateGroup(target, { ...base, ownedItemIds: new Set(), committedOtherGroupIds: new Set(['mid']) })).toBe('COMMITTED_OTHER_BRANCH');
  });
});
