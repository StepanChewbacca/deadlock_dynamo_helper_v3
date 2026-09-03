import { AdaptivePhaseEligibilityV1Service } from '../src/statlocker-adaptive/adaptive-phase-eligibility-v1.service';
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
) {
  const early = group('early', 'EARLY', 1);
  const groups = target.groupId === 'early' ? [target] : [early, target];
  const skeleton: ConsensusSkeletonV1 = { heroId: 10, profileCount: 10, groups };
  return {
    skeleton,
    ownedItemIds: new Set(owned),
    gameTimeSec,
    gameState,
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

  it('allows explicit rush evidence without using contextual WPA', () => {
    const target = group('mid', 'MID', 2, true);
    expect(service.evaluateGroup(target, context(target, 120))).toBe('ELIGIBLE');
  });

  it('requires prior REQUIRED phases to be completed after the time floor', () => {
    const target = group('mid', 'MID', 2);
    expect(service.evaluateGroup(target, context(target, 700))).toBe('NOT_YET_ELIGIBLE');
    expect(service.evaluateGroup(target, context(target, 700, [1]))).toBe('ELIGIBLE');
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
    })).toBe('NOT_YET_ELIGIBLE');
  });

  it('accelerates only the deterministic time floor when confidently ahead', () => {
    const target = group('mid', 'MID', 2);
    expect(service.evaluateGroup(target, context(target, 500, [1], 'EVEN'))).toBe('NOT_YET_ELIGIBLE');
    expect(service.evaluateGroup(target, context(target, 500, [1], 'AHEAD'))).toBe('ELIGIBLE');
  });

  it('returns structural terminal states before phase checks', () => {
    const target = group('mid', 'MID', 2);
    const base = context(target, 120, [2]);
    expect(service.evaluateGroup(target, base)).toBe('COMPLETED');
    expect(service.evaluateGroup(target, { ...base, ownedItemIds: new Set(), skippedGroupIds: new Set(['mid']) })).toBe('SKIPPED');
    expect(service.evaluateGroup(target, { ...base, ownedItemIds: new Set(), committedOtherGroupIds: new Set(['mid']) })).toBe('COMMITTED_OTHER_BRANCH');
  });
});
