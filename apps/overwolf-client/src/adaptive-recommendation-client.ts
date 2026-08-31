import {
  AdaptiveRecommendationRequestV1,
  AdaptiveRecommendationResultV1,
} from '@deadlock-live-probe/shared';

export interface AdaptiveRecommendationClientHandlers {
  onResult: (result: AdaptiveRecommendationResultV1) => void;
  onError?: (error: Error) => void;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface PendingRequest {
  request: AdaptiveRecommendationRequestV1;
  payload: string;
  handlers: AdaptiveRecommendationClientHandlers;
}

export class AdaptiveRecommendationClient {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: PendingRequest;
  private inFlight?: Promise<void>;
  private inFlightPayload?: string;
  private lastCompletedPayload?: string;

  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetcher: FetchLike,
    private readonly debounceMs = 1500,
  ) {}

  schedule(
    request: AdaptiveRecommendationRequestV1,
    handlers: AdaptiveRecommendationClientHandlers,
    force = false,
  ): void {
    const normalized = normalizeRequest(request);
    const payload = JSON.stringify(normalized);
    if (force && this.lastCompletedPayload === payload) this.lastCompletedPayload = undefined;
    if (!force && (
      payload === this.pending?.payload ||
      payload === this.inFlightPayload ||
      payload === this.lastCompletedPayload
    )) return;

    this.pending = { request: normalized, payload, handlers };
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flushPending();
    }, this.debounceMs);
  }

  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }

  private async flushPending(): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    if (this.inFlight) {
      this.inFlight.finally(() => this.schedulePendingAfterFlight());
      return;
    }

    this.pending = undefined;
    this.inFlightPayload = pending.payload;
    const requestPromise = this.execute(pending)
      .finally(() => {
        this.inFlight = undefined;
        this.inFlightPayload = undefined;
        this.schedulePendingAfterFlight();
      });
    this.inFlight = requestPromise;
    await requestPromise;
  }

  private schedulePendingAfterFlight(): void {
    if (!this.pending || this.timer !== undefined || this.inFlight) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flushPending();
    }, 0);
  }

  private async execute(pending: PendingRequest): Promise<void> {
    try {
      const response = await this.fetcher(`${this.apiBaseUrl}/deadlock/adaptive/v1/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: pending.payload,
      });
      if (!response.ok) {
        throw new Error(`Adaptive recommendation HTTP ${response.status}`);
      }
      const result = await response.json() as AdaptiveRecommendationResultV1;
      this.lastCompletedPayload = pending.payload;
      pending.handlers.onResult(result);
    } catch (error) {
      pending.handlers.onError?.(toError(error));
    }
  }
}

function normalizeRequest(request: AdaptiveRecommendationRequestV1): AdaptiveRecommendationRequestV1 {
  if (!request || typeof request.matchId !== 'string' || request.matchId.trim() === '') {
    throw new Error('Adaptive recommendation matchId is required');
  }
  const localSteamId = request.localSteamId?.trim();
  return {
    matchId: request.matchId.trim(),
    localSteamId: localSteamId || undefined,
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
