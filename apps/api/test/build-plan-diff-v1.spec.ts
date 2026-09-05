import { diffAdaptiveBuildPlansV1 } from '../src/statlocker-adaptive/build-plan-diff-v1';

function row(itemId: number, position: number, status: 'OWNED' | 'NEXT' | 'PLANNED' = 'PLANNED'): any {
  return {
    itemId,
    position,
    status,
    score: 0,
    confidence: 0,
    skeletonStrength: 0,
    contextualSupport: 0,
    reasonCodes: [],
  };
}

describe('build plan diff v1', () => {
  it('reports stable items, insertions, removals and moves deterministically', () => {
    const previous = [row(1, 1, 'OWNED'), row(2, 2, 'NEXT'), row(3, 3)];
    const next = [row(1, 1, 'OWNED'), row(3, 2, 'NEXT'), row(4, 3)];

    expect(diffAdaptiveBuildPlansV1(previous, next)).toEqual([
      expect.objectContaining({ type: 'KEEP', itemId: 1 }),
      expect.objectContaining({ type: 'MOVE', itemId: 3, fromPosition: 3, toPosition: 2 }),
      expect.objectContaining({ type: 'INSERT', itemId: 4, toPosition: 3 }),
      expect.objectContaining({ type: 'SKIP', itemId: 2, fromPosition: 2 }),
    ]);
  });

  it('collapses an observed one-for-one inventory replacement into a REPLACE change', () => {
    const previous = [row(10, 1, 'OWNED'), row(20, 2, 'NEXT')];
    const next = [row(20, 1, 'OWNED'), row(30, 2, 'NEXT')];

    expect(diffAdaptiveBuildPlansV1(previous, next, [20], [10])).toEqual([
      expect.objectContaining({ type: 'REPLACE', sellItemId: 10, buyItemId: 20 }),
      expect.objectContaining({ type: 'INSERT', itemId: 30, toPosition: 2 }),
    ]);
  });

  it('marks an observed sold item as SELL instead of a generic SKIP', () => {
    expect(diffAdaptiveBuildPlansV1([row(5, 1, 'OWNED')], [], [], [5])).toEqual([
      expect.objectContaining({ type: 'SELL', itemId: 5, fromPosition: 1 }),
    ]);
  });
});
