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
  cancellationRevision: number;
}

export class AdaptiveRecommendationClient {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: PendingRequest;
  private pendingDelayMs = 0;
  private inFlight?: Promise<void>;
  private inFlightPayload?: string;
  private lastCompletedPayload?: string;
  private cancellationRevision = 0;

  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetcher: FetchLike,
    private readonly debounceMs = 1500,
    private readonly retryDelayMs = 3000,
  ) {}

  schedule(
    request: AdaptiveRecommendationRequestV1,
    handlers: AdaptiveRecommendationClientHandlers,
    force = false,
  ): void {
    const normalized = normalizeRequest(request);
    const payload = JSON.stringify(normalized);

    if (payload === this.pending?.payload) return;
    if (payload === this.inFlightPayload && !force) return;

    if (force && this.lastCompletedPayload === payload) {
      this.lastCompletedPayload = undefined;
    }
    if (!force && payload === this.lastCompletedPayload) return;

    this.pending = {
      request: normalized,
      payload,
      handlers,
      cancellationRevision: this.cancellationRevision,
    };
    this.pendingDelayMs = 0;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flushPending();
    }, this.debounceMs);
  }

  cancel(): void {
    this.cancellationRevision += 1;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    this.pendingDelayMs = 0;
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
    const delayMs = this.pendingDelayMs;
    this.pendingDelayMs = 0;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flushPending();
    }, delayMs);
  }

  private async execute(pending: PendingRequest): Promise<void> {
    let shouldRetry = true;
    let result: AdaptiveRecommendationResultV1;
    try {
      const response = await this.fetcher(`${this.apiBaseUrl}/deadlock/adaptive/v1/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: pending.payload,
      });
      if (!response.ok) {
        shouldRetry = response.status >= 500 || response.status === 429;
        throw new Error(`Adaptive recommendation HTTP ${response.status}`);
      }
      shouldRetry = false;
      result = await response.json() as AdaptiveRecommendationResultV1;
    } catch (error) {
      if (pending.cancellationRevision !== this.cancellationRevision) return;
      if (
        shouldRetry &&
        !this.pending &&
        pending.cancellationRevision === this.cancellationRevision
      ) {
        this.pending = pending;
        this.pendingDelayMs = this.retryDelayMs;
      }
      try {
        pending.handlers.onError?.(toError(error));
      } catch (handlerError) {
        console.warn('Adaptive recommendation error observer failed:', handlerError);
      }
      return;
    }

    if (pending.cancellationRevision !== this.cancellationRevision) return;
    if (!result.ready && !this.pending) {
      this.pending = pending;
      this.pendingDelayMs = this.retryDelayMs;
    }
    this.lastCompletedPayload = result.ready ? pending.payload : undefined;
    pending.handlers.onResult(result);
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
