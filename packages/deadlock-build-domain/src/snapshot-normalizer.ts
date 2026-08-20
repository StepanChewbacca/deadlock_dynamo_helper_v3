import {
  applyInventoryAction,
  DEFAULT_INVENTORY_RULESET,
  getHeldItemIds,
  getHeldItemIdsWithMultiplicity,
} from './inventory-reducer';
import {
  InventoryAction,
  InventoryActionMetadata,
  NormalizeSnapshotInput,
  NormalizeSnapshotResult,
  SnapshotDiagnostic,
} from './types';

export function normalizeInventorySnapshot(
  input: NormalizeSnapshotInput,
): NormalizeSnapshotResult {
  const ruleset = input.ruleset ?? DEFAULT_INVENTORY_RULESET;
  const metadata: InventoryActionMetadata = {
    observedAtMs: input.observedAtMs,
    gameTimeSec: input.gameTimeSec,
    evidence: 'DERIVED',
    source: 'OVERWOLF_SNAPSHOT',
  };
  const diagnostics: SnapshotDiagnostic[] = [];
  const duplicateIds = findDuplicateIds(
    input.snapshotItems.map((item) => item.itemId),
  );

  if (duplicateIds.length > 0 && !ruleset.duplicateItemsAllowed) {
    return {
      state: input.state,
      actions: [],
      diagnostics: [
        {
          code: 'DUPLICATE_SNAPSHOT_ITEM',
          message: `Snapshot contains duplicate item ids: ${duplicateIds.join(', ')}.`,
          itemIds: duplicateIds,
        },
      ],
    };
  }

  if (!input.state.initializedFromSnapshot) {
    const action: InventoryAction = {
      type: 'RECONCILE',
      items: input.snapshotItems,
      metadata: { ...metadata, evidence: 'OBSERVED' },
    };
    return applyActions(input, [action], diagnostics);
  }

  const currentDuplicateIds = findDuplicateIds(
    getHeldItemIdsWithMultiplicity(input.state),
  );
  if (
    ruleset.duplicateItemsAllowed &&
    (duplicateIds.length > 0 || currentDuplicateIds.length > 0)
  ) {
    const action: InventoryAction = {
      type: 'RECONCILE',
      items: input.snapshotItems,
      metadata: { ...metadata, evidence: 'OBSERVED' },
    };
    return applyActions(input, [action], diagnostics);
  }

  const snapshotById = new Map(
    input.snapshotItems.map((item) => [item.itemId, item]),
  );
  const addedIds = new Set(
    input.snapshotItems
      .filter((item) => !input.state.heldByItemId.has(item.itemId))
      .map((item) => item.itemId),
  );
  const removedIds = new Set(
    [...input.state.heldByItemId.keys()].filter(
      (itemId) => !snapshotById.has(itemId),
    ),
  );

  const actions: InventoryAction[] = [];
  const candidateParentsByComponent = new Map<number, number[]>();
  for (const parentId of [...addedIds].sort((a, b) => a - b)) {
    for (const componentId of input.recipeGraph.getComponentIds(parentId)) {
      if (!removedIds.has(componentId)) continue;
      const parents = candidateParentsByComponent.get(componentId) ?? [];
      parents.push(parentId);
      candidateParentsByComponent.set(componentId, parents);
    }
  }

  const consumedByParent = new Map<number, number[]>();
  for (const [componentId, parentIds] of candidateParentsByComponent) {
    const uniqueParentIds = [...new Set(parentIds)].sort((a, b) => a - b);
    if (uniqueParentIds.length !== 1) {
      diagnostics.push({
        code: 'AMBIGUOUS_UPGRADE_COMPONENT',
        message: `Component ${componentId} could belong to multiple added parent items.`,
        itemIds: [componentId, ...uniqueParentIds],
      });
      continue;
    }
    const parentId = uniqueParentIds[0];
    const consumed = consumedByParent.get(parentId) ?? [];
    consumed.push(componentId);
    consumedByParent.set(parentId, consumed);
  }

  for (const [parentId, componentIds] of [
    ...consumedByParent.entries(),
  ].sort(([a], [b]) => a - b)) {
    const item = snapshotById.get(parentId);
    if (!item) continue;
    const uniqueComponentIds = [...new Set(componentIds)].sort((a, b) => a - b);
    actions.push({
      type: 'UPGRADE',
      item,
      consumedComponentIds: uniqueComponentIds,
      metadata,
    });
    addedIds.delete(parentId);
    for (const componentId of uniqueComponentIds) removedIds.delete(componentId);
  }

  for (const itemId of [...removedIds].sort((a, b) => a - b)) {
    const removedItem = input.state.heldByItemId.get(itemId);
    if (!removedItem) continue;
    const decision =
      input.classifyRemoval?.({
        state: input.state,
        removedItem,
        snapshotItems: input.snapshotItems,
        metadata,
      }) ?? 'UNKNOWN_REMOVE';

    if (decision === 'SELL')
      actions.push({ type: 'SELL', itemId, metadata });
    else if (decision === 'CONSUME')
      actions.push({ type: 'CONSUME', itemId, metadata });
    else actions.push({ type: 'UNKNOWN_REMOVE', itemIds: [itemId], metadata });
  }

  for (const itemId of [...addedIds].sort((a, b) => a - b)) {
    const item = snapshotById.get(itemId);
    if (!item) continue;
    const previouslyOwned =
      (input.state.lifecycleCountByItemId.get(itemId) ?? 0) > 0;
    actions.push({
      type: previouslyOwned ? 'REBUY' : 'BUY',
      item,
      metadata,
    });
  }

  return applyActions(input, actions, diagnostics);
}

function applyActions(
  input: NormalizeSnapshotInput,
  actions: InventoryAction[],
  diagnostics: SnapshotDiagnostic[],
): NormalizeSnapshotResult {
  let state = input.state;
  const appliedActions: InventoryAction[] = [];

  for (const action of actions) {
    const result = applyInventoryAction(state, action, {
      recipeGraph: input.recipeGraph,
      ruleset: input.ruleset,
    });
    if (!result.ok) {
      diagnostics.push({
        code: 'REDUCER_REJECTED_ACTION',
        message: `${result.error.code}: ${result.error.message}`,
        itemIds: result.error.itemIds,
      });
      continue;
    }
    state = result.state;
    appliedActions.push(action);
  }

  const expectedIds = input.snapshotItems
    .map((item) => item.itemId)
    .sort((a, b) => a - b);
  const actualIds = getHeldItemIdsWithMultiplicity(state);
  if (!sameIds(expectedIds, actualIds)) {
    diagnostics.push({
      code: 'SNAPSHOT_STATE_MISMATCH',
      message: `Replayed inventory [${actualIds.join(', ')}] does not match snapshot [${expectedIds.join(', ')}].`,
      itemIds: [...new Set([...expectedIds, ...actualIds])].sort(
        (a, b) => a - b,
      ),
    });
  }

  return { state, actions: appliedActions, diagnostics };
}

function findDuplicateIds(itemIds: readonly number[]): number[] {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const itemId of itemIds) {
    if (seen.has(itemId)) duplicates.add(itemId);
    seen.add(itemId);
  }
  return [...duplicates].sort((a, b) => a - b);
}

function sameIds(left: readonly number[], right: readonly number[]): boolean {
  return (
    left.length === right.length &&
    left.every((itemId, index) => itemId === right[index])
  );
}
