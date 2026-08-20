import {
  createEmptyInventoryState,
  createRecipeGraph,
  getHeldItemIds,
  getHeldItemIdsWithMultiplicity,
  InventoryRuleset,
  normalizeInventorySnapshot,
} from '../src';
import {
  MATCH_93314383_ITEMS,
  MATCH_93314383_RECIPES,
  MATCH_93314383_SNAPSHOTS,
} from './fixtures/match-93314383.fixture';

describe('normalizeInventorySnapshot', () => {
  it('replays the sanitized match 93314383 inventory timeline', () => {
    const recipeGraph = createRecipeGraph(MATCH_93314383_RECIPES);
    let state = createEmptyInventoryState();
    const actionTypes: string[] = [];
    let firstKineticInstanceId = '';

    for (const snapshot of MATCH_93314383_SNAPSHOTS) {
      const result = normalizeInventorySnapshot({
        state,
        snapshotItems: snapshot.items,
        recipeGraph,
        observedAtMs: snapshot.gameTimeSec * 1000,
        gameTimeSec: snapshot.gameTimeSec,
      });
      expect(result.diagnostics).toEqual([]);
      actionTypes.push(...result.actions.map((action) => action.type));
      state = result.state;

      if (snapshot.gameTimeSec === 350) {
        firstKineticInstanceId = state.heldByItemId.get(MATCH_93314383_ITEMS.kineticDash.itemId)?.instanceId || '';
      }
    }

    expect(actionTypes).toEqual([
      'RECONCILE',
      'BUY',
      'BUY',
      'UPGRADE',
      'BUY',
      'UNKNOWN_REMOVE',
      'REBUY',
    ]);
    expect(state.heldByItemId.has(MATCH_93314383_ITEMS.highVelocityRounds.itemId)).toBe(false);
    expect(state.heldByItemId.has(MATCH_93314383_ITEMS.openingRounds.itemId)).toBe(true);
    expect(state.heldByItemId.get(MATCH_93314383_ITEMS.kineticDash.itemId)).toMatchObject({
      lifecycle: 2,
      acquiredBy: 'REBUY',
    });
    expect(state.heldByItemId.get(MATCH_93314383_ITEMS.kineticDash.itemId)?.instanceId).not.toBe(
      firstKineticInstanceId,
    );
    expect(getHeldItemIds(state)).toEqual(
      [
        MATCH_93314383_ITEMS.openingRounds.itemId,
        MATCH_93314383_ITEMS.extraRegen.itemId,
        MATCH_93314383_ITEMS.kineticDash.itemId,
      ].sort((a, b) => a - b),
    );
  });

  it('allows a trusted classifier to identify a real sale', () => {
    const recipeGraph = createRecipeGraph([]);
    let state = createEmptyInventoryState();
    state = normalizeInventorySnapshot({
      state,
      snapshotItems: [{ itemId: 1 }],
      recipeGraph,
      observedAtMs: 1,
    }).state;

    const result = normalizeInventorySnapshot({
      state,
      snapshotItems: [],
      recipeGraph,
      observedAtMs: 2,
      classifyRemoval: () => 'SELL',
    });
    expect(result.actions.map((action) => action.type)).toEqual(['SELL']);
  });

  it('reconciles duplicate snapshots as exact multisets when duplicates are allowed', () => {
    const ruleset: InventoryRuleset = {
      duplicateItemsAllowed: true,
      baseSlotsByType: {
        weapon: 4,
        vitality: 4,
        spirit: 4,
      },
      maxFlexSlots: 4,
    };
    const recipeGraph = createRecipeGraph([]);
    let state = createEmptyInventoryState();

    const twoCopies = normalizeInventorySnapshot({
      state,
      snapshotItems: [
        { itemId: 1, slotType: 'weapon' },
        { itemId: 1, slotType: 'weapon' },
      ],
      recipeGraph,
      ruleset,
      observedAtMs: 1,
    });
    expect(twoCopies.diagnostics).toEqual([]);
    expect(twoCopies.actions.map((action) => action.type)).toEqual(['RECONCILE']);
    expect(getHeldItemIdsWithMultiplicity(twoCopies.state)).toEqual([1, 1]);
    state = twoCopies.state;

    const oneCopy = normalizeInventorySnapshot({
      state,
      snapshotItems: [{ itemId: 1, slotType: 'weapon' }],
      recipeGraph,
      ruleset,
      observedAtMs: 2,
    });
    expect(oneCopy.diagnostics).toEqual([]);
    expect(oneCopy.actions.map((action) => action.type)).toEqual(['RECONCILE']);
    expect(getHeldItemIdsWithMultiplicity(oneCopy.state)).toEqual([1]);
    state = oneCopy.state;

    const twoCopiesAgain = normalizeInventorySnapshot({
      state,
      snapshotItems: [
        { itemId: 1, slotType: 'weapon' },
        { itemId: 1, slotType: 'weapon' },
      ],
      recipeGraph,
      ruleset,
      observedAtMs: 3,
    });
    expect(twoCopiesAgain.diagnostics).toEqual([]);
    expect(twoCopiesAgain.actions.map((action) => action.type)).toEqual(['RECONCILE']);
    expect(getHeldItemIdsWithMultiplicity(twoCopiesAgain.state)).toEqual([1, 1]);
  });
});
