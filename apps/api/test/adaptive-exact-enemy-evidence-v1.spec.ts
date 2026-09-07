import { aggregateExactEnemyEvidenceV1 } from '../src/statlocker-adaptive/adaptive-evidence-scorer-v1.service';

const slices = [
  {
    heroId: 1,
    enemyHeroId: 20,
    items: [{ itemId: 100, deltaWpa: 0.08, count: 800 }],
  },
  {
    heroId: 1,
    enemyHeroId: 10,
    items: [{ itemId: 100, deltaWpa: 0.05, count: 2000 }],
  },
  {
    heroId: 1,
    enemyHeroId: 30,
    items: [{ itemId: 100, deltaWpa: -0.03, count: 1000 }],
  },
];

describe('aggregateExactEnemyEvidenceV1', () => {
  it('returns deterministic ranked per-enemy contributions without changing aggregate math', () => {
    const result = aggregateExactEnemyEvidenceV1(slices, 1, 100, [10, 20, 30], 3, 500);

    expect(result.contributions).toHaveLength(3);
    expect(result.contributions.map((entry) => entry.enemyHeroId)).toEqual(
      [...result.contributions]
        .sort((a, b) => b.priority - a.priority || b.confidence - a.confidence || a.enemyHeroId - b.enemyHeroId)
        .map((entry) => entry.enemyHeroId),
    );
    expect(result.contributions.every((entry) => Number.isFinite(entry.deltaWpa))).toBe(true);
    expect(result.usedCount).toBe(3);
  });

  it('includes only current enemy roster heroes', () => {
    const result = aggregateExactEnemyEvidenceV1(slices, 1, 100, [20], 3, 500);
    expect(result.contributions.map((entry) => entry.enemyHeroId)).toEqual([20]);
  });
});
