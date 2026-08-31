import 'reflect-metadata';
import {
  createRecommendationItemGraph,
  observedFact,
  unknownFact,
} from '@deadlock-live-probe/build-domain';
import { AdaptiveRecommendationV1Service } from '../src/statlocker-adaptive/adaptive-recommendation-v1.service';

const catalogSha256 = 'a'.repeat(64);

function graph() {
  return createRecommendationItemGraph([{
    itemId: 1,
    name: 'Item 1',
    slotType: 'weapon' as const,
    active: false,
    availableRulesetIds: ['ruleset-a'],
    directPurchaseCost: 500,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 250, returnedItemIds: [] },
    maxCopies: 1,
  }]);
}

function inventory(ids: number[] = []) {
  return {
    initializedFromSnapshot: true,
    heldByItemId: new Map(ids.map((itemId) => [itemId, {
      itemId,
      instanceId: `item-${itemId}`,
      lifecycle: 1,
      acquiredBy: 'RECONCILE' as const,
      acquiredAtMs: 0,
    }])),
    lifecycleCountByItemId: new Map(ids.map((itemId) => [itemId, 1])),
    nextInstanceSequence: ids.length + 1,
  };
}

function decision(options: { wallet?: number; shop?: 'AVAILABLE' | 'UNKNOWN'; revision?: string } = {}) {
  const wallet = options.wallet;
  const shop = options.shop ?? 'AVAILABLE';
  const stateRevision = options.revision ?? 'revision-a';
  return {
    state: {
      decisionId: `adaptive:${stateRevision}`,
      matchId: 'match-a',
      playerSlot: 0,
      gameTimeSec: 700,
      rulesetId: 'ruleset-a',
      heroId: 10,
      inventory: inventory(),
      economy: {
        spendableSouls: wallet === undefined ? unknownFact<number>('test') : observedFact(wallet, 'test'),
        shopOpportunity: shop === 'UNKNOWN' ? unknownFact('test') : observedFact(shop, 'test'),
      },
    },
    itemGraph: graph(),
    catalogVersionId: 'catalog-a',
    catalogSha256,
    rulesetId: 'ruleset-a',
    localSteamId: 'steam-a',
    enemyHeroIds: [20],
    ourTeamSouls: 100000,
    enemyTeamSouls: 100000,
    stateRevision,
  } as any;
}

function evidence(usable = true) {
  const unavailable = (dataset: string, scopeKey: string) => ({
    dataset,
    scopeKey,
    freshness: 'UNAVAILABLE',
    confidence: 0,
  });
  const fresh = {
    dataset: 'WPA_PATCH_DATA',
    scopeKey: 'patch:15-1',
    snapshotId: 'snapshot-wpa',
    contentSha256: 'b'.repeat(64),
    fetchedAt: '2026-08-31T12:00:00.000Z',
    freshness: 'FRESH',
    confidence: 1,
    payload: { patchId: '15-1', items: [] },
  };
  return {
    heroId: 10,
    rulesetVersion: 'ruleset-a',
    catalogSha256,
    statlockerPatchId: '15-1',
    usable,
    snapshotIds: usable ? ['snapshot-wpa'] : [],
    degradedReasons: usable ? [] : ['WPA_PATCH_DATA:UNAVAILABLE'],
    families: usable
      ? [fresh]
      : [unavailable('WPA_PATCH_DATA', 'patch:15-1')],
    byDataset: {
      WPA_PATCH_DATA: usable ? fresh : unavailable('WPA_PATCH_DATA', 'patch:15-1'),
      VS_HERO_WPA: unavailable('VS_HERO_WPA', 'global'),
      T4_CHAINS: unavailable('T4_CHAINS', 'global'),
      CONSENSUS_SKELETON: unavailable('CONSENSUS_SKELETON', 'hero:10:consensus'),
      WPA_FILTERED_ITEMS: unavailable('WPA_FILTERED_ITEMS', 'hero:10'),
    },
  } as any;
}

function plannerResult() {
  return {
    gameState: 'EVEN',
    nextAction: {
      actionKey: 'BUY_ITEM:1',
      type: 'BUY',
      itemId: 1,
      targetItemId: 1,
      reasonCodes: ['FEASIBLE'],
    },
    recommendedBuild: [{
      itemId: 1,
      position: 1,
      status: 'NEXT',
      score: 0.9,
      confidence: 0.8,
      skeletonStrength: 0.7,
      contextualSupport: 0.2,
      reasonCodes: ['SKELETON_CORE'],
    }],
    changes: [{ type: 'INSERT', itemId: 1, toPosition: 1, reasonCodes: ['PLAN_TARGET_ADDED'] }],
    rankedImmediateCandidates: [
      {
        action: { actionKey: 'BUY_ITEM:1', type: 'BUY', itemId: 1, targetItemId: 1, reasonCodes: ['FEASIBLE'] },
        score: 0.9,
        confidence: 0.8,
        components: [],
        reasonCodes: ['FEASIBLE'],
      },
      {
        action: { actionKey: 'WAIT_SAVE', type: 'WAIT', targetItemId: 1, reasonCodes: ['FEASIBLE'] },
        score: 0.1,
        confidence: 0.5,
        components: [],
        reasonCodes: ['FEASIBLE'],
      },
    ],
    totalScore: 0.9,
    confidence: 0.8,
    plannerVersion: 'adaptive-build-planner-v1',
  } as any;
}

function previousResult() {
  return {
    ready: true,
    blockers: [],
    decisionId: 'old-decision',
    stateRevision: 'revision-old',
    gameState: 'EVEN',
    nextAction: { actionKey: 'HOLD', type: 'HOLD', targetItemId: 1, reasonCodes: ['PLAN_HYSTERESIS'] },
    nextTargetItemId: 1,
    recommendedBuild: plannerResult().recommendedBuild,
    changes: [],
    rankedImmediateCandidates: [],
    totalScore: 1,
    confidence: 0.8,
    scorerVersion: 'adaptive-evidence-scorer-v1',
    plannerVersion: 'adaptive-build-planner-v1',
    configVersion: 'statlocker-adaptive-v1.0.0',
    evidence: {
      rulesetVersion: 'ruleset-a',
      catalogSha256,
      statlockerPatchId: '15-1',
      snapshotIds: ['snapshot-old'],
      families: [],
      degradedReasons: [],
    },
  } as any;
}

function harness(options: {
  states?: any[];
  localEvidence?: any;
  patchId?: string;
  previous?: any;
  plan?: any;
} = {}) {
  const states = options.states ?? [decision({ wallet: 1000 }), decision({ wallet: 1000 })];
  const stateService = {
    build: jest.fn()
      .mockResolvedValueOnce(states[0])
      .mockResolvedValueOnce(states[1] ?? states[0]),
  };
  const evidenceService = {
    resolveLocalPatchId: jest.fn(() => options.patchId ?? '15-1'),
    getLocalEvidence: jest.fn(() => options.localEvidence ?? evidence(true)),
  };
  const planner = {
    version: 'adaptive-build-planner-v1',
    plan: jest.fn(() => options.plan ?? plannerResult()),
  };
  const replay = {
    getPreviousPlan: jest.fn().mockResolvedValue(options.previous),
    toReplayInput: jest.fn(() => ({ snapshotIds: ['snapshot-wpa'] })),
    persist: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AdaptiveRecommendationV1Service(
    stateService as any,
    evidenceService as any,
    planner as any,
    replay as any,
  );
  return { service, stateService, evidenceService, planner, replay };
}

describe('AdaptiveRecommendationV1Service', () => {
  it('has no Chromium collector or V8 runtime constructor dependency', () => {
    const names = (Reflect.getMetadata('design:paramtypes', AdaptiveRecommendationV1Service) ?? [])
      .map((type: any) => type?.name ?? 'unknown');
    expect(names).toEqual([
      'AdaptiveDecisionStateV1Service',
      'StatlockerEvidenceService',
      'AdaptiveBuildPlannerV1Service',
      'AdaptiveReplayV1Service',
    ]);
    expect(names.join('|')).not.toMatch(/BrowserCollector|RecommendationRealtime|RecommendationEngine|Behavioral|Value|Policy/);
  });

  it('re-checks legality on fresh state and never publishes a stale legal BUY', async () => {
    const h = harness({
      states: [
        decision({ wallet: 1000, revision: 'revision-a' }),
        decision({ wallet: undefined, revision: 'revision-b' }),
      ],
    });

    const result = await h.service.recommend({ matchId: 'match-a', localSteamId: 'steam-a' });

    expect(h.stateService.build).toHaveBeenCalledTimes(2);
    expect(result.nextAction.type).toBe('WAIT');
    expect(result.nextAction.actionKey).toBe('WAIT_SAVE');
    expect(result.blockers).toContain('STATE_CHANGED_LEGALITY_RECHECK');
    expect(h.replay.persist).toHaveBeenCalledTimes(1);
    expect(h.replay.persist.mock.calls[0][0].result.nextAction.type).toBe('WAIT');
  });

  it('preserves a previous valid plan conservatively when local Statlocker evidence is unavailable', async () => {
    const previous = previousResult();
    const h = harness({ previous, localEvidence: evidence(false) });

    const result = await h.service.recommend({ matchId: 'match-a', localSteamId: 'steam-a' });

    expect(result.recommendedBuild).toEqual(previous.recommendedBuild);
    expect(['HOLD', 'WAIT', 'CONTINUE_CORE']).toContain(result.nextAction.type);
    expect(result.confidence).toBeLessThan(previous.confidence);
    expect(result.blockers).toContain('STATLOCKER_EVIDENCE_UNAVAILABLE');
  });

  it('returns a safe non-transaction action when no local evidence and no previous plan exist', async () => {
    const h = harness({ localEvidence: evidence(false), previous: undefined });

    const result = await h.service.recommend({ matchId: 'match-a', localSteamId: 'steam-a' });

    expect(['WAIT', 'HOLD', 'CONTINUE_CORE', 'ABSTAIN']).toContain(result.nextAction.type);
    expect(['BUY', 'UPGRADE', 'SELL', 'REPLACE']).not.toContain(result.nextAction.type);
    expect(result.blockers).toContain('STATLOCKER_EVIDENCE_UNAVAILABLE');
  });

  it('does not schedule background collection through the serving evidence path', async () => {
    const h = harness();
    await h.service.recommend({ matchId: 'match-a', localSteamId: 'steam-a' });
    expect(h.evidenceService.getLocalEvidence).toHaveBeenCalledTimes(1);
    expect((h.evidenceService as any).getEvidence).toBeUndefined();
  });
});
