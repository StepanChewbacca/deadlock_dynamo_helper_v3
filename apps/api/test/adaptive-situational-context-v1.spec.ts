import { evaluateSituationalCandidateV1 } from '../src/statlocker-adaptive/adaptive-situational-context-v1.service';

function evidence() {
  const family = {
    dataset: 'VS_HERO_WPA' as const,
    scopeKey: 'global',
    freshness: 'FRESH' as const,
    confidence: 1,
    payload: {
      slices: [
        { heroId: 1, enemyHeroId: 10, items: [{ itemId: 100, deltaWpa: 0.12, count: 5000 }] },
        { heroId: 1, enemyHeroId: 20, items: [{ itemId: 100, deltaWpa: 0.08, count: 4000 }] },
        { heroId: 1, enemyHeroId: 30, items: [{ itemId: 100, deltaWpa: -0.05, count: 5000 }] },
      ],
    },
  };
  const unavailable = (dataset: any) => ({
    dataset,
    scopeKey: 'x',
    freshness: 'UNAVAILABLE' as const,
    confidence: 0,
  });
  return {
    heroId: 1,
    rulesetVersion: 'r1',
    catalogSha256: 'a'.repeat(64),
    statlockerPatchId: 'p1',
    usable: true,
    snapshotIds: ['s1'],
    degradedReasons: [],
    families: [
      unavailable('WPA_PATCH_DATA'),
      family,
      unavailable('T4_CHAINS'),
      unavailable('CONSENSUS_SKELETON'),
      unavailable('WPA_FILTERED_ITEMS'),
    ],
    byDataset: {
      WPA_PATCH_DATA: unavailable('WPA_PATCH_DATA'),
      VS_HERO_WPA: family,
      T4_CHAINS: unavailable('T4_CHAINS'),
      CONSENSUS_SKELETON: unavailable('CONSENSUS_SKELETON'),
      WPA_FILTERED_ITEMS: unavailable('WPA_FILTERED_ITEMS'),
    },
  } as any;
}

const window = {
  windowId: 'situational-1',
  open: true,
  maxItems: 1,
  maxSoulsDelay: 3200,
  reservedSlots: 1,
  allowedPurposes: ['CATCH' as const],
};

describe('evaluateSituationalCandidateV1', () => {
  it('returns supported current enemy targets as observational matchup evidence', () => {
    const result = evaluateSituationalCandidateV1({
      heroId: 1,
      itemId: 100,
      enemyHeroIds: [10, 20, 30],
      evidence: evidence(),
      purpose: 'CATCH',
      window,
      candidateScore: 0.8,
      candidateConfidence: 0.8,
      coreScore: 0.5,
      coreConfidence: 0.7,
      nextCoreTargetItemId: 200,
      estimatedCoreDelaySouls: 1600,
    });

    expect(result.accepted).toBe(true);
    expect(result.context?.targetEnemies.map((entry) => entry.enemyHeroId)).toEqual([10, 20]);
    expect(result.context?.targetEnemies[0].role).toBe('PRIMARY');
    expect(result.context?.targetEnemies.every((entry) => entry.evidenceKinds.includes('MATCHUP_STAT'))).toBe(true);
    expect(result.context?.targetEnemies.every((entry) => !entry.evidenceKinds.includes('MECHANICAL_COUNTER'))).toBe(true);
  });

  it('never displays a hero that is not in the current enemy roster', () => {
    const result = evaluateSituationalCandidateV1({
      heroId: 1,
      itemId: 100,
      enemyHeroIds: [20],
      evidence: evidence(),
      purpose: 'CATCH',
      window,
      candidateScore: 0.8,
      candidateConfidence: 0.8,
      coreScore: 0.5,
      coreConfidence: 0.7,
      estimatedCoreDelaySouls: 800,
    });

    expect(result.context?.targetEnemies.map((entry) => entry.enemyHeroId)).toEqual([20]);
  });

  it('returns to core when the situational candidate does not beat the baseline', () => {
    const result = evaluateSituationalCandidateV1({
      heroId: 1,
      itemId: 100,
      enemyHeroIds: [10, 20],
      evidence: evidence(),
      purpose: 'CATCH',
      window,
      candidateScore: 0.54,
      candidateConfidence: 0.8,
      coreScore: 0.5,
      coreConfidence: 0.7,
      estimatedCoreDelaySouls: 800,
    });

    expect(result).toEqual({ accepted: false, reasonCodes: ['CONTINUE_CORE_STRONGER'] });
  });

  it('rejects stale exact-enemy evidence', () => {
    const stale = evidence();
    stale.byDataset.VS_HERO_WPA.freshness = 'STALE_USABLE';
    const result = evaluateSituationalCandidateV1({
      heroId: 1,
      itemId: 100,
      enemyHeroIds: [10],
      evidence: stale,
      purpose: 'CATCH',
      window,
      candidateScore: 0.8,
      candidateConfidence: 0.8,
      coreScore: 0.5,
      coreConfidence: 0.7,
      estimatedCoreDelaySouls: 800,
    });

    expect(result.accepted).toBe(false);
    expect(result.reasonCodes).toEqual(['SITUATIONAL_MATCHUP_EVIDENCE_NOT_FRESH']);
  });

  it('preserves a previous target when the new leader does not clear switch hysteresis', () => {
    const result = evaluateSituationalCandidateV1({
      heroId: 1,
      itemId: 100,
      enemyHeroIds: [10, 20],
      evidence: evidence(),
      purpose: 'CATCH',
      window,
      candidateScore: 0.8,
      candidateConfidence: 0.8,
      coreScore: 0.5,
      coreConfidence: 0.7,
      estimatedCoreDelaySouls: 800,
      previousTargetEnemyHeroIds: [20],
    });

    expect(result.context?.targetEnemies[0].enemyHeroId).toBe(20);
  });
});
