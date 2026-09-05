import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { HistoricalBuildTrajectorySourceV2Service } from '../src/statlocker-adaptive/historical-build-trajectory-source-v2.service';
import { HistoricalPlannerTrajectoryExtractorV2Service } from '../src/statlocker-adaptive/historical-planner-trajectory-extractor-v2.service';
import { RecommendationEconomyRulesV1 } from '../src/statlocker-adaptive/adaptive-economy-v1';
import { MissingRawMatchMetadataError } from '../src/deadlock-live/ruleset-resolver.service';

const graph = createRecommendationItemGraph([
  { itemId: 1, name: 'A', slotType: 'weapon', active: false, availableRulesetIds: ['r1'], directPurchaseCost: 800, upgradeRecipes: [], sellTransition: { soulsRefund: 400, returnedItemIds: [] } },
  { itemId: 2, name: 'B', slotType: 'vitality', active: false, availableRulesetIds: ['r1'], directPurchaseCost: 800, upgradeRecipes: [], sellTransition: { soulsRefund: 400, returnedItemIds: [] } },
]);
const economyRules: RecommendationEconomyRulesV1 = {
  rulesetId: 'r1', catalogSha256: 'a'.repeat(64), baseSlots: 12,
  baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 }, maxFlexSlots: 4, maxActiveItems: 4,
  investmentBreakpoints: { weapon: [1600], vitality: [1600], spirit: [1600] },
};

function repository() {
  const target: any = {
    id: 10,
    matchId: 100,
    heroId: 1,
    team: 0,
    won: true,
    match: { matchId: 100, averageBadge: 67 },
    itemPurchases: [{ itemId: 1, purchaseTimeS: 100, soldTimeS: null, upgradeId: null }],
  };
  const peers = [
    target,
    { id: 11, matchId: 100, heroId: 2, team: 0, won: true },
    { id: 12, matchId: 100, heroId: 3, team: 1, won: false },
  ];
  return {
    find: jest.fn(async (options: any) => options?.where?.heroId === 1 ? [target] : peers),
  } as any;
}

function resolution(overrides: Partial<any> = {}) {
  return {
    matchId: 100,
    rawMetadataId: 1,
    method: 'OBSERVED',
    confidence: 1,
    clientVersion: 123,
    rulesetKey: 'r1',
    details: {},
    ...overrides,
  };
}

function sourceForResolution(resolved: any, error?: Error) {
  return new HistoricalBuildTrajectorySourceV2Service(
    repository(),
    new HistoricalPlannerTrajectoryExtractorV2Service(),
    { getLatestForMatch: jest.fn(async () => {
      if (error) throw error;
      return resolved;
    }) } as any,
  );
}

function multiMatchRepository(reversePeers = false) {
  const targets: any[] = [
    {
      id: 20,
      matchId: 101,
      heroId: 1,
      team: 1,
      won: false,
      match: { matchId: 101, averageBadge: 42 },
      itemPurchases: [{ itemId: 2, purchaseTimeS: 200, soldTimeS: null, upgradeId: null }],
    },
    {
      id: 10,
      matchId: 100,
      heroId: 1,
      team: 0,
      won: true,
      match: { matchId: 100, averageBadge: 67 },
      itemPurchases: [{ itemId: 1, purchaseTimeS: 100, soldTimeS: null, upgradeId: null }],
    },
  ];
  const peerRows: any[] = [
    targets[0],
    { id: 21, matchId: 101, heroId: 3, team: 1 },
    { id: 22, matchId: 101, heroId: 4, team: 0 },
    targets[1],
    { id: 11, matchId: 100, heroId: 2, team: 0 },
    { id: 12, matchId: 100, heroId: 3, team: 1 },
  ];
  const rows = reversePeers ? [...peerRows].reverse() : peerRows;
  const peerFindCalls: any[] = [];
  const repository = {
    peerFindCalls,
    find: jest.fn(async (options: any) => {
      if (options?.where?.heroId === 1) return targets;
      peerFindCalls.push(options);
      const matchId = options?.where?.matchId;
      const matchIds = Array.isArray(matchId?._value) ? matchId._value : [matchId];
      return rows.filter((row) => matchIds.includes(row.matchId));
    }),
  };
  return repository as any;
}

const sourceInput = {
  heroId: 1,
  patchId: 'p1',
  rulesetId: 'r1',
  catalogSha256: 'a'.repeat(64),
  catalogClientVersion: 123,
  itemGraph: graph,
  economyRules,
  limit: 100,
};

describe('historical build trajectory source v2', () => {
  it('batches peer loading across target matches and keeps equivalent output byte-for-byte deterministic', async () => {
    const repositoryA = multiMatchRepository();
    const repositoryB = multiMatchRepository(true);
    const resolver = {
      getLatestForMatch: jest.fn(async (matchId: number) => resolution({ matchId })),
    } as any;
    const sourceA = new HistoricalBuildTrajectorySourceV2Service(
      repositoryA,
      new HistoricalPlannerTrajectoryExtractorV2Service(),
      resolver,
    );
    const sourceB = new HistoricalBuildTrajectorySourceV2Service(
      repositoryB,
      new HistoricalPlannerTrajectoryExtractorV2Service(),
      resolver,
    );

    const resultA = await sourceA.load(sourceInput);
    const resultB = await sourceB.load(sourceInput);

    expect(repositoryA.peerFindCalls).toHaveLength(1);
    expect(repositoryA.peerFindCalls[0].where.matchId._value).toEqual([101, 100]);
    expect(repositoryA.peerFindCalls[0].relations).toBeUndefined();
    expect(repositoryA.peerFindCalls[0].select).toEqual({
      id: true,
      matchId: true,
      heroId: true,
      team: true,
    });
    expect(JSON.stringify(resultA)).toBe(JSON.stringify(resultB));
  });

  it('loads exact per-match purchase history with ally/enemy and rank cohort context', async () => {
    const source = new HistoricalBuildTrajectorySourceV2Service(
      repository(),
      new HistoricalPlannerTrajectoryExtractorV2Service(),
      { getLatestForMatch: jest.fn(async () => resolution()) } as any,
    );

    const result = await source.load(sourceInput);

    expect(result.rejected).toEqual([]);
    expect(result.trajectories).toHaveLength(1);
    expect(result.trajectories[0]).toMatchObject({
      matchId: '100',
      playerKey: '100:player:10',
      heroId: 1,
      rankCohort: 'badge:60-69',
      allyHeroIds: [2],
      enemyHeroIds: [3],
      finalOutcome: 1,
    });
  });

  it.each([
    ['OBSERVED', resolution({ method: 'OBSERVED' })],
    ['DEMO_METADATA', resolution({ method: 'DEMO_METADATA' })],
  ])('accepts %s provenance when its exact ruleset and client version match', async (_method, resolved) => {
    const result = await sourceForResolution(resolved).load(sourceInput);

    expect(result.rejected).toEqual([]);
    expect(result.trajectories).toHaveLength(1);
  });

  it.each([
    ['TIME_WINDOW', resolution({ method: 'TIME_WINDOW' }), 'HISTORICAL_PROVENANCE_NOT_EXACT'],
    ['UNKNOWN', resolution({ method: 'UNKNOWN' }), 'HISTORICAL_PROVENANCE_NOT_EXACT'],
    ['wrong ruleset', resolution({ rulesetKey: 'r2' }), 'HISTORICAL_RULESET_MISMATCH'],
    ['wrong client version', resolution({ clientVersion: 124 }), 'HISTORICAL_CLIENT_VERSION_MISMATCH'],
  ])('rejects %s historical provenance with an explicit diagnostic', async (_case, resolved, diagnostic) => {
    const result = await sourceForResolution(resolved).load(sourceInput);

    expect(result.trajectories).toEqual([]);
    expect(result.rejected).toEqual([{
      matchId: '100',
      playerKey: '100:player:10',
      diagnostics: [diagnostic],
    }]);
  });

  it('rejects a match when no raw metadata can be resolved', async () => {
    const result = await sourceForResolution(undefined, new MissingRawMatchMetadataError(100))
      .load(sourceInput);

    expect(result.trajectories).toEqual([]);
    expect(result.rejected).toEqual([{
      matchId: '100',
      playerKey: '100:player:10',
      diagnostics: ['HISTORICAL_PROVENANCE_MISSING'],
    }]);
  });

  it('propagates unexpected resolver failures instead of mining a partial sample', async () => {
    await expect(
      sourceForResolution(undefined, new Error('ruleset metadata repository unavailable')).load(sourceInput),
    ).rejects.toThrow('ruleset metadata repository unavailable');
  });
});
