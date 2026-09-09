import { readFileSync } from 'fs';
import { join } from 'path';
import { StatlockerNormalizerService } from '../src/statlocker-adaptive/statlocker-normalizer.service';

const PATCH_ID = '676255623445218601';
const FIXTURE_PATH = join(__dirname, 'fixtures', 'statlocker-vs-hero-wpa-v1.json');

describe('VS_HERO_WPA roadmap raw fixture V1', () => {
  const normalizer = new StatlockerNormalizerService();

  it('captures the required multi-rank raw evidence cases', () => {
    const raw = readFixture();
    const byRank = raw.by_patch[`patch_${PATCH_ID}`].by_rank;
    const rankBuckets = Object.keys(byRank);

    expect(rankBuckets.length).toBeGreaterThanOrEqual(2);

    const leaves = rankBuckets.flatMap((rankBucket) => {
      const byHero = byRank[rankBucket].by_hero;
      const ourHero = byHero.Abrams;
      expect(ourHero).toBeDefined();
      expect(Object.keys(ourHero).length).toBeGreaterThanOrEqual(3);

      return Object.values(ourHero).flatMap((matchups) =>
        Object.entries(matchups).map(([enemyName, leaf]) => ({ enemyName, leaf })),
      );
    });

    const enemyNames = new Set(
      leaves.filter(({ enemyName }) => enemyName !== '_baseline').map(({ enemyName }) => enemyName),
    );
    expect(enemyNames.size).toBeGreaterThanOrEqual(3);
    expect(leaves.some(({ enemyName }) => enemyName === '_baseline')).toBe(true);

    const matchupLeaves = leaves.filter(({ enemyName }) => enemyName !== '_baseline');
    expect(matchupLeaves.every(({ leaf }) =>
      Number.isFinite(leaf.mean_wpa) &&
      Number.isFinite(leaf.count) &&
      Number.isFinite(leaf.delta_wpa),
    )).toBe(true);
    expect(matchupLeaves.some(({ leaf }) => leaf.count <= 10 && leaf.delta_wpa >= 0.05)).toBe(true);
    expect(matchupLeaves.some(({ leaf }) => leaf.count >= 1000 && leaf.delta_wpa > 0 && leaf.delta_wpa < 0.02)).toBe(true);
    expect(matchupLeaves.some(({ leaf }) => leaf.delta_wpa < 0)).toBe(true);
  });

  it('documents current count-weighted rank collapse and ignored matchup mean_wpa', () => {
    const normalized = normalizer.normalizeVsHeroWpa(readFixture(), PATCH_ID);
    const apollo = normalized.payload.slices.find((slice) =>
      slice.heroId === 6 && slice.enemyHeroId === 77,
    );
    const arcaneSurge = apollo?.items.find((item) => item.itemId === 1150006784);

    expect(arcaneSurge).toMatchObject({
      itemId: 1150006784,
      count: 100,
    });
    expect(arcaneSurge?.deltaWpa).toBeCloseTo(0.007, 12);
    expect(arcaneSurge).not.toHaveProperty('meanWpa');
  });
});

type RawLeaf = {
  mean_wpa: number;
  count: number;
  delta_wpa: number;
};

type RawFixture = {
  by_patch: Record<string, {
    by_rank: Record<string, {
      by_hero: Record<string, Record<string, Record<string, RawLeaf>>>;
    }>;
  }>;
};

function readFixture(): RawFixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as RawFixture;
}
