import 'reflect-metadata';
import { observedFact } from '@deadlock-live-probe/build-domain';
import { MinimalMatchState } from '@deadlock-live-probe/shared';
import { AdaptiveDecisionStateV1Service } from '../src/statlocker-adaptive/adaptive-decision-state-v1.service';
import { AdaptiveBuildPlannerV1Service } from '../src/statlocker-adaptive/adaptive-build-planner-v1.service';
import { AdaptiveEvidenceScorerV1Service } from '../src/statlocker-adaptive/adaptive-evidence-scorer-v1.service';

const catalogSha256 = 'a'.repeat(64);

function match(): MinimalMatchState {
  return {
    matchId: 'match-lineage-serving',
    gameTimeSec: 327,
    lastUpdatedAt: new Date().toISOString(),
    playersBySteamId: {
      local: {
        steamId: 'local',
        playerName: 'Local',
        isLocal: true,
        heroId: 10,
        teamId: 1,
        souls: 5_000,
        items: [{ id: 2, name: 'Owned upgrade', className: 'item-2', enhanced: false }],
      },
      enemy: {
        steamId: 'enemy',
        playerName: 'Enemy',
        heroId: 20,
        teamId: 2,
        souls: 5_000,
        items: [],
      },
    },
  };
}

function catalogItems() {
  return [
    {
      catalogVersionId: 'catalog-lineage',
      itemId: 1,
      name: 'Lower component',
      className: 'item-1',
      slotType: 'weapon',
      cost: 500,
      tier: 1,
      shopable: true,
      disabled: false,
      active: true,
      isActiveItem: false,
      rawPayload: {},
    },
    {
      catalogVersionId: 'catalog-lineage',
      itemId: 2,
      name: 'Owned upgrade',
      className: 'item-2',
      slotType: 'weapon',
      cost: 1_250,
      tier: 2,
      shopable: true,
      disabled: false,
      active: true,
      isActiveItem: false,
      rawPayload: {},
    },
    {
      catalogVersionId: 'catalog-lineage',
      itemId: 3,
      name: 'Next target',
      className: 'item-3',
      slotType: 'vitality',
      cost: 500,
      tier: 1,
      shopable: true,
      disabled: false,
      active: true,
      isActiveItem: false,
      rawPayload: {},
    },
  ];
}

function group(groupId: string, itemId: number) {
  return {
    groupId,
    phase: 'EARLY',
    type: 'REQUIRED',
    minSelect: 1,
    maxSelect: 1,
    candidates: [{
      itemId,
      strength: 0.9,
      coverage: 0.9,
      purchaseRate: 0.9,
      medianBuyTimeS: 300,
      timingSpreadS: 30,
      sourceProfileCount: 10,
      frequencyTier: 'CORE',
      rushEvidence: false,
    }],
    confidence: 0.9,
    inferred: false,
  };
}

function family(dataset: string, payload: any) {
  return {
    dataset,
    scopeKey: dataset === 'CONSENSUS_SKELETON' ? 'hero:10:consensus' : 'global',
    snapshotId: `${dataset}-snapshot`,
    contentSha256: 'b'.repeat(64),
    freshness: 'FRESH',
    confidence: 1,
    payload,
  } as any;
}

function evidence() {
  const byDataset = {
    WPA_PATCH_DATA: family('WPA_PATCH_DATA', { patchId: '15-1', items: [] }),
    VS_HERO_WPA: family('VS_HERO_WPA', { slices: [] }),
    T4_CHAINS: family('T4_CHAINS', { chains: [] }),
    CONSENSUS_SKELETON: family('CONSENSUS_SKELETON', {
      heroId: 10,
      profileCount: 10,
      groups: [group('lower-core', 1), group('next-core', 3)],
    }),
    WPA_FILTERED_ITEMS: family('WPA_FILTERED_ITEMS', { heroId: 10, items: [] }),
  };
  return {
    heroId: 10,
    rulesetVersion: 'ruleset-a',
    catalogSha256,
    statlockerPatchId: '15-1',
    usable: true,
    snapshotIds: Object.values(byDataset).map((entry) => entry.snapshotId).sort(),
    degradedReasons: [],
    families: Object.values(byDataset),
    byDataset,
  } as any;
}

describe('adaptive upgrade-lineage serving integration', () => {
  it('carries DB recipe topology into the serving graph even when upgrade transaction cost is unknown', async () => {
    const liveMatch = match();
    const liveState = { getState: jest.fn(() => liveMatch) } as any;
    const soulsEvidence = { canVerifyScope: jest.fn().mockResolvedValue(true) } as any;
    const versionRepo = {
      find: jest.fn().mockResolvedValue([{
        catalogVersionId: 'catalog-lineage',
        rulesetKey: 'ruleset-a',
        source: 'TEST',
        payloadSha256: catalogSha256,
        importedAt: new Date('2026-09-04T12:00:00.000Z'),
      }]),
    } as any;
    const itemRepo = { find: jest.fn().mockResolvedValue(catalogItems()) } as any;
    const recipeRepo = {
      find: jest.fn().mockResolvedValue([{
        catalogVersionId: 'catalog-lineage',
        parentItemId: 2,
        componentItemId: 1,
        componentOrder: 0,
      }]),
    } as any;
    const decisionState = new AdaptiveDecisionStateV1Service(
      liveState,
      soulsEvidence,
      versionRepo,
      itemRepo,
      recipeRepo,
    );

    const built = await decisionState.build(liveMatch.matchId, 'local');
    expect(built.itemGraph.getItem(2)?.upgradeRecipes).toEqual([]);
    expect(built.itemGraph.getDirectComponentIds(2)).toEqual([1]);
    expect(built.itemGraph.isTargetSatisfied(1, built.state.inventory.heldByItemId.keys())).toBe(true);

    const decision = {
      ...built,
      state: {
        ...built.state,
        economy: {
          spendableSouls: observedFact(5_000, 'integration'),
          shopOpportunity: observedFact('AVAILABLE' as const, 'integration'),
        },
      },
    };
    const planner = new AdaptiveBuildPlannerV1Service(new AdaptiveEvidenceScorerV1Service());
    const result = planner.plan({ decision, evidence: evidence() });

    expect(result.nextAction.targetItemId).not.toBe(1);
    expect(result.recommendedBuild.some((entry) =>
      entry.itemId === 1 && (entry.status === 'NEXT' || entry.status === 'PLANNED'),
    )).toBe(false);
    expect(result.rankedImmediateCandidates.some((entry) => entry.action.targetItemId === 1)).toBe(false);
    expect(result.recommendedBuild.find((entry) => entry.status === 'NEXT')?.itemId).toBe(3);
  });
});
