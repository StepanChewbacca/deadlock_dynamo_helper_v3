import {
  InventoryAction,
  InventoryAcquisitionType,
  InventoryItem,
  InventoryItemInstance,
  InventoryReducerResult,
  InventoryRuleset,
  InventorySlotType,
  InventoryState,
  InventoryValidationError,
  RecipeGraph,
} from './types';

export const DEFAULT_INVENTORY_RULESET: InventoryRuleset = {
  duplicateItemsAllowed: false,
  baseSlotsByType: {
    weapon: 4,
    vitality: 4,
    spirit: 4,
  },
  maxFlexSlots: 4,
};

export interface InventoryReducerContext {
  recipeGraph: RecipeGraph;
  ruleset?: InventoryRuleset;
}

export function createEmptyInventoryState(): InventoryState {
  return {
    initializedFromSnapshot: false,
    heldByItemId: new Map(),
    heldByInstanceId: new Map(),
    heldInstanceIdsByItemId: new Map(),
    lifecycleCountByItemId: new Map(),
    nextInstanceSequence: 1,
  };
}

export function getHeldItemIds(state: InventoryState): number[] {
  return [...state.heldByItemId.keys()].sort((a, b) => a - b);
}

export function getHeldItemIdsWithMultiplicity(state: InventoryState): number[] {
  return getAllHeldInstances(state)
    .map((instance) => instance.itemId)
    .sort((a, b) => a - b);
}

export function getHeldItemCount(state: InventoryState, itemId: number): number {
  if (state.heldInstanceIdsByItemId) {
    return state.heldInstanceIdsByItemId.get(itemId)?.length ?? 0;
  }
  return state.heldByItemId.has(itemId) ? 1 : 0;
}

export function getHeldItemInstances(
  state: InventoryState,
  itemId: number,
): InventoryItemInstance[] {
  if (state.heldByInstanceId && state.heldInstanceIdsByItemId) {
    return (state.heldInstanceIdsByItemId.get(itemId) ?? [])
      .map((instanceId) => state.heldByInstanceId?.get(instanceId))
      .filter((instance): instance is InventoryItemInstance => instance !== undefined);
  }
  const legacy = state.heldByItemId.get(itemId);
  return legacy ? [legacy] : [];
}

export function cloneInventoryState(state: InventoryState): InventoryState {
  return createStateFromInstances(
    state.initializedFromSnapshot,
    getAllHeldInstances(state).map((instance) => ({ ...instance })),
    new Map(state.lifecycleCountByItemId),
    state.nextInstanceSequence,
  );
}

export function applyInventoryAction(
  state: InventoryState,
  action: InventoryAction,
  context: InventoryReducerContext,
): InventoryReducerResult {
  const ruleset = context.ruleset ?? DEFAULT_INVENTORY_RULESET;

  switch (action.type) {
    case 'RECONCILE':
      return reconcile(
        state,
        action.items,
        action.metadata.observedAtMs,
        action.metadata.gameTimeSec,
        ruleset,
      );
    case 'BUY':
      return acquire(
        state,
        action.item,
        'BUY',
        action.metadata.observedAtMs,
        action.metadata.gameTimeSec,
        ruleset,
      );
    case 'REBUY':
      if ((state.lifecycleCountByItemId.get(action.item.itemId) ?? 0) === 0) {
        return failure(state, {
          code: 'ITEM_NOT_PREVIOUSLY_OWNED',
          message: `Item ${action.item.itemId} cannot be rebought before it has been owned.`,
          itemIds: [action.item.itemId],
        });
      }
      return acquire(
        state,
        action.item,
        'REBUY',
        action.metadata.observedAtMs,
        action.metadata.gameTimeSec,
        ruleset,
      );
    case 'UPGRADE':
      return upgrade(state, action, context.recipeGraph, ruleset);
    case 'SELL':
    case 'CONSUME':
      return removeItems(state, [action.itemId]);
    case 'UNKNOWN_REMOVE':
      return removeItems(state, action.itemIds);
    case 'USE':
    case 'HOLD':
      if (getHeldItemCount(state, action.itemId) === 0) {
        return failure(state, {
          code: 'ITEM_NOT_OWNED',
          message: `Item ${action.itemId} is not currently held.`,
          itemIds: [action.itemId],
        });
      }
      return { ok: true, state };
  }
}

function reconcile(
  state: InventoryState,
  items: readonly InventoryItem[],
  observedAtMs: number,
  gameTimeSec: number | undefined,
  ruleset: InventoryRuleset,
): InventoryReducerResult {
  const duplicateIds = findDuplicateIds(items.map((item) => item.itemId));
  if (!ruleset.duplicateItemsAllowed && duplicateIds.length > 0) {
    return failure(state, {
      code: 'DUPLICATE_ITEM_NOT_ALLOWED',
      message: `Snapshot contains duplicate item ids: ${duplicateIds.join(', ')}.`,
      itemIds: duplicateIds,
    });
  }

  const existingByItemId = new Map<number, InventoryItemInstance[]>();
  for (const instance of getAllHeldInstances(state)) {
    const instances = existingByItemId.get(instance.itemId) ?? [];
    instances.push(instance);
    existingByItemId.set(instance.itemId, instances);
  }

  const nextInstances: InventoryItemInstance[] = [];
  const lifecycleCounts = new Map(state.lifecycleCountByItemId);
  let nextSequence = state.nextInstanceSequence;

  for (const item of items) {
    const existing = existingByItemId.get(item.itemId)?.shift();
    if (existing) {
      nextInstances.push({ ...existing, ...item });
      continue;
    }

    const lifecycle = (lifecycleCounts.get(item.itemId) ?? 0) + 1;
    lifecycleCounts.set(item.itemId, lifecycle);
    nextInstances.push(
      createInstance(
        item,
        'RECONCILE',
        lifecycle,
        nextSequence++,
        observedAtMs,
        gameTimeSec,
      ),
    );
  }

  const nextState = createStateFromInstances(
    true,
    nextInstances,
    lifecycleCounts,
    nextSequence,
  );
  return validateSlots(state, nextState, ruleset);
}

function acquire(
  state: InventoryState,
  item: InventoryItem,
  acquiredBy: InventoryAcquisitionType,
  observedAtMs: number,
  gameTimeSec: number | undefined,
  ruleset: InventoryRuleset,
): InventoryReducerResult {
  if (!ruleset.duplicateItemsAllowed && getHeldItemCount(state, item.itemId) > 0) {
    return failure(state, {
      code: 'DUPLICATE_ITEM_NOT_ALLOWED',
      message: `Item ${item.itemId} is already held.`,
      itemIds: [item.itemId],
    });
  }

  const lifecycleCounts = new Map(state.lifecycleCountByItemId);
  const lifecycle = (lifecycleCounts.get(item.itemId) ?? 0) + 1;
  lifecycleCounts.set(item.itemId, lifecycle);
  const nextInstances = [
    ...getAllHeldInstances(state),
    createInstance(
      item,
      acquiredBy,
      lifecycle,
      state.nextInstanceSequence,
      observedAtMs,
      gameTimeSec,
    ),
  ];

  const nextState = createStateFromInstances(
    state.initializedFromSnapshot,
    nextInstances,
    lifecycleCounts,
    state.nextInstanceSequence + 1,
  );
  return validateSlots(state, nextState, ruleset);
}

function upgrade(
  state: InventoryState,
  action: Extract<InventoryAction, { type: 'UPGRADE' }>,
  recipeGraph: RecipeGraph,
  ruleset: InventoryRuleset,
): InventoryReducerResult {
  if (!ruleset.duplicateItemsAllowed && getHeldItemCount(state, action.item.itemId) > 0) {
    return failure(state, {
      code: 'DUPLICATE_ITEM_NOT_ALLOWED',
      message: `Upgrade target ${action.item.itemId} is already held.`,
      itemIds: [action.item.itemId],
    });
  }

  const expectedComponentIds = [...recipeGraph.getComponentIds(action.item.itemId)].sort(
    (a, b) => a - b,
  );
  const suppliedComponentIds = [...action.consumedComponentIds].sort((a, b) => a - b);
  if (
    expectedComponentIds.length === 0 ||
    !sameItemIdMultiset(expectedComponentIds, suppliedComponentIds)
  ) {
    return failure(state, {
      code: 'INVALID_UPGRADE_COMPONENT',
      message: `Upgrade ${action.item.itemId} must consume exactly recipe components [${expectedComponentIds.join(', ')}].`,
      itemIds: [...new Set([action.item.itemId, ...suppliedComponentIds, ...expectedComponentIds])].sort(
        (a, b) => a - b,
      ),
    });
  }

  const requiredCounts = countItemIds(suppliedComponentIds);
  const missing: number[] = [];
  for (const [componentId, requiredCount] of requiredCounts) {
    if (getHeldItemCount(state, componentId) < requiredCount) {
      missing.push(componentId);
    }
  }
  if (missing.length > 0) {
    return failure(state, {
      code: 'ITEM_NOT_OWNED',
      message: `Upgrade components are not held with required multiplicity: ${missing.join(', ')}.`,
      itemIds: missing.sort((a, b) => a - b),
    });
  }

  const nextInstances = [...getAllHeldInstances(state)];
  for (const componentId of suppliedComponentIds) {
    removeOneInstance(nextInstances, componentId);
  }

  const lifecycleCounts = new Map(state.lifecycleCountByItemId);
  const lifecycle = (lifecycleCounts.get(action.item.itemId) ?? 0) + 1;
  lifecycleCounts.set(action.item.itemId, lifecycle);
  nextInstances.push(
    createInstance(
      action.item,
      'UPGRADE',
      lifecycle,
      state.nextInstanceSequence,
      action.metadata.observedAtMs,
      action.metadata.gameTimeSec,
    ),
  );

  const nextState = createStateFromInstances(
    state.initializedFromSnapshot,
    nextInstances,
    lifecycleCounts,
    state.nextInstanceSequence + 1,
  );
  return validateSlots(state, nextState, ruleset);
}

function removeItems(
  state: InventoryState,
  itemIds: readonly number[],
): InventoryReducerResult {
  const requiredCounts = countItemIds(itemIds);
  const missing: number[] = [];
  for (const [itemId, requiredCount] of requiredCounts) {
    if (getHeldItemCount(state, itemId) < requiredCount) {
      missing.push(itemId);
    }
  }
  if (missing.length > 0) {
    return failure(state, {
      code: 'ITEM_NOT_OWNED',
      message: `Items are not currently held with required multiplicity: ${missing.join(', ')}.`,
      itemIds: missing.sort((a, b) => a - b),
    });
  }

  const nextInstances = [...getAllHeldInstances(state)];
  for (const itemId of itemIds) {
    removeOneInstance(nextInstances, itemId);
  }
  return {
    ok: true,
    state: createStateFromInstances(
      state.initializedFromSnapshot,
      nextInstances,
      new Map(state.lifecycleCountByItemId),
      state.nextInstanceSequence,
    ),
  };
}

function validateSlots(
  previousState: InventoryState,
  nextState: InventoryState,
  ruleset: InventoryRuleset,
): InventoryReducerResult {
  const counts: Record<InventorySlotType, number> = {
    weapon: 0,
    vitality: 0,
    spirit: 0,
  };
  for (const item of getAllHeldInstances(nextState)) {
    if (item.slotType) counts[item.slotType] += 1;
  }

  const flexUsed = (Object.keys(counts) as InventorySlotType[]).reduce(
    (total, slotType) =>
      total + Math.max(0, counts[slotType] - ruleset.baseSlotsByType[slotType]),
    0,
  );
  if (flexUsed > ruleset.maxFlexSlots) {
    return failure(previousState, {
      code: 'SLOT_LIMIT_EXCEEDED',
      message: `Inventory requires ${flexUsed} flex slots but only ${ruleset.maxFlexSlots} are available.`,
      itemIds: getHeldItemIdsWithMultiplicity(nextState),
    });
  }

  return { ok: true, state: nextState };
}

function createInstance(
  item: InventoryItem,
  acquiredBy: InventoryAcquisitionType,
  lifecycle: number,
  sequence: number,
  observedAtMs: number,
  gameTimeSec: number | undefined,
): InventoryItemInstance {
  return {
    ...item,
    instanceId: `${item.itemId}:${lifecycle}:${sequence}`,
    lifecycle,
    acquiredBy,
    acquiredAtMs: observedAtMs,
    acquiredAtGameTimeSec: gameTimeSec,
  };
}

function createStateFromInstances(
  initializedFromSnapshot: boolean,
  instances: readonly InventoryItemInstance[],
  lifecycleCountByItemId: ReadonlyMap<number, number>,
  nextInstanceSequence: number,
): InventoryState {
  const heldByInstanceId = new Map<string, InventoryItemInstance>();
  const heldByItemId = new Map<number, InventoryItemInstance>();
  const heldInstanceIdsByItemId = new Map<number, string[]>();

  for (const instance of instances) {
    heldByInstanceId.set(instance.instanceId, instance);
    if (!heldByItemId.has(instance.itemId)) {
      heldByItemId.set(instance.itemId, instance);
    }
    const instanceIds = heldInstanceIdsByItemId.get(instance.itemId) ?? [];
    instanceIds.push(instance.instanceId);
    heldInstanceIdsByItemId.set(instance.itemId, instanceIds);
  }

  return {
    initializedFromSnapshot,
    heldByItemId,
    heldByInstanceId,
    heldInstanceIdsByItemId,
    lifecycleCountByItemId: new Map(lifecycleCountByItemId),
    nextInstanceSequence,
  };
}

function getAllHeldInstances(state: InventoryState): InventoryItemInstance[] {
  if (state.heldByInstanceId) {
    return [...state.heldByInstanceId.values()];
  }
  return [...state.heldByItemId.values()];
}

function removeOneInstance(
  instances: InventoryItemInstance[],
  itemId: number,
): void {
  const index = instances.findIndex((instance) => instance.itemId === itemId);
  if (index >= 0) {
    instances.splice(index, 1);
  }
}

function countItemIds(itemIds: readonly number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const itemId of itemIds) {
    counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }
  return counts;
}

function sameItemIdMultiset(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((itemId, index) => itemId === right[index])
  );
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

function failure(
  state: InventoryState,
  error: InventoryValidationError,
): InventoryReducerResult {
  return { ok: false, state, error };
}
