import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const RECOMMENDATION_OBSERVABILITY_V7_TELEMETRY_SCHEMA_VERSION = 1;
export const RECOMMENDATION_OBSERVABILITY_V7_TELEMETRY_VERSION =
  'RECOMMENDATION_OBSERVABILITY_V7_TELEMETRY_1' as const;

const DEFAULT_OUTPUT_DIRECTORY =
  '/app/apps/api/storage/recommendation-observability-v7';
const EVENT_LOG_FILE = 'events.ndjson';

export type RecommendationObservabilityV7Source =
  | 'LIVE_CLIENT_DIRECT'
  | 'OVERWOLF_GAME_EVENT'
  | 'SERVER_STATE_DIRECT';

export type RecommendationObservabilityV7ShopType =
  | 'BASE'
  | 'SECRET'
  | 'ANY'
  | 'UNKNOWN';

export interface RecommendationObservabilityV7InventorySlot {
  slotOrder: number;
  itemId: number;
  slotType?: string;
}

export interface RecommendationObservabilityV7SnapshotInput {
  matchId: string;
  steamId: string;
  heroId: number;
  gameTimeS: number;
  source: RecommendationObservabilityV7Source;
  sourceEventId?: string;
  sourceOccurredAt?: string;
  spendableSouls?: number;
  shopAvailable?: boolean;
  shopType?: RecommendationObservabilityV7ShopType;
  alive?: boolean;
  occupiedSlots?: RecommendationObservabilityV7InventorySlot[];
  flexSlotsUnlocked?: number;
  lastPurchaseGameTimeS?: number;
  lastInventoryMutationGameTimeS?: number;
  rulesetId?: string;
  itemAvailabilityVersion?: string;
  position?: {
    x: number;
    y: number;
    z: number;
  };
}

export interface RecommendationObservabilityV7SnapshotEvent
  extends RecommendationObservabilityV7SnapshotInput {
  schemaVersion: typeof RECOMMENDATION_OBSERVABILITY_V7_TELEMETRY_SCHEMA_VERSION;
  telemetryVersion: typeof RECOMMENDATION_OBSERVABILITY_V7_TELEMETRY_VERSION;
  eventType: 'PREDECISION_OBSERVABILITY';
  eventId: string;
  receivedAt: string;
}

export interface RecommendationObservabilityV7TelemetryStatus {
  schemaVersion: number;
  telemetryVersion: typeof RECOMMENDATION_OBSERVABILITY_V7_TELEMETRY_VERSION;
  outputDirectory: string;
  eventLogPath: string;
  acceptedEventCount: number;
  writeErrorCount: number;
  lastAcceptedAt?: string;
  lastWriteError?: string;
}

@Injectable()
export class RecommendationObservabilityV7TelemetryStore {
  private readonly outputDirectory =
    process.env.DEADLOCK_RECOMMENDATION_OBSERVABILITY_V7_DIR?.trim() ||
    DEFAULT_OUTPUT_DIRECTORY;
  private readonly eventLogPath = join(this.outputDirectory, EVENT_LOG_FILE);
  private writeQueue: Promise<void> = Promise.resolve();
  private acceptedEventCount = 0;
  private writeErrorCount = 0;
  private lastAcceptedAt?: string;
  private lastWriteError?: string;
  private initialized = false;

  record(
    input: RecommendationObservabilityV7SnapshotInput,
  ): RecommendationObservabilityV7SnapshotEvent {
    validateSnapshot(input);
    const event: RecommendationObservabilityV7SnapshotEvent = {
      schemaVersion: RECOMMENDATION_OBSERVABILITY_V7_TELEMETRY_SCHEMA_VERSION,
      telemetryVersion: RECOMMENDATION_OBSERVABILITY_V7_TELEMETRY_VERSION,
      eventType: 'PREDECISION_OBSERVABILITY',
      eventId: randomUUID(),
      receivedAt: new Date().toISOString(),
      ...cloneSnapshot(input),
    };
    this.acceptedEventCount += 1;
    this.lastAcceptedAt = event.receivedAt;
    this.writeQueue = this.writeQueue
      .then(async () => {
        await this.ensureInitialized();
        await appendFile(this.eventLogPath, `${JSON.stringify(event)}\n`, 'utf8');
      })
      .catch((error: unknown) => {
        this.writeErrorCount += 1;
        this.lastWriteError = getErrorMessage(error);
      });
    return event;
  }

  getStatus(): RecommendationObservabilityV7TelemetryStatus {
    return {
      schemaVersion: RECOMMENDATION_OBSERVABILITY_V7_TELEMETRY_SCHEMA_VERSION,
      telemetryVersion: RECOMMENDATION_OBSERVABILITY_V7_TELEMETRY_VERSION,
      outputDirectory: this.outputDirectory,
      eventLogPath: this.eventLogPath,
      acceptedEventCount: this.acceptedEventCount,
      writeErrorCount: this.writeErrorCount,
      lastAcceptedAt: this.lastAcceptedAt,
      lastWriteError: this.lastWriteError,
    };
  }

  async waitForIdle(): Promise<void> {
    await this.writeQueue;
    if (this.lastWriteError) {
      throw new Error(`V7 observability telemetry write failed: ${this.lastWriteError}`);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.outputDirectory, { recursive: true });
    await appendFile(this.eventLogPath, '', 'utf8');
    this.acceptedEventCount = Math.max(
      this.acceptedEventCount,
      await countPersistedEvents(this.eventLogPath),
    );
    this.initialized = true;
  }
}

export function validateRecommendationObservabilityV7Snapshot(
  input: RecommendationObservabilityV7SnapshotInput,
): void {
  validateSnapshot(input);
}

function validateSnapshot(input: RecommendationObservabilityV7SnapshotInput): void {
  if (!input.matchId?.trim() || !input.steamId?.trim()) {
    throw new Error('matchId and steamId are required.');
  }
  if (!Number.isSafeInteger(input.heroId) || input.heroId <= 0) {
    throw new Error('heroId must be a positive safe integer.');
  }
  if (!Number.isFinite(input.gameTimeS) || input.gameTimeS < 0) {
    throw new Error('gameTimeS must be a non-negative finite number.');
  }
  if (!['LIVE_CLIENT_DIRECT', 'OVERWOLF_GAME_EVENT', 'SERVER_STATE_DIRECT'].includes(input.source)) {
    throw new Error('Unsupported V7 observability source.');
  }
  if (input.sourceEventId !== undefined && !input.sourceEventId.trim()) {
    throw new Error('sourceEventId must be non-empty when provided.');
  }
  if (
    input.spendableSouls !== undefined &&
    (!Number.isSafeInteger(input.spendableSouls) || input.spendableSouls < 0)
  ) {
    throw new Error('spendableSouls must be a non-negative safe integer.');
  }
  if (
    input.flexSlotsUnlocked !== undefined &&
    (!Number.isSafeInteger(input.flexSlotsUnlocked) ||
      input.flexSlotsUnlocked < 0 ||
      input.flexSlotsUnlocked > 4)
  ) {
    throw new Error('flexSlotsUnlocked must be an integer from 0 to 4.');
  }
  for (const field of ['lastPurchaseGameTimeS', 'lastInventoryMutationGameTimeS'] as const) {
    const value = input[field];
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > input.gameTimeS)) {
      throw new Error(`${field} must be between 0 and gameTimeS.`);
    }
  }
  if (input.sourceOccurredAt !== undefined && !Number.isFinite(Date.parse(input.sourceOccurredAt))) {
    throw new Error('sourceOccurredAt must be a valid timestamp.');
  }
  const slots = input.occupiedSlots ?? [];
  const slotOrders = new Set<number>();
  for (const slot of slots) {
    if (!Number.isSafeInteger(slot.slotOrder) || slot.slotOrder < 0) {
      throw new Error('slotOrder must be a non-negative safe integer.');
    }
    if (!Number.isSafeInteger(slot.itemId) || slot.itemId <= 0) {
      throw new Error('occupied slot itemId must be a positive safe integer.');
    }
    if (slotOrders.has(slot.slotOrder)) {
      throw new Error('occupiedSlots contains duplicate slotOrder values.');
    }
    slotOrders.add(slot.slotOrder);
  }
  if (input.position) {
    for (const value of [input.position.x, input.position.y, input.position.z]) {
      if (!Number.isFinite(value)) throw new Error('position coordinates must be finite.');
    }
  }
  const usefulFieldCount = [
    input.spendableSouls,
    input.shopAvailable,
    input.shopType,
    input.alive,
    input.occupiedSlots,
    input.flexSlotsUnlocked,
    input.lastPurchaseGameTimeS,
    input.lastInventoryMutationGameTimeS,
    input.rulesetId,
    input.itemAvailabilityVersion,
    input.position,
  ].filter((value) => value !== undefined).length;
  if (usefulFieldCount === 0) {
    throw new Error('V7 observability snapshot must contain at least one observability field.');
  }
}

function cloneSnapshot(
  input: RecommendationObservabilityV7SnapshotInput,
): RecommendationObservabilityV7SnapshotInput {
  return {
    ...input,
    matchId: input.matchId.trim(),
    steamId: input.steamId.trim(),
    sourceEventId: input.sourceEventId?.trim(),
    sourceOccurredAt: input.sourceOccurredAt?.trim(),
    rulesetId: input.rulesetId?.trim(),
    itemAvailabilityVersion: input.itemAvailabilityVersion?.trim(),
    occupiedSlots: input.occupiedSlots?.map((slot) => ({ ...slot })),
    position: input.position ? { ...input.position } : undefined,
  };
}

async function countPersistedEvents(path: string): Promise<number> {
  try {
    const content = await readFile(path, 'utf8');
    return content.split('\n').filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
