import { BadRequestException, Injectable } from '@nestjs/common';
import axios, { AxiosResponse } from 'axios';

export type StatlockerProbeMethod = 'GET' | 'POST';
export type StatlockerEndpointConfidence = 'FRONTEND_CONFIRMED' | 'DISCOVERED';
export type StatlockerEndpointAccess = 'PUBLIC_200' | 'AUTH_401' | 'NEEDS_INPUT' | 'UNKNOWN';

export interface StatlockerProbeRequest {
  method?: StatlockerProbeMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export interface StatlockerProbeResponse {
  url: string;
  method: StatlockerProbeMethod;
  status: number;
  elapsedMs: number;
  headers: Record<string, string>;
  data: unknown;
}

export interface StatlockerProbeTarget {
  id: string;
  title: string;
  priority: 'HIGH' | 'MEDIUM';
  sourcePage: string;
  usefulFor: string;
  expectedSignals: string[];
  endpoint?: string;
  method?: StatlockerProbeMethod;
  access?: StatlockerEndpointAccess;
  suggestedQuery?: Record<string, string | number | boolean>;
}

export interface DiscoveredStatlockerEndpoint {
  path: string;
  sourceAsset: string;
  likelyUseful: boolean;
  rawDeadlockDuplicate: boolean;
  matchedKeywords: string[];
  modelFamily?: string;
  confidence?: StatlockerEndpointConfidence;
  access?: StatlockerEndpointAccess;
  methodHint?: StatlockerProbeMethod;
  notes?: string;
  suggestedQuery?: Record<string, string | number | boolean>;
}

export interface StatlockerDiscoveryResult {
  pagesChecked: string[];
  scriptsChecked: string[];
  endpoints: DiscoveredStatlockerEndpoint[];
  errors: Array<{ source: string; error: string }>;
}

@Injectable()
export class StatlockerProbeService {
  private readonly baseUrl = 'https://statlocker.gg';

  private readonly sourcePages = [
    '/items/meta-model/wpa-analysis/',
    '/vision/wpa',
    '/vision/win-chance',
    '/builds/eternus-builds/abrams',
    '/builds/build-lab',
    '/items',
  ];

  private readonly defaultWpaQuery: Record<string, string | number | boolean> = {
    hero: 'Abrams',
    tier: 'all',
    queue: 'ranked',
    rank: 'all',
    category: 'all',
    gameState: 'all',
    purchaseTime: 'all',
    teamComp: 'all',
    buildType: 'all',
    patch: 'all',
    minSampleSize: 500,
    searchTerm: '',
    sortBy: 'wpa',
    timeSyncEnabled: false,
    currentGameTime: 0,
    timeWindow: 5,
  };

  private readonly knownModelEndpoints: DiscoveredStatlockerEndpoint[] = [
    {
      path: '/api/info/wpa-filtered-items',
      sourceAsset: 'https://statlocker.gg/static/js/4914.58610374.chunk.js',
      likelyUseful: true,
      rawDeadlockDuplicate: false,
      matchedKeywords: ['wpa', 'purchase-time', 'meta'],
      modelFamily: 'ITEM_META_WPA',
      confidence: 'FRONTEND_CONFIRMED',
      access: 'AUTH_401',
      methodHint: 'GET',
      notes: 'Primary Item Meta/WPA endpoint. Direct anonymous probe returned HTTP 401; the Statlocker frontend calls it with session credentials.',
      suggestedQuery: this.defaultWpaQuery,
    },
    {
      path: '/api/info/t4-chains-data',
      sourceAsset: 'https://statlocker.gg/static/js/4914.58610374.chunk.js',
      likelyUseful: true,
      rawDeadlockDuplicate: false,
      matchedKeywords: ['wpa', 't4', 'chain', 'synergy'],
      modelFamily: 'T4_BUILD_CHAINS',
      confidence: 'FRONTEND_CONFIRMED',
      access: 'PUBLIC_200',
      methodHint: 'GET',
      notes: 'Frontend-confirmed chain/synergy dataset. Anonymous verification returned HTTP 200 with top-level metadata and by_hero.',
    },
    {
      path: '/api/info/vs-hero-wpa-data',
      sourceAsset: 'https://statlocker.gg/static/js/4914.58610374.chunk.js',
      likelyUseful: true,
      rawDeadlockDuplicate: false,
      matchedKeywords: ['wpa'],
      modelFamily: 'VS_HERO_WPA',
      confidence: 'FRONTEND_CONFIRMED',
      access: 'AUTH_401',
      methodHint: 'GET',
      notes: 'Counter-item / lane-matchup WPA dataset. Anonymous verification returned HTTP 401.',
    },
    {
      path: '/api/info/wpa-patches',
      sourceAsset: 'https://statlocker.gg/static/js/524.d6c66927.chunk.js',
      likelyUseful: true,
      rawDeadlockDuplicate: false,
      matchedKeywords: ['wpa'],
      modelFamily: 'WPA_PATCHES',
      confidence: 'FRONTEND_CONFIRMED',
      access: 'AUTH_401',
      methodHint: 'GET',
      notes: 'Patch selector backing the WPA UI. Anonymous verification returned HTTP 401.',
    },
    {
      path: '/api/info/wpa-patch-data/{patch}',
      sourceAsset: 'https://statlocker.gg/static/js/524.d6c66927.chunk.js',
      likelyUseful: true,
      rawDeadlockDuplicate: false,
      matchedKeywords: ['wpa'],
      modelFamily: 'WPA_PATCH_DATA',
      confidence: 'FRONTEND_CONFIRMED',
      access: 'NEEDS_INPUT',
      methodHint: 'GET',
      notes: 'Patch-specific WPA comparison data. Replace {patch} before testing.',
    },
    {
      path: '/api/match/{matchId}/win-rate',
      sourceAsset: 'https://statlocker.gg/static/js/6653.d4d5b665.chunk.js',
      likelyUseful: true,
      rawDeadlockDuplicate: false,
      matchedKeywords: ['win-probability', 'prediction'],
      modelFamily: 'WIN_CHANCE',
      confidence: 'FRONTEND_CONFIRMED',
      access: 'NEEDS_INPUT',
      methodHint: 'GET',
      notes: 'Win Chance model timeline. The frontend validates a winRateIntervals array. Replace {matchId} with a real match ID.',
    },
    {
      path: '/api/match/{matchId}/wpa/{accountId}',
      sourceAsset: 'https://statlocker.gg/static/js/7399.edf4fc62.chunk.js',
      likelyUseful: true,
      rawDeadlockDuplicate: false,
      matchedKeywords: ['wpa'],
      modelFamily: 'PLAYER_WPA',
      confidence: 'FRONTEND_CONFIRMED',
      access: 'NEEDS_INPUT',
      methodHint: 'GET',
      notes: 'Player-specific WPA analysis used by Vision/Player Improvement. Frontend code indicates session/Beta gating is possible.',
    },
    {
      path: '/api/match/build-context/{matchId}/{accountId}',
      sourceAsset: 'https://statlocker.gg/static/js/7399.edf4fc62.chunk.js',
      likelyUseful: true,
      rawDeadlockDuplicate: false,
      matchedKeywords: ['timing', 'meta'],
      modelFamily: 'BUILD_CONTEXT',
      confidence: 'FRONTEND_CONFIRMED',
      access: 'NEEDS_INPUT',
      methodHint: 'GET',
      notes: 'Build context used by Vision. Frontend consumes purchase_history and meta_popularity style data. Replace both path parameters.',
    },
  ];

  private readonly targets: StatlockerProbeTarget[] = [
    {
      id: 'item-meta-wpa',
      title: 'Item Meta / WPA',
      priority: 'HIGH',
      sourcePage: '/items/meta-model/wpa-analysis/',
      usefulFor: 'Primary external item-value model signal for candidate ranking, purchase timing and situation-aware build analysis.',
      expectedSignals: [
        'hero/item WPA',
        'sample size',
        'game-state WPA',
        'purchase time',
        'cost-relative WPA',
      ],
      endpoint: '/api/info/wpa-filtered-items',
      method: 'GET',
      access: 'AUTH_401',
      suggestedQuery: this.defaultWpaQuery,
    },
    {
      id: 't4-build-chains',
      title: 'T4 Build Chains / Synergy',
      priority: 'HIGH',
      sourcePage: '/vision/wpa?graph=t4-chains&hero=Abrams&min=500&mode=items-heroes',
      usefulFor: 'Build continuation priors and candidate-item interaction features.',
      expectedSignals: [
        'ordered item chains',
        'chain/meta metadata',
        'hero-specific chain data',
      ],
      endpoint: '/api/info/t4-chains-data',
      method: 'GET',
      access: 'PUBLIC_200',
    },
    {
      id: 'vs-hero-wpa',
      title: 'Counter / Vs Hero WPA',
      priority: 'HIGH',
      sourcePage: '/items/meta-model/wpa-analysis/',
      usefulFor: 'Enemy-hero-conditioned item evidence for matchup-aware candidate scoring.',
      expectedSignals: ['counter-item WPA', 'lane matchup signal', 'hero-conditioned impact'],
      endpoint: '/api/info/vs-hero-wpa-data',
      method: 'GET',
      access: 'AUTH_401',
    },
    {
      id: 'win-chance',
      title: 'Win Chance Timeline',
      priority: 'HIGH',
      sourcePage: '/vision/win-chance',
      usefulFor: 'Independent state-model benchmark and calibration/disagreement diagnostics.',
      expectedSignals: ['match timestamp', 'team win probability', 'winRateIntervals'],
      endpoint: '/api/match/{matchId}/win-rate',
      method: 'GET',
      access: 'NEEDS_INPUT',
    },
    {
      id: 'player-wpa',
      title: 'Player WPA / Vision',
      priority: 'HIGH',
      sourcePage: '/vision',
      usefulFor: 'Player-specific contribution/WPA evidence from the Vision analysis flow.',
      expectedSignals: ['player WPA', 'match-state attribution', 'Vision model output'],
      endpoint: '/api/match/{matchId}/wpa/{accountId}',
      method: 'GET',
      access: 'NEEDS_INPUT',
    },
    {
      id: 'build-context',
      title: 'Build Context / Purchase Timeline',
      priority: 'HIGH',
      sourcePage: '/vision',
      usefulFor: 'Purchase-history and meta-popularity context for timing and trajectory features.',
      expectedSignals: ['purchase history', 'meta popularity', 'average buy minute', 'build trajectory'],
      endpoint: '/api/match/build-context/{matchId}/{accountId}',
      method: 'GET',
      access: 'NEEDS_INPUT',
    },
    {
      id: 'eternus-builds',
      title: 'Eternus Derived Build Analytics',
      priority: 'MEDIUM',
      sourcePage: '/builds/eternus-builds/abrams',
      usefulFor: 'High-rank build trajectory priors. Derived aggregates are interesting; raw purchases are already available elsewhere.',
      expectedSignals: ['item pick rate by phase', 'WPA impact', 'buy timing', 'synergy'],
      access: 'UNKNOWN',
    },
  ];

  getTargets(): StatlockerProbeTarget[] {
    return this.targets;
  }

  async discoverEndpoints(): Promise<StatlockerDiscoveryResult> {
    const scripts = new Set<string>();
    const errors: Array<{ source: string; error: string }> = [];
    const endpoints = new Map<string, DiscoveredStatlockerEndpoint>();

    for (const endpoint of this.knownModelEndpoints) {
      endpoints.set(endpoint.path, endpoint);
    }

    for (const pagePath of this.sourcePages) {
      const pageUrl = new URL(pagePath, this.baseUrl).toString();

      try {
        const response = await axios.get<string>(pageUrl, {
          timeout: 10_000,
          responseType: 'text',
          maxContentLength: 2_000_000,
          headers: this.getProbeHeaders(),
        });

        for (const scriptSrc of this.extractScriptSources(response.data)) {
          const scriptUrl = new URL(scriptSrc, pageUrl);
          if (this.isStatlockerHost(scriptUrl.hostname)) {
            scripts.add(scriptUrl.toString());
          }
        }
      } catch (error) {
        errors.push({ source: pageUrl, error: this.describeError(error) });
      }
    }

    const scriptsToCheck = Array.from(scripts).slice(0, 20);

    for (const scriptUrl of scriptsToCheck) {
      try {
        const response = await axios.get<string>(scriptUrl, {
          timeout: 15_000,
          responseType: 'text',
          maxContentLength: 8_000_000,
          headers: this.getProbeHeaders(),
        });

        for (const path of this.extractApiPaths(response.data)) {
          if (endpoints.has(path)) {
            continue;
          }

          const classification = this.classifyEndpoint(path);
          endpoints.set(path, {
            path,
            sourceAsset: scriptUrl,
            confidence: 'DISCOVERED',
            access: 'UNKNOWN',
            methodHint: 'GET',
            ...classification,
          });
        }
      } catch (error) {
        errors.push({ source: scriptUrl, error: this.describeError(error) });
      }
    }

    const sortedEndpoints = Array.from(endpoints.values()).sort((left, right) => {
      if (left.confidence !== right.confidence) {
        return left.confidence === 'FRONTEND_CONFIRMED' ? -1 : 1;
      }
      if (left.likelyUseful !== right.likelyUseful) {
        return left.likelyUseful ? -1 : 1;
      }
      if (left.rawDeadlockDuplicate !== right.rawDeadlockDuplicate) {
        return left.rawDeadlockDuplicate ? 1 : -1;
      }
      return left.path.localeCompare(right.path);
    });

    return {
      pagesChecked: this.sourcePages.map((path) => new URL(path, this.baseUrl).toString()),
      scriptsChecked: scriptsToCheck,
      endpoints: sortedEndpoints,
      errors,
    };
  }

  async request(input: StatlockerProbeRequest): Promise<StatlockerProbeResponse> {
    if (!input || typeof input.path !== 'string' || input.path.trim().length === 0) {
      throw new BadRequestException('path is required');
    }

    const method: StatlockerProbeMethod = input.method ?? 'GET';
    if (method !== 'GET' && method !== 'POST') {
      throw new BadRequestException('Only GET and POST are supported');
    }

    if (/[{}]/.test(input.path)) {
      throw new BadRequestException('Replace all {pathParameters} before running the request');
    }

    const url = this.resolveAllowedApiUrl(input.path);
    const startedAt = Date.now();

    const response: AxiosResponse<unknown> = await axios.request({
      url: url.toString(),
      method,
      params: input.query,
      data: method === 'POST' ? input.body : undefined,
      timeout: 15_000,
      maxContentLength: 4_000_000,
      maxBodyLength: 2_000_000,
      validateStatus: () => true,
      headers: this.getProbeHeaders(),
    });

    return {
      url: response.config.url ?? url.toString(),
      method,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      headers: this.pickResponseHeaders(response.headers as Record<string, unknown>),
      data: response.data,
    };
  }

  private resolveAllowedApiUrl(path: string): URL {
    const value = path.trim();
    const url = value.startsWith('http://') || value.startsWith('https://')
      ? new URL(value)
      : new URL(value.startsWith('/') ? value : `/${value}`, this.baseUrl);

    if (!this.isStatlockerHost(url.hostname)) {
      throw new BadRequestException('Only statlocker.gg requests are allowed');
    }

    if (!url.pathname.startsWith('/api/')) {
      throw new BadRequestException('Only /api/* endpoints are allowed in the request tester');
    }

    return url;
  }

  private isStatlockerHost(hostname: string): boolean {
    return hostname === 'statlocker.gg' || hostname === 'www.statlocker.gg';
  }

  private extractScriptSources(html: string): string[] {
    const result: string[] = [];
    const expression = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;

    while ((match = expression.exec(html)) !== null) {
      if (match[1]) {
        result.push(match[1]);
      }
    }

    return result;
  }

  private extractApiPaths(source: string): string[] {
    const normalized = source.replace(/\\\//g, '/');
    const result = new Set<string>();
    const expression = /\/api\/[A-Za-z0-9_./?=&:$\-{}\[\]]+/g;

    for (const match of normalized.matchAll(expression)) {
      const candidate = match[0]
        .replace(/[),;]+$/g, '')
        .replace(/\\u0026/g, '&');

      if (candidate.length >= 6 && candidate.length <= 400) {
        result.add(candidate);
      }
    }

    return Array.from(result);
  }

  private classifyEndpoint(path: string): Pick<
    DiscoveredStatlockerEndpoint,
    'likelyUseful' | 'rawDeadlockDuplicate' | 'matchedKeywords'
  > {
    const lower = path.toLowerCase();
    const keywords = [
      'wpa',
      'win-chance',
      'win_probability',
      'win-probability',
      'prediction',
      'purchase-time',
      'timing',
      'comeback',
      'win-more',
      't4',
      'chain',
      'synergy',
      'eternus',
      'build-analysis',
      'recommend',
      'meta',
      'pim',
    ];

    const matchedKeywords = keywords.filter((keyword) => lower.includes(keyword));
    const rawDeadlockDuplicate = [
      '/api/public/match/',
      '/api/public/matches',
      '/api/public/profile/',
      '/api/public/profiles',
      '/api/public-draft/',
    ].some((prefix) => lower.startsWith(prefix));

    return {
      likelyUseful: matchedKeywords.length > 0 && !rawDeadlockDuplicate,
      rawDeadlockDuplicate,
      matchedKeywords,
    };
  }

  private getProbeHeaders(): Record<string, string> {
    return {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'deadlock-dynamo-statlocker-probe/0.2',
    };
  }

  private pickResponseHeaders(headers: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    const allowedPrefixes = ['content-type', 'x-ratelimit-', 'retry-after', 'cache-control'];

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (!allowedPrefixes.some((prefix) => lowerKey === prefix || lowerKey.startsWith(prefix))) {
        continue;
      }

      if (typeof value === 'string' || typeof value === 'number') {
        result[key] = String(value);
      } else if (Array.isArray(value)) {
        result[key] = value.map(String).join(', ');
      }
    }

    return result;
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
