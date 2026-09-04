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

  it('never hides a weak pair inside a larger inferred choice through average confidence', () => {
    const profiles = [
      ...Array.from({ length: 3 }, (_, index) => ({
        accountId: `a-${index}`,
        heroId: 10,
        items: [item(200, 600)],
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        accountId: `b-${index}`,
        heroId: 10,
        items: [item(201, 900)],
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        accountId: `c-${index}`,
        heroId: 10,
        items: [item(202, 750)],
      })),
      { accountId: 'empty', heroId: 10, items: [] },
    ];

    const result = deriveSkeleton(10, profiles as any);
    const choices = result.groups.filter((group) => group.type === 'CHOICE');
    const weakPairGroupedTogether = choices.some((group) => {
      const ids = new Set(group.candidates.map((candidate) => candidate.itemId));
      return ids.has(200) && ids.has(201);
    });
    const weakItemGroup = result.groups.find((group) =>
      group.candidates.some((candidate) => candidate.itemId === 201),
    );

    expect(weakPairGroupedTogether).toBe(false);
    expect(weakItemGroup?.type).toBe('OPTIONAL');
  });
});
