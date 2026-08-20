import { Injectable } from '@nestjs/common';
import {
  canonicalizeGepRosterPayloadV2,
  MinimalItemState,
  MinimalMatchState,
  MinimalMatchSnapshot,
  MinimalPlayerState,
  OverwolfLiveBatchDto,
  OverwolfLiveEventDto,
} from '@deadlock-live-probe/shared';

@Injectable()
export class LiveMatchStateService {
  private readonly snapshotIntervalSec = 30;
  private readonly maxSnapshotsPerMatch = 120;
  private readonly states = new Map<string, MinimalMatchState>();
  private readonly clientMatchIds = new Map<string, string>();
  private readonly snapshots = new Map<string, MinimalMatchSnapshot[]>();

  applyBatch(batch: OverwolfLiveBatchDto): MinimalMatchState | undefined {
    const extractedMatchId = this.extractMatchId(batch.events);
    const previousMatchId = this.clientMatchIds.get(batch.clientId);
    const currentMatchId = extractedMatchId ?? previousMatchId ?? 'unknown';
    const state = this.getOrCreateState(currentMatchId, previousMatchId, extractedMatchId);

    this.clientMatchIds.set(batch.clientId, currentMatchId);

    let shouldSnapshot = false;
    for (const event of batch.events) {
      shouldSnapshot = this.applyEvent(state, event) || shouldSnapshot;
    }

    state.lastUpdatedAt = new Date().toISOString();
    this.states.set(currentMatchId, state);
    this.captureSnapshotIfNeeded(state, shouldSnapshot);

    return state;
  }

  getState(matchId: string): MinimalMatchState | undefined {
    return this.states.get(matchId);
  }

  getAllStates(): MinimalMatchState[] {
    return [...this.states.values()];
  }

  getSnapshots(matchId: string): MinimalMatchSnapshot[] {
    return [...(this.snapshots.get(matchId) ?? [])];
  }

  private getOrCreateState(
    currentMatchId: string,
    previousMatchId: string | undefined,
    extractedMatchId: string | undefined,
  ): MinimalMatchState {
    if (previousMatchId === 'unknown' && extractedMatchId && extractedMatchId !== 'unknown') {
      return this.migrateUnknownState(extractedMatchId);
    }

    return (
      this.states.get(currentMatchId) ?? {
        matchId: currentMatchId,
        playersBySteamId: {},
        lastUpdatedAt: new Date().toISOString(),
      }
    );
  }

  private migrateUnknownState(matchId: string): MinimalMatchState {
    const unknownState = this.states.get('unknown');
    const existingState = this.states.get(matchId);

    if (!unknownState) {
      return (
        existingState ?? {
          matchId,
          playersBySteamId: {},
          lastUpdatedAt: new Date().toISOString(),
        }
      );
    }

    if (!existingState) {
      this.states.delete('unknown');
      return {
        ...unknownState,
        matchId,
      };
    }

    this.states.delete('unknown');

    return {
      ...unknownState,
      ...existingState,
      matchId,
      playersBySteamId: this.mergePlayersBySteamId(
        unknownState.playersBySteamId,
        existingState.playersBySteamId,
      ),
    };
  }

  private mergePlayersBySteamId(
    basePlayers: Record<string, MinimalPlayerState>,
    nextPlayers: Record<string, MinimalPlayerState>,
  ): Record<string, MinimalPlayerState> {
    const mergedPlayers: Record<string, MinimalPlayerState> = { ...basePlayers };

    for (const [steamId, nextPlayer] of Object.entries(nextPlayers)) {
      mergedPlayers[steamId] = {
        ...(mergedPlayers[steamId] ?? {}),
        ...nextPlayer,
      };
    }

    return mergedPlayers;
  }

  private applyEvent(state: MinimalMatchState, event: OverwolfLiveEventDto): boolean {
    if (event.key === 'match_clock') {
      const seconds = this.parseClockSeconds(event.payload);
      if (seconds !== undefined) {
        state.gameTimeSec = seconds;
      }
      return false;
    }

    if (event.key?.startsWith('roster')) {
      this.applyRosterPayload(state, event.payload, event.key);
      return false;
    }

    if (event.key?.startsWith('items')) {
      return this.applyItemsPayload(state, event.payload, event.key);
    }

    return false;
  }

  private extractMatchId(events: OverwolfLiveEventDto[]): string | undefined {
    for (const event of events) {
      if (typeof event.matchId === 'string' && event.matchId.length > 0) {
        return event.matchId;
      }

      if (event.key === 'match_id' && typeof event.payload === 'string' && event.payload.length > 0) {
        return event.payload;
      }

      if (this.isRecord(event.payload)) {
        const payloadMatchId = this.getStringValue(event.payload, 'match_id');
        if (payloadMatchId) {
          return payloadMatchId;
        }
      }
    }

    return undefined;
  }

  private parseClockSeconds(payload: unknown): number | undefined {
    if (typeof payload !== 'string') {
      return undefined;
    }

    const parts = payload.split(':').map((part) => Number.parseInt(part, 10));
    if (parts.length < 2 || parts.length > 3 || parts.some((part) => Number.isNaN(part))) {
      return undefined;
    }

    if (parts.length === 2) {
      const [minutes, seconds] = parts;
      return minutes * 60 + seconds;
    }

    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }

  private applyRosterPayload(
    state: MinimalMatchState,
    payload: unknown,
    eventKey: string,
  ): void {
    if (!this.isRecord(payload)) {
      return;
    }

    const playerKey = this.resolvePlayerKey(payload, eventKey);
    if (!playerKey) {
      return;
    }

    const player = this.getOrCreatePlayer(state, playerKey);
    const { canonicalPayload } = canonicalizeGepRosterPayloadV2(payload);

    if (canonicalPayload.playerName !== undefined) {
      player.playerName = canonicalPayload.playerName;
    }
    if (canonicalPayload.isLocal !== undefined) {
      player.isLocal = canonicalPayload.isLocal;
    }
    if (canonicalPayload.heroName !== undefined) {
      player.heroName = canonicalPayload.heroName;
    }
    if (canonicalPayload.heroId !== undefined) {
      player.heroId = canonicalPayload.heroId;
    }
    if (canonicalPayload.teamId !== undefined) {
      player.teamId = canonicalPayload.teamId;
    }
    if (canonicalPayload.laneId !== undefined) {
      player.lane = canonicalPayload.laneId;
    }
    if (canonicalPayload.level !== undefined) {
      player.level = canonicalPayload.level;
    }
    if (canonicalPayload.soulsRaw !== undefined) {
      player.souls = canonicalPayload.soulsRaw;
    }
    if (canonicalPayload.health !== undefined) {
      player.health = canonicalPayload.health;
    }
    if (canonicalPayload.maxHealth !== undefined) {
      player.maxHealth = canonicalPayload.maxHealth;
    }
    if (canonicalPayload.kills !== undefined) {
      player.kills = canonicalPayload.kills;
    }
    if (canonicalPayload.deaths !== undefined) {
      player.deaths = canonicalPayload.deaths;
    }
    if (canonicalPayload.assists !== undefined) {
      player.assists = canonicalPayload.assists;
    }
    if (canonicalPayload.heroDamage !== undefined) {
      player.heroDamage = canonicalPayload.heroDamage;
    }
    if (canonicalPayload.objectDamage !== undefined) {
      player.objectDamage = canonicalPayload.objectDamage;
    }
    if (canonicalPayload.heroHealing !== undefined) {
      player.healing = canonicalPayload.heroHealing;
    }
  }

  private applyItemsPayload(
    state: MinimalMatchState,
    payload: unknown,
    eventKey: string,
  ): boolean {
    if (!this.isRecord(payload)) {
      return false;
    }

    const playerKey = this.resolvePlayerKey(payload, eventKey);
    if (!playerKey) {
      return false;
    }

    const itemsValue = payload.items;
    if (!Array.isArray(itemsValue)) {
      return false;
    }

    const player = this.getOrCreatePlayer(state, playerKey);
    const nextItems: MinimalItemState[] = [];

    for (const item of itemsValue) {
      if (!this.isRecord(item)) {
        continue;
      }

      const id = this.getNumericValue(item, 'id');
      const name = this.getStringValue(item, 'name');
      const className = this.getStringValue(item, 'class_name');
      if (id === undefined || name === undefined || className === undefined) {
        continue;
      }

      nextItems.push({
        id,
        name,
        className,
        enhanced: this.getBooleanValue(item, 'enhanced'),
        firstSeenAtSec: state.gameTimeSec,
      });
    }

    const previousKey = this.itemIdentityKey(player.items);
    const nextKey = this.itemIdentityKey(nextItems);
    player.items = nextItems;
    return previousKey !== nextKey;
  }

  private resolvePlayerKey(
    payload: Record<string, unknown>,
    eventKey: string,
  ): string | undefined {
    const { canonicalPayload } = canonicalizeGepRosterPayloadV2(payload);
    const steamId = canonicalPayload.steamId;
    if (!steamId) {
      return undefined;
    }

    if (steamId !== '0') {
      return steamId;
    }

    const rosterSlot = eventKey.startsWith('roster_')
      ? eventKey
      : eventKey.startsWith('items_')
        ? `roster_${eventKey.slice('items_'.length)}`
        : undefined;
    if (rosterSlot) {
      return `bot:${rosterSlot}`;
    }

    const teamId = canonicalPayload.teamId ?? 'unknown';
    const heroId = canonicalPayload.heroId ?? 'unknown';
    const playerName = canonicalPayload.playerName ?? 'unknown';
    return `bot:${teamId}:${heroId}:${playerName}`;
  }

  private captureSnapshotIfNeeded(state: MinimalMatchState, force: boolean): void {
    if (!state.matchId || state.matchId === 'unknown') {
      return;
    }

    const existing = this.snapshots.get(state.matchId) ?? [];
    const latest = existing[existing.length - 1];
    const gameTimeSec = state.gameTimeSec;
    const intervalElapsed =
      gameTimeSec !== undefined &&
      (latest?.gameTimeSec === undefined ||
        gameTimeSec - latest.gameTimeSec >= this.snapshotIntervalSec);

    if (!force && !intervalElapsed && existing.length > 0) {
      return;
    }

    const snapshot: MinimalMatchSnapshot = {
      matchId: state.matchId,
      gameTimeSec,
      capturedAt: new Date().toISOString(),
      playersBySteamId: Object.entries(state.playersBySteamId).reduce<
        Record<string, MinimalMatchSnapshot['playersBySteamId'][string]>
      >((acc, [steamId, player]) => {
        acc[steamId] = {
          steamId,
          heroId: player.heroId,
          teamId: player.teamId,
          level: player.level,
          souls: player.souls,
          kills: player.kills,
          deaths: player.deaths,
          assists: player.assists,
          heroDamage: player.heroDamage,
          objectDamage: player.objectDamage,
          healing: player.healing,
          itemIds: player.items.map((item) => item.id),
        };
        return acc;
      }, {}),
    };

    const nextSnapshots = [...existing, snapshot].slice(-this.maxSnapshotsPerMatch);
    this.snapshots.set(state.matchId, nextSnapshots);
  }

  private itemIdentityKey(items: MinimalItemState[]): string {
    return items
      .map((item) => item.id)
      .sort((a, b) => a - b)
      .join(',');
  }

  private getOrCreatePlayer(
    state: MinimalMatchState,
    steamId: string,
  ): MinimalPlayerState {
    const existing = state.playersBySteamId[steamId];
    if (existing) {
      return existing;
    }

    const created: MinimalPlayerState = {
      steamId,
      playerName: '',
      items: [],
    };
    state.playersBySteamId[steamId] = created;
    return created;
  }

  private getStringValue(
    record: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private getNumericValue(
    record: Record<string, unknown>,
    key: string,
  ): number | undefined {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  private getBooleanValue(record: Record<string, unknown>, key: string): boolean {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return value !== 0;
    }

    if (typeof value === 'string') {
      return value === 'true' || value === '1';
    }

    return false;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
