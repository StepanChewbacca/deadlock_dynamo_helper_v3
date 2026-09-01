import { OverwolfLiveBatchDto, OverwolfLiveEventDto } from '@deadlock-live-probe/shared';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type MatchIdProvider = () => string | undefined;
type InventoryFlushCallback = (batch: OverwolfLiveBatchDto) => void;

export class LiveEventBuffer {
  private readonly events: OverwolfLiveEventDto[] = [];
  private readonly pendingBatches: OverwolfLiveEventDto[][] = [];
  private timerId?: ReturnType<typeof setTimeout>;
  private flushing = false;

  constructor(
    private readonly clientId: string,
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly flushDelayMs = 1000,
    private readonly matchIdProvider: MatchIdProvider = readCurrentMatchId,
    private readonly onInventoryFlushSuccess: InventoryFlushCallback =
      refreshCurrentBuildRecommendation,
  ) {}

  push(event: OverwolfLiveEventDto): void {
    const providedMatchId = this.matchIdProvider()?.trim();
    const eventMatchId = event.matchId?.trim();
    const matchId = eventMatchId || providedMatchId;

    this.events.push(matchId ? { ...event, matchId } : event);

    if (isImmediateEvent(event)) {
      this.scheduleFlush(0, true);
      return;
    }

    this.scheduleFlush(this.flushDelayMs, false);
  }

  private scheduleFlush(delayMs: number, replaceExisting: boolean): void {
    if (this.timerId) {
      if (!replaceExisting) {
        return;
      }
      clearTimeout(this.timerId);
      this.timerId = undefined;
    }

    this.timerId = setTimeout(() => {
      void this.flush();
    }, delayMs);
  }

  private async flush(): Promise<void> {
    this.timerId = undefined;

    const queuedEvents = this.events.splice(0);
    if (queuedEvents.length > 0) {
      this.pendingBatches.push(queuedEvents);
    }

    if (this.flushing) {
      return;
    }

    const events = this.pendingBatches[0];
    if (!events) {
      return;
    }

    const body: OverwolfLiveBatchDto = {
      clientId: this.clientId,
      events,
    };

    this.flushing = true;
    let accepted = false;
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.apiBaseUrl}/deadlock/live/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (err) {
        console.error('Failed to flush event batch:', err);
        return;
      }

      if (!response.ok) {
        return;
      }

      this.pendingBatches.shift();
      accepted = true;
      if (events.some(isInventoryEvent)) {
        try {
          this.onInventoryFlushSuccess(body);
        } catch (error) {
          console.warn('Failed to refresh recommendation after inventory ingest:', error);
        }
      }
    } finally {
      this.flushing = false;
      if (this.pendingBatches.length > 0) {
        this.scheduleFlush(accepted ? 0 : this.flushDelayMs, true);
      } else if (this.events.length > 0 && this.timerId === undefined) {
        this.scheduleFlush(this.flushDelayMs, false);
      }
    }
  }
}

function isImmediateEvent(event: OverwolfLiveEventDto): boolean {
  return event.feature === 'state_safety_poll' || isInventoryEvent(event);
}

function isInventoryEvent(event: OverwolfLiveEventDto): boolean {
  return typeof event.key === 'string' && event.key.startsWith('items');
}

function refreshCurrentBuildRecommendation(): void {
  try {
    const ow = (globalThis as any).overwolf;
    const mainWindow = ow?.windows?.getMainWindow?.();
    if (typeof mainWindow?.forceLiveBuildRecommendationRefresh === 'function') {
      mainWindow.forceLiveBuildRecommendationRefresh();
    }
  } catch (error) {
    console.warn('Failed to refresh build recommendation after inventory ingest:', error);
  }
}

function readCurrentMatchId(): string | undefined {
  const globalMatchId = (globalThis as any).__deadlockLiveMatchId;
  if (typeof globalMatchId === 'string' && globalMatchId.trim()) {
    return globalMatchId.trim();
  }

  try {
    const ow = (globalThis as any).overwolf;
    const mainWindow = ow?.windows?.getMainWindow?.();
    const mainWindowMatchId = mainWindow?.__deadlockLiveMatchId;
    return typeof mainWindowMatchId === 'string' && mainWindowMatchId.trim()
      ? mainWindowMatchId.trim()
      : undefined;
  } catch {
    return undefined;
  }
}
