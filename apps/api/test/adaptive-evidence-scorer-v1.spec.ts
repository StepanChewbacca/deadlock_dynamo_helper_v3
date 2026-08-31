import {
  AdaptiveEvidenceScorerV1Service,
  aggregateExactEnemyEvidenceV1,
  shrinkConfidenceV1,
} from '../src/statlocker-adaptive/adaptive-evidence-scorer-v1.service';
import { ADAPTIVE_POLICY_V1_CONFIG } from '../src/statlocker-adaptive/statlocker-adaptive.config';

function family(dataset: string, payload: any, confidence = 1) {
  return {
    dataset,
    scopeKey: dataset === 'CONSENSUS_SKELETON' ? 'hero:10:consensus' : 'global',
    snapshotId: `${dataset}-snapshot`,
    contentSha256: 'a'.repeat(64),
    freshness: confidence === 1 ? 'FRESH' : 'STALE_USABLE',
    confidence,
    payload,
  } as any;
}

function evidence(exactCount = 600, familyConfidence = 1) {
  const wpa = {
    patchId: '15-1',
    items: [{
      heroId: 10,
      itemId: 100,
      meanWpa: 0.12,
      sampleSize: 1000,
      wpaConfidence: 0.9,
      gameState: { ahead: 0.08, even: 0.12, behind: 0.18 },
      purchaseTiming: { medianPurchaseSec: 720 },
      laneWpa: 0.06,
      postLaneWpa: 0.10,
      enemyComposition: { spirit: 0.07 },
      ownBuild: { burst: 0.09 },
    }],
  };
  const slices = Array.from({ length: 6 }, (_, index) => ({
    heroId: 10,
    enemyHeroId: 20 + index,
    items: [{ itemId: 100, deltaWpa: 0.25 - index * 0.02, count: exactCount }],
  }));
  const skeleton = {
    heroId: 10,
    profileCount: 10,
    items: [{
      itemId: 100,
      medianBuyTimeS: 700,
      strength: 0.95,
      tier: 'CORE',
      components: { coverage: 1, purchaseRate: 0.9, frequencyTier: 1, orderConsistency: 0.9, relationship: 0.8 },
    }],
  };
  const chains = {
    chains: [{ heroId: 10, itemIds: [50, 100], sampleSize: 500, meanWpa: 0.1 }],
  };
  return {
    heroId: 10,
    rulesetVersion: 'ruleset-a',
    catalogSha256: 'b'.repeat(64),
    statlockerPatchId: '15-1',
    usable: true,
    snapshotIds: [],
    degradedReasons: [],
    families: [],
    byDataset: {
      WPA_PATCH_DATA: family('WPA_PATCH_DATA', wpa, familyConfidence),
      VS_HERO_WPA: family('VS_HERO_WPA', { slices }, familyConfidence),
      T4_CHAINS: family('T4_CHAINS', chains, familyConfidence),
      CONSENSUS_SKELETON: family('CONSENSUS_SKELETON', skeleton, familyConfidence),
      WPA_FILTERED_ITEMS: family('WPA_FILTERED_ITEMS', { heroId: 10, items: wpa.items }, familyConfidence),
    },
  } as any;
}

const context = {
  heroId: 10,
  enemyHeroIds: [20, 21, 22, 23, 24, 25],
  gameTimeSec: 700,
  gameStateBlend: { ahead: 0, even: 1, behind: 0 },
  ownedItemIds: [50],
  plannedPrefixItemIds: [] as number[],
  enemyCompositionKey: 'spirit',
  ownBuildArchetype: 'burst',
  transactionPenalty: 0.2,
  churnPenalty: 0.1,
};

describe('AdaptiveEvidenceScorerV1Service', () => {
  it('uses n/(n+k) confidence shrinkage monotonically', () => {
    expect(shrinkConfidenceV1(0, 500)).toBe(0);
    expect(shrinkConfidenceV1(500, 500)).toBeCloseTo(0.5);
    expect(shrinkConfidenceV1(1000, 500)).toBeGreaterThan(shrinkConfidenceV1(100, 500));
  });

  it('aggregates at most top three exact-enemy slices by weighted mean', () => {
    const result = aggregateExactEnemyEvidenceV1(
      (evidence().byDataset.VS_HERO_WPA.payload as any).slices,
      10,
      100,
      context.enemyHeroIds,
      3,
      500,
    );
    expect(result.usedCount).toBe(3);
    expect(result.normalized).toBeLessThanOrEqual(1);
    expect(result.normalized).toBeGreaterThanOrEqual(-1);
  });

  it('clamps every score component to [-1, 1]', () => {
    const scorer = new AdaptiveEvidenceScorerV1Service();
    const result = scorer.scoreItem(100, { ...context, evidence: evidence() });
    for (const component of result.components) {
      expect(component.normalized).toBeGreaterThanOrEqual(-1);
      expect(component.normalized).toBeLessThanOrEqual(1);
    }
  });

  it('prevents a huge low-sample matchup delta from independently overpowering a strong core prior', () => {
    const lowSample = evidence(11);
    const scorer = new AdaptiveEvidenceScorerV1Service();
    const result = scorer.scoreItem(100, { ...context, evidence: lowSample });
    const skeleton = result.components.find((component) => component.key === 'skeletonPrior');
    const exact = result.components.find((component) => component.key === 'exactEnemyFit');
    expect(skeleton?.weighted ?? 0).toBeGreaterThan(Math.abs(exact?.weighted ?? 0));
  });

  it('reduces overall confidence when otherwise identical evidence becomes stale', () => {
    const scorer = new AdaptiveEvidenceScorerV1Service();
    const fresh = scorer.scoreItem(100, { ...context, evidence: evidence(600, 1) });
    const stale = scorer.scoreItem(100, { ...context, evidence: evidence(600, 0.4) });
    expect(stale.confidence).toBeLessThan(fresh.confidence);
  });

  it('emits explainable base/game/timing/lane/chain/context and penalty components', () => {
    const scorer = new AdaptiveEvidenceScorerV1Service();
    const result = scorer.scoreItem(100, { ...context, evidence: evidence() });
    const keys = result.components.map((component) => component.key);
    expect(keys).toEqual(expect.arrayContaining([
      'skeletonPrior',
      'baseWpa',
      'gameStateFit',
      'exactEnemyFit',
      'enemyCompositionFit',
      'ownBuildFit',
      'timingFit',
      'laneFit',
      'chainFit',
      'skeletonDeviation',
      'transaction',
      'churn',
    ]));
    expect(result.version).toBe('adaptive-evidence-scorer-v1');
    expect(ADAPTIVE_POLICY_V1_CONFIG.exactEnemyMaxMatchups).toBe(3);
  });
});
