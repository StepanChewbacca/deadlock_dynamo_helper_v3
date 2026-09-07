import { auditPlannerTrajectoriesV2 } from '../src/statlocker-adaptive/planner-trajectory-audit-v2';

function trajectory(overrides: Record<string, unknown> = {}) {
  return {
    strategyId: 'strategy-a',
    decisionId: 'decision-a',
    initialStateRevision: 'revision-a',
    matchId: 'match-a',
    playerSlot: 0,
    heroId: 10,
    rulesetId: 'ruleset-a',
    catalogSha256: 'a'.repeat(64),
    enemyHeroIds: [20],
    initialGameTimeSec: 0,
    initialOwnedItemIds: [1],
    slotRules: {
      baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
      maxFlexSlots: 3,
      maxActiveItems: 4,
      evidence: 'RECONSTRUCTED',
    },
    flexCapacity: { unlockedFlexSlots: 3, evidence: 'OBSERVED' },
    steps: [{
      index: 0,
      actionId: 'UPGRADE_ITEM:2:upgrade:2',
      actionType: 'UPGRADE_ITEM',
      targetItemId: 2,
      sourceItemIds: [1],
      consumedItemIds: [1],
      removedItemIds: [1],
      addedItemIds: [2],
      soulsDelta: -500,
      beforeInventoryFingerprint: '1',
      afterInventoryFingerprint: '2',
      beforeStateFingerprint: 'before',
      afterStateFingerprint: 'after',
      beforeOwnedItemIds: [1],
      afterOwnedItemIds: [2],
      gameTimeSec: 100,
      rulesetId: 'ruleset-a',
      catalogSha256: 'a'.repeat(64),
      heroId: 10,
      enemyHeroIds: [20],
      beforeSlotState: {},
      afterSlotState: {},
      beforeInvestmentState: {},
      afterInvestmentState: {},
    }],
    terminalContract: {
      status: 'COMPLETE',
      completedGoalIds: new Set(),
      remainingGoalIds: [],
      committedChoiceItemIdsByGroup: new Map(),
      temporaryItemIds: new Set(),
      slotReservations: [],
      situationalWindowStates: [],
      replanReasonCodes: [],
    },
    terminalOwnedItemIds: [2],
    utility: 1,
    confidence: 1,
    ...overrides,
  } as any;
}

describe('auditPlannerTrajectoriesV2', () => {
  it('emits deterministic replay, unknown-transaction and exact ruleset coverage metrics', () => {
    const audit = auditPlannerTrajectoriesV2(
      [trajectory(), { ...trajectory(), decisionId: 'decision-b' }],
      [{ reason: 'UNKNOWN_TRANSACTION', rulesetId: 'ruleset-a', catalogSha256: 'a'.repeat(64) }],
    );

    expect(audit.trajectoryCount).toBe(3);
    expect(audit.acceptedTrajectoryCount).toBe(2);
    expect(audit.replayCoverage).toBe(2 / 3);
    expect(audit.unknownTransactionRate).toBe(1 / 3);
    expect(audit.inventoryDriftCount).toBe(0);
    expect(audit.unknownPatchIdentityCount).toBe(0);
    expect(audit.rulesetCoverage).toEqual([{
      rulesetId: 'ruleset-a',
      catalogSha256: 'a'.repeat(64),
      acceptedCount: 2,
    }]);
    expect(audit.releaseEligible).toBe(true);
  });

  it('fails the release gate if an accepted trajectory drifts or loses exact patch identity', () => {
    const drifted = trajectory({ terminalOwnedItemIds: [999] });
    const unknownPatch = trajectory({ catalogSha256: 'not-a-sha' });
    const audit = auditPlannerTrajectoriesV2([drifted, unknownPatch]);

    expect(audit.inventoryDriftCount).toBeGreaterThan(0);
    expect(audit.unknownPatchIdentityCount).toBe(1);
    expect(audit.releaseEligible).toBe(false);
  });
});