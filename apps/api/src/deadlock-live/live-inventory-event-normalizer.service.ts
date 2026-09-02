import { Injectable } from '@nestjs/common';
import {
  OverwolfLiveBatchDto,
  OverwolfLiveEventDto,
} from '@deadlock-live-probe/shared';

interface LiveItemMetadata {
  name: string;
  className: string;
}

@Injectable()
export class LiveInventoryEventNormalizerService {
  private readonly metadataByItemId = new Map<number, LiveItemMetadata>();
  private readonly steamIdByClientAndRosterSlot = new Map<string, Map<string, string>>();
  private readonly matchIdByClientId = new Map<string, string>();

  normalizeBatch(batch: OverwolfLiveBatchDto): OverwolfLiveBatchDto {
    this.resetRosterSlotsWhenMatchChanges(batch);
    this.captureRosterSlots(batch.clientId, batch.events);

    return {
      ...batch,
      events: batch.events.map((event) => this.normalizeEvent(batch.clientId, event)),
    };
  }

  private captureRosterSlots(
    clientId: string,
    events: readonly OverwolfLiveEventDto[],
  ): void {
    const rosterSlots = this.getRosterSlots(clientId);
    for (const event of events) {
      if (!event.key?.startsWith('roster_') || !isRecord(event.payload)) {
        continue;
      }
      const steamId = readSteamId(event.payload.steam_id ?? event.payload.steamId);
      if (steamId) {
        rosterSlots.set(event.key, steamId);
      }
    }
  }

  private normalizeEvent(
    clientId: string,
    event: OverwolfLiveEventDto,
  ): OverwolfLiveEventDto {
    if (
      !event.key?.startsWith('items') ||
      !isRecord(event.payload) ||
      !Array.isArray(event.payload.items)
    ) {
      return event;
    }

    const rosterSlot = event.key.startsWith('items_')
      ? `roster_${event.key.slice('items_'.length)}`
      : undefined;
    const steamId = readSteamId(event.payload.steam_id ?? event.payload.steamId)
      ?? (rosterSlot ? this.getRosterSlots(clientId).get(rosterSlot) : undefined);
    const items = event.payload.items
      .map((item) => this.normalizeItem(item))
      .filter((item): item is Record<string, unknown> => item !== undefined);

    return {
      ...event,
      payload: {
        ...event.payload,
        ...(steamId ? { steam_id: steamId } : {}),
        items,
      },
    };
  }

  private resetRosterSlotsWhenMatchChanges(batch: OverwolfLiveBatchDto): void {
    const matchId = extractMatchId(batch.events);
    if (!matchId) {
      return;
    }

    const previousMatchId = this.matchIdByClientId.get(batch.clientId);
    if (previousMatchId && previousMatchId !== matchId) {
      this.steamIdByClientAndRosterSlot.delete(batch.clientId);
    }
    this.matchIdByClientId.set(batch.clientId, matchId);
  }

  private getRosterSlots(clientId: string): Map<string, string> {
    const existing = this.steamIdByClientAndRosterSlot.get(clientId);
    if (existing) {
      return existing;
    }

    const created = new Map<string, string>();
    this.steamIdByClientAndRosterSlot.set(clientId, created);
    return created;
  }

  private normalizeItem(value: unknown): Record<string, unknown> | undefined {
    if (!isRecord(value)) {
      return undefined;
    }

    const id = readPositiveInteger(value.id ?? value.item_id ?? value.itemId);
    if (id === undefined) {
      return undefined;
    }

    const cached = this.metadataByItemId.get(id);
    const name = readString(value.name ?? value.item_name ?? value.itemName)
      ?? cached?.name
      ?? `Item ${id}`;
    const className = readString(value.class_name ?? value.className)
      ?? cached?.className
      ?? `item_${id}`;

    this.metadataByItemId.set(id, { name, className });

    return {
      ...value,
      id,
      name,
      class_name: className,
      enhanced: readBoolean(value.enhanced),
    };
  }
}

function extractMatchId(events: readonly OverwolfLiveEventDto[]): string | undefined {
  for (const event of events) {
    const explicitMatchId = readString(event.matchId);
    if (explicitMatchId) {
      return explicitMatchId;
    }
    if (event.key === 'match_id') {
      const payloadMatchId = readStringOrNumber(event.payload);
      if (payloadMatchId) {
        return payloadMatchId;
      }
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readSteamId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return readString(value);
}

function readStringOrNumber(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return readString(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function readBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return value === 'true' || value === '1';
}
