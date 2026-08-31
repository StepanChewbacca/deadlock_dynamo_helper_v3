import {
  StatlockerDatasetValidationError,
  StatlockerNormalizerService,
} from '../src/statlocker-adaptive/statlocker-normalizer.service';
import { statlockerV1Fixtures } from './fixtures/statlocker-v1';

describe('StatlockerNormalizerService', () => {
  const service = new StatlockerNormalizerService();

  it('normalizes the required aggregate evidence families deterministically', () => {
    const patches = service.normalizePatches(statlockerV1Fixtures.patches);
    expect(patches.currentMinorPatchId).toBe('15-1');

    const wpa = service.normalizeWpaPatchData(statlockerV1Fixtures.patchData, '15-1');
    expect(wpa.payload.items[0]).toMatchObject({
      heroId: 10,
      itemId: 100,
      meanWpa: 0.12,
      sampleSize: 1000,
      wpaConfidence: 0.8,
      laneWpa: 0.05,
      postLaneWpa: 0.11,
    });
    expect(wpa.payload.items[0].gameState).toEqual({ ahead: 0.10, even: 0.14, behind: 0.18 });
    expect(wpa.payload.items[0].purchaseTiming.medianPurchaseSec).toBe(720);
    expect(wpa.payload.items[0].enemyComposition).toEqual({ spirit: 0.07 });
    expect(wpa.payload.items[0].ownBuild).toEqual({ burst: 0.09 });

    const vs = service.normalizeVsHeroWpa(statlockerV1Fixtures.vsHero, '15-1');
    expect(vs.payload.slices[0]).toEqual({
      heroId: 10,
      enemyHeroId: 20,
      items: [{ itemId: 100, deltaWpa: 0.20, count: 600 }],
    });

    const chains = service.normalizeT4Chains(statlockerV1Fixtures.t4Chains, '15-1');
    expect(chains.payload.chains.map((chain) => chain.itemIds)).toEqual([[100, 101], [100, 101, 102]]);

    const leaderboard = service.normalizeHeroLeaderboard(statlockerV1Fixtures.leaderboard, '15-1', 10);
    expect(leaderboard.payload.profiles[0].accountId).toBe('101');

    const pro = service.normalizeProBuildAnalysis(statlockerV1Fixtures.proBuild, '15-1', '101', 10);
    expect(pro.payload.items[0]).toMatchObject({
      purchaseRate: 0.9,
      medianBuyTimeS: 630,
      frequencyTier: 'CORE',
      phase: 'mid',
    });
    expect(pro.payload.items[0].relationships).toEqual([{ itemId: 101, strength: 0.7 }]);

    const filtered = service.normalizeWpaFilteredItems(statlockerV1Fixtures.filteredItems, '15-1', 10);
    expect(filtered.payload.items[0].meanWpa).toBe(0.13);
    expect(wpa.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(service.normalizeWpaPatchData({ ...statlockerV1Fixtures.patchData }, '15-1').contentSha256)
      .toBe(wpa.contentSha256);
  });

  it('rejects structurally incomplete or non-finite primary evidence', () => {
    expect(() => service.normalizeWpaPatchData({ patch: '15-1', items: [] }, '15-1'))
      .toThrow(StatlockerDatasetValidationError);
    expect(() => service.normalizeWpaPatchData({
      patch: '15-1',
      items: [{ hero_id: 10, item_id: 100, mean_wpa: Number.NaN, sample_size: 1 }],
    }, '15-1')).toThrow(StatlockerDatasetValidationError);
    expect(() => service.normalizeVsHeroWpa({ data: [] }, '15-1'))
      .toThrow(StatlockerDatasetValidationError);
    expect(() => service.normalizeProBuildAnalysis({ account_id: '101', hero_id: 10, items: [{}] }, '15-1', '101', 10))
      .toThrow(StatlockerDatasetValidationError);
  });
});
