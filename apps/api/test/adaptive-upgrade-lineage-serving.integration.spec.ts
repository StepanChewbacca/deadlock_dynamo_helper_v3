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
  it.each([
    { label: 'synthetic catalog', componentId: 1, parentId: 2, production: false },
    // Production DB projection verified 2026-09-04, catalog SHA
    // 052d9e976ce52545e77ebd3a82fc4deb565d0df9871ec30b3261e94dea8db8d4.
    { label: 'Opening Rounds production recipe', componentId: 3077079169, parentId: 2064029594, production: true },
  ])('carries $label topology into serving even when upgrade transaction cost is unknown', async ({ componentId, parentId, production }) => {
    const liveMatch = match();
    const items = catalogItems();
    items[0].itemId = componentId;
    items[1].itemId = parentId;
    if (production) {
      Object.assign(items[0], { name: 'High-Velocity Rounds', className: 'upgrade_high_velocity_mag', cost: 800, disabled: null, active: null });
      Object.assign(items[1], { name: 'Opening Rounds', className: 'upgrade_pristine_emblem', cost: 1600, disabled: null, active: null });
    }
    liveMatch.playersBySteamId.local.items = [{ id: parentId, name: items[1].name, className: items[1].className, enhanced: false }];
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
    const itemRepo = { find: jest.fn().mockResolvedValue(items) } as any;
    const recipeRepo = {
      find: jest.fn().mockResolvedValue([{
        catalogVersionId: 'catalog-lineage',
        parentItemId: parentId,
        componentItemId: componentId,
        componentOrder: 0,
      }]),
    } as any;
    const decisionState = new AdaptiveDecisionStateV1Service(
      liveState,
      soulsEvidence,
      versionRepo,
      itemRepo,
      recipeRepo,
      { getRules: jest.fn().mockResolvedValue(undefined) } as any,
    );

    const built = await decisionState.build(liveMatch.matchId, 'local');
    expect(built.itemGraph.getItem(parentId)?.upgradeRecipes).toEqual([]);
    expect(built.itemGraph.getDirectComponentIds(parentId)).toEqual([componentId]);
    expect(built.itemGraph.isTargetSatisfied(componentId, built.state.inventory.heldByItemId.keys())).toBe(true);

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
    const plannerEvidence = evidence();
    plannerEvidence.byDataset.CONSENSUS_SKELETON.payload.groups[0].candidates[0].itemId = componentId;
    const result = planner.plan({ decision, evidence: plannerEvidence });

    expect(result.nextAction.targetItemId).not.toBe(componentId);
    expect(result.recommendedBuild.some((entry) =>
      entry.itemId === componentId && (entry.status === 'NEXT' || entry.status === 'PLANNED'),
    )).toBe(false);
    expect(result.rankedImmediateCandidates.some((entry) => entry.action.targetItemId === componentId)).toBe(false);
    expect(result.recommendedBuild.find((entry) => entry.status === 'NEXT')?.itemId).toBe(3);
  });
});
