import {
  applyInventoryAction,
  createEmptyInventoryState,
  createRecipeGraph,
  DEFAULT_INVENTORY_RULESET,
  getHeldItemCount,
  getHeldItemIdsWithMultiplicity,
  getHeldItemInstances,
  InventoryRuleset,
} from '../src';

const metadata = {
  observedAtMs: 1,
  evidence: 'DERIVED' as const,
  source: 'OVERWOLF_SNAPSHOT' as const,
};

const recipeGraph = createRecipeGraph([]);
const duplicateRuleset: InventoryRuleset = {
  duplicateItemsAllowed: true,
  baseSlotsByType: {
    weapon: 4,
    vitality: 4,
    spirit: 4,
  },
  maxFlexSlots: 4,
};

describe('applyInventoryAction', () => {
  it('rejects duplicate held item instances when the ruleset forbids them', () => {
    const first = applyInventoryAction(
      createEmptyInventoryState(),
      { type: 'BUY', item: { itemId: 1 }, metadata },
      { recipeGraph },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const duplicate = applyInventoryAction(
      first.state,
      { type: 'BUY', item: { itemId: 1 }, metadata },
      { recipeGraph },
    );
    expect(duplicate).toMatchObject({
      ok: false,
      error: { code: 'DUPLICATE_ITEM_NOT_ALLOWED' },
    });
  });

  it('preserves multiple instances of the same item when duplicates are allowed', () => {
    const first = applyInventoryAction(
      createEmptyInventoryState(),
      {
        type: 'BUY',
        item: { itemId: 1, slotType: 'weapon' },
        metadata,
      },
      { recipeGraph, ruleset: duplicateRuleset },
    );
    if (!first.ok) throw new Error(first.error.message);

    const second = applyInventoryAction(
      first.state,
      {
        type: 'BUY',
        item: { itemId: 1, slotType: 'weapon' },
        metadata,
      },
      { recipeGraph, ruleset: duplicateRuleset },
    );
    if (!second.ok) throw new Error(second.error.message);

    expect(getHeldItemCount(second.state, 1)).toBe(2);
    expect(getHeldItemIdsWithMultiplicity(second.state)).toEqual([1, 1]);
    expect(
      getHeldItemInstances(second.state, 1).map((instance) => instance.instanceId),
    ).toHaveLength(2);
    expect(
      new Set(
        getHeldItemInstances(second.state, 1).map(
          (instance) => instance.instanceId,
        ),
      ).size,
    ).toBe(2);
  });

  it('sells exactly one duplicate instance at a time', () => {
    let state = createEmptyInventoryState();
    for (let copy = 0; copy < 2; copy += 1) {
      const bought = applyInventoryAction(
        state,
        { type: 'BUY', item: { itemId: 1 }, metadata },
        { recipeGraph, ruleset: duplicateRuleset },
      );
      if (!bought.ok) throw new Error(bought.error.message);
      state = bought.state;
    }

    const sold = applyInventoryAction(
      state,
      { type: 'SELL', itemId: 1, metadata },
      { recipeGraph, ruleset: duplicateRuleset },
    );
    if (!sold.ok) throw new Error(sold.error.message);

    expect(getHeldItemCount(sold.state, 1)).toBe(1);
    expect(getHeldItemIdsWithMultiplicity(sold.state)).toEqual([1]);
  });

  it('requires and consumes recipe component multiplicity exactly', () => {
    const duplicateRecipeGraph = createRecipeGraph([
      { parentItemId: 2, componentItemIds: [1, 1] },
    ]);
    let oneCopyState = createEmptyInventoryState();
    const first = applyInventoryAction(
      oneCopyState,
      { type: 'BUY', item: { itemId: 1, slotType: 'weapon' }, metadata },
      { recipeGraph: duplicateRecipeGraph, ruleset: duplicateRuleset },
    );
    if (!first.ok) throw new Error(first.error.message);
    oneCopyState = first.state;

    const insufficientUpgrade = applyInventoryAction(
      oneCopyState,
      {
        type: 'UPGRADE',
        item: { itemId: 2, slotType: 'weapon' },
        consumedComponentIds: [1, 1],
        metadata,
      },
      { recipeGraph: duplicateRecipeGraph, ruleset: duplicateRuleset },
    );
    expect(insufficientUpgrade).toMatchObject({
      ok: false,
      error: { code: 'ITEM_NOT_OWNED' },
    });

    const second = applyInventoryAction(
      oneCopyState,
      { type: 'BUY', item: { itemId: 1, slotType: 'weapon' }, metadata },
      { recipeGraph: duplicateRecipeGraph, ruleset: duplicateRuleset },
    );
    if (!second.ok) throw new Error(second.error.message);

    const upgraded = applyInventoryAction(
      second.state,
      {
        type: 'UPGRADE',
        item: { itemId: 2, slotType: 'weapon' },
        consumedComponentIds: [1, 1],
        metadata,
      },
      { recipeGraph: duplicateRecipeGraph, ruleset: duplicateRuleset },
    );
    if (!upgraded.ok) throw new Error(upgraded.error.message);

    expect(getHeldItemIdsWithMultiplicity(upgraded.state)).toEqual([2]);
    expect(getHeldItemCount(upgraded.state, 1)).toBe(0);
    expect(getHeldItemCount(upgraded.state, 2)).toBe(1);
  });

  it('rejects upgrade component subsets that do not equal the recipe multiset', () => {
    const duplicateRecipeGraph = createRecipeGraph([
      { parentItemId: 2, componentItemIds: [1, 1] },
    ]);
    let state = createEmptyInventoryState();
    for (let copy = 0; copy < 2; copy += 1) {
      const bought = applyInventoryAction(
        state,
        { type: 'BUY', item: { itemId: 1 }, metadata },
        { recipeGraph: duplicateRecipeGraph, ruleset: duplicateRuleset },
      );
      if (!bought.ok) throw new Error(bought.error.message);
      state = bought.state;
    }

    expect(
      applyInventoryAction(
        state,
        {
          type: 'UPGRADE',
          item: { itemId: 2 },
          consumedComponentIds: [1],
          metadata,
        },
        { recipeGraph: duplicateRecipeGraph, ruleset: duplicateRuleset },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_UPGRADE_COMPONENT' },
    });
  });

  it('creates a new lifecycle instance after removal and rebuy', () => {
    const first = applyInventoryAction(
      createEmptyInventoryState(),
      { type: 'BUY', item: { itemId: 1 }, metadata },
      { recipeGraph },
    );
    if (!first.ok) throw new Error(first.error.message);
    const firstInstanceId = first.state.heldByItemId.get(1)?.instanceId;

    const sold = applyInventoryAction(
      first.state,
      { type: 'SELL', itemId: 1, metadata },
      { recipeGraph },
    );
    if (!sold.ok) throw new Error(sold.error.message);
    const rebought = applyInventoryAction(
      sold.state,
      { type: 'REBUY', item: { itemId: 1 }, metadata },
      { recipeGraph },
    );
    if (!rebought.ok) throw new Error(rebought.error.message);

    expect(rebought.state.heldByItemId.get(1)).toMatchObject({
      lifecycle: 2,
      acquiredBy: 'REBUY',
    });
    expect(rebought.state.heldByItemId.get(1)?.instanceId).not.toBe(
      firstInstanceId,
    );
  });

  it('uses all configured flex slots before rejecting inventory', () => {
    let state = createEmptyInventoryState();
    for (let itemId = 1; itemId <= 8; itemId++) {
      const result = applyInventoryAction(
        state,
        { type: 'BUY', item: { itemId, slotType: 'weapon' }, metadata },
        { recipeGraph, ruleset: DEFAULT_INVENTORY_RULESET },
      );
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
    }

    const overflow = applyInventoryAction(
      state,
      { type: 'BUY', item: { itemId: 9, slotType: 'weapon' }, metadata },
      { recipeGraph, ruleset: DEFAULT_INVENTORY_RULESET },
    );
    expect(overflow).toMatchObject({
      ok: false,
      error: { code: 'SLOT_LIMIT_EXCEEDED' },
    });
  });
});
