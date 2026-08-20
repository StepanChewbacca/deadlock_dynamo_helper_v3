import { LiveBuildRecommendationSnapshot } from './live-build-recommendation-poller';

const DEFAULT_API_BASE_URL = 'https://aboba-telegramovich.duckdns.org';
const EXPOSURE_PATH = '/deadlock/analysis/recommendation-telemetry/exposure';
const MAX_EXPOSED_ALTERNATIVES = 4;

export interface LiveBuildExposureAcknowledgerOptions {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export class LiveBuildExposureAcknowledger {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly nowMs: () => number;
  private readonly acknowledgedDecisionIds = new Set<string>();
  private readonly inFlightDecisionIds = new Set<string>();

  constructor(options: LiveBuildExposureAcknowledgerOptions = {}) {
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  async acknowledgeRendered(
    snapshot: LiveBuildRecommendationSnapshot,
  ): Promise<boolean> {
    const payload = createLiveBuildExposurePayload(snapshot, this.nowMs());
    if (!payload) {
      return false;
    }
    if (
      this.acknowledgedDecisionIds.has(payload.decisionId) ||
      this.inFlightDecisionIds.has(payload.decisionId)
    ) {
      return false;
    }

    this.inFlightDecisionIds.add(payload.decisionId);
    try {
      const request: RequestInit = {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      };
      const response = this.fetchImpl
        ? await this.fetchImpl(`${this.apiBaseUrl}${EXPOSURE_PATH}`, request)
        : await window.fetch(`${this.apiBaseUrl}${EXPOSURE_PATH}`, request);
      if (!response.ok) {
        throw new Error(`Exposure acknowledgement failed with HTTP ${response.status}.`);
      }
      this.acknowledgedDecisionIds.add(payload.decisionId);
      return true;
    } finally {
      this.inFlightDecisionIds.delete(payload.decisionId);
    }
  }
}

export interface LiveBuildExposurePayload {
  decisionId: string;
  matchId: string;
  steamId: string;
  exposedActionKeys: string[];
  acknowledgedAtMs: number;
  surface: 'IN_GAME';
}

export function createLiveBuildExposurePayload(
  snapshot: LiveBuildRecommendationSnapshot,
  acknowledgedAtMs: number,
): LiveBuildExposurePayload | undefined {
  if (
    snapshot.state !== 'READY' ||
    !snapshot.decisionId ||
    !snapshot.steamId ||
    !snapshot.recommendation ||
    !Number.isSafeInteger(acknowledgedAtMs) ||
    acknowledgedAtMs < 0
  ) {
    return undefined;
  }

  const exposedActionKeys = [
    snapshot.recommendation.action.actionKey,
    ...snapshot.recommendation.alternatives
      .slice(0, MAX_EXPOSED_ALTERNATIVES)
      .map((action) => action.actionKey),
  ].filter((actionKey) => typeof actionKey === 'string' && actionKey.trim().length > 0);
  const uniqueActionKeys = [...new Set(exposedActionKeys)];
  if (uniqueActionKeys.length === 0) {
    return undefined;
  }

  return {
    decisionId: snapshot.decisionId,
    matchId: snapshot.matchId,
    steamId: snapshot.steamId,
    exposedActionKeys: uniqueActionKeys,
    acknowledgedAtMs,
    surface: 'IN_GAME',
  };
}

const defaultAcknowledger = new LiveBuildExposureAcknowledger();

export async function acknowledgeLiveBuildRecommendationExposure(
  snapshot: LiveBuildRecommendationSnapshot,
): Promise<boolean> {
  try {
    return await defaultAcknowledger.acknowledgeRendered(snapshot);
  } catch (error) {
    console.warn(
      `Live build exposure acknowledgement failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}
