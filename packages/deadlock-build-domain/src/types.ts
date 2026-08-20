export type InventorySlotType = 'weapon' | 'vitality' | 'spirit';

export type InventoryEvidence = 'OBSERVED' | 'DERIVED' | 'INFERRED';

export type InventoryActionSource = 'OVERWOLF_SNAPSHOT' | 'MATCH_METADATA' | 'MANUAL' | 'SYSTEM';

export interface InventoryActionMetadata {
  observedAtMs: number;
  gameTimeSec?: number;
  evidence: InventoryEvidence;
  source: InventoryActionSource;
}

export interface InventoryItem {
  itemId: number;
  name?: string;
  className?: string;
  slotType?: InventorySlotType;
  enhanced?: boolean;
}

export type InventoryAcquisitionType = 'RECONCILE' | 'BUY' | 'REBUY' | 'UPGRADE';

export interface InventoryItemInstance extends InventoryItem {
  instanceId: string;
  lifecycle: number;
  acquiredBy: InventoryAcquisitionType;
  acquiredAtMs: number;
  acquiredAtGameTimeSec?: number;
}

export interface InventoryState {
  initializedFromSnapshot: boolean;
  heldByItemId: ReadonlyMap<number, InventoryItemInstance>;
  heldByInstanceId?: ReadonlyMap<string, InventoryItemInstance>;
  heldInstanceIdsByItemId?: ReadonlyMap<number, readonly string[]>;
  lifecycleCountByItemId: ReadonlyMap<number, number>;
  nextInstanceSequence: number;
}

export interface ReconcileInventoryAction {
  type: 'RECONCILE';
  items: InventoryItem[];
  metadata: InventoryActionMetadata;
}

export interface BuyInventoryAction {
  type: 'BUY';
  item: InventoryItem;
  metadata: InventoryActionMetadata;
}

export interface RebuyInventoryAction {
  type: 'REBUY';
  item: InventoryItem;
  metadata: InventoryActionMetadata;
}

export interface UpgradeInventoryAction {
  type: 'UPGRADE';
  item: InventoryItem;
  consumedComponentIds: number[];
  metadata: InventoryActionMetadata;
}

export interface SellInventoryAction {
  type: 'SELL';
  itemId: number;
  metadata: InventoryActionMetadata;
}

export interface ConsumeInventoryAction {
  type: 'CONSUME';
  itemId: number;
  metadata: InventoryActionMetadata;
}

export interface UseInventoryAction {
  type: 'USE';
  itemId: number;
  metadata: InventoryActionMetadata;
}

export interface HoldInventoryAction {
  type: 'HOLD';
  itemId: number;
  metadata: InventoryActionMetadata;
}

export interface UnknownRemoveInventoryAction {
  type: 'UNKNOWN_REMOVE';
  itemIds: number[];
  metadata: InventoryActionMetadata;
}

export type InventoryAction =
  | ReconcileInventoryAction
  | BuyInventoryAction
  | RebuyInventoryAction
  | UpgradeInventoryAction
  | SellInventoryAction
  | ConsumeInventoryAction
  | UseInventoryAction
  | HoldInventoryAction
  | UnknownRemoveInventoryAction;

export type InventoryValidationCode =
  | 'DUPLICATE_ITEM_NOT_ALLOWED'
  | 'DUPLICATE_SNAPSHOT_ITEM'
  | 'ITEM_NOT_OWNED'
  | 'ITEM_NOT_PREVIOUSLY_OWNED'
  | 'INVALID_UPGRADE_COMPONENT'
  | 'SLOT_LIMIT_EXCEEDED';

export interface InventoryValidationError {
  code: InventoryValidationCode;
  message: string;
  itemIds: number[];
}

export interface InventoryRuleset {
  duplicateItemsAllowed: boolean;
  baseSlotsByType: Readonly<Record<InventorySlotType, number>>;
  maxFlexSlots: number;
}

export interface InventoryReducerSuccess {
  ok: true;
  state: InventoryState;
}

export interface InventoryReducerFailure {
  ok: false;
  state: InventoryState;
  error: InventoryValidationError;
}

export type InventoryReducerResult = InventoryReducerSuccess | InventoryReducerFailure;

export interface RecipeDefinition {
  parentItemId: number;
  componentItemIds: number[];
}

export interface RecipeGraph {
  getComponentIds(parentItemId: number): readonly number[];
  isDirectComponent(parentItemId: number, componentItemId: number): boolean;
}

export type SnapshotRemovalDecision = 'SELL' | 'CONSUME' | 'UNKNOWN_REMOVE';

export interface SnapshotRemovalContext {
  state: InventoryState;
  removedItem: InventoryItemInstance;
  snapshotItems: readonly InventoryItem[];
  metadata: InventoryActionMetadata;
}

export type SnapshotRemovalClassifier = (context: SnapshotRemovalContext) => SnapshotRemovalDecision;

export type SnapshotDiagnosticCode =
  | 'DUPLICATE_SNAPSHOT_ITEM'
  | 'REDUCER_REJECTED_ACTION'
  | 'AMBIGUOUS_UPGRADE_COMPONENT'
  | 'SNAPSHOT_STATE_MISMATCH';

export interface SnapshotDiagnostic {
  code: SnapshotDiagnosticCode;
  message: string;
  itemIds: number[];
}

export interface NormalizeSnapshotInput {
  state: InventoryState;
  snapshotItems: InventoryItem[];
  recipeGraph: RecipeGraph;
  ruleset?: InventoryRuleset;
  observedAtMs: number;
  gameTimeSec?: number;
  classifyRemoval?: SnapshotRemovalClassifier;
}

export interface NormalizeSnapshotResult {
  state: InventoryState;
  actions: InventoryAction[];
  diagnostics: SnapshotDiagnostic[];
}
