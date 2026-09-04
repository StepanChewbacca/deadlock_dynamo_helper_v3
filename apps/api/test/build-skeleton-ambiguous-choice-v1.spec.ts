import { deriveSkeleton } from '../src/statlocker-adaptive/build-skeleton.service';

function item(itemId: number, medianBuyTimeS: number) {
  return {
    itemId,
    purchaseRate: 0.8,
    medianBuyTimeS,
    frequencyTier: 'FREQUENT' as const,
    phase: 'MID' as const,
    relationships: [],
  };
}

describe('BuildSkeletonService ambiguous choice fallback', () => {
  it('keeps choice-like evidence optional when it is below the choice confidence threshold', () => {
    const profiles = [
      ...Array.from({ length: 5 }, (_, index) => ({
        accountId: `a-${index}`,
        heroId: 10,
        items: [item(200, 600)],
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        accountId: `b-${index}`,
        heroId: 10,
        items: [item(201, 900)],
      })),
    ];

    const result = deriveSkeleton(10, profiles);
    const groups = result.groups.filter((group) =>
      group.candidates.some((candidate) => candidate.itemId === 200 || candidate.itemId === 201),
    );

    expect(groups.filter((group) => group.type === 'CHOICE')).toHaveLength(0);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.type === 'OPTIONAL')).toBe(true);
  });
});
