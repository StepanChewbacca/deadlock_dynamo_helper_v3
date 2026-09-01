import {
  classifyAdaptiveGameStateV1,
  computeAdaptiveGameStateBlendV1,
} from '../src/statlocker-adaptive/adaptive-game-state';

describe('adaptive game state v1', () => {
  it.each([
    [108000, 100000, 'AHEAD'],
    [92000, 100000, 'BEHIND'],
    [104000, 100000, 'EVEN'],
    [undefined, 100000, 'UNKNOWN'],
    [100000, undefined, 'UNKNOWN'],
    [100000, 0, 'UNKNOWN'],
  ])('classifies %s vs %s as %s', (ours, enemy, expected) => {
    expect(classifyAdaptiveGameStateV1(ours, enemy)).toBe(expected);
  });

  it('blends smoothly around the ahead threshold', () => {
    const below = computeAdaptiveGameStateBlendV1(0.079, 0.08, 0.03);
    const at = computeAdaptiveGameStateBlendV1(0.08, 0.08, 0.03);
    const above = computeAdaptiveGameStateBlendV1(0.081, 0.08, 0.03);

    expect(below.ahead).toBeLessThan(at.ahead);
    expect(at.ahead).toBeLessThan(above.ahead);
    expect(Math.abs(above.ahead - below.ahead)).toBeLessThan(0.1);
    expect(below.even).toBeGreaterThan(at.even);
    expect(at.even).toBeGreaterThan(above.even);
  });

  it('blends smoothly around the behind threshold', () => {
    const aboveBoundary = computeAdaptiveGameStateBlendV1(-0.079, 0.08, 0.03);
    const at = computeAdaptiveGameStateBlendV1(-0.08, 0.08, 0.03);
    const belowBoundary = computeAdaptiveGameStateBlendV1(-0.081, 0.08, 0.03);

    expect(aboveBoundary.behind).toBeLessThan(at.behind);
    expect(at.behind).toBeLessThan(belowBoundary.behind);
    expect(Math.abs(belowBoundary.behind - aboveBoundary.behind)).toBeLessThan(0.1);
  });
});
