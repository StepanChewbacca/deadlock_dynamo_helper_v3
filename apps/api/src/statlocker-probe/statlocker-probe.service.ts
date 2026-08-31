import { BadRequestException, Injectable } from '@nestjs/common';
import axios, { AxiosResponse } from 'axios';

export type StatlockerProbeMethod = 'GET' | 'POST';

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
  suggestedQuery?: Record<string, string | number | boolean>;
}

export interface DiscoveredStatlockerEndpoint {
  path: string;
  sourceAsset: string;
  likelyUseful: boolean;
  rawDeadlockDuplicate: boolean;
  matchedKeywords: string[];
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
    '/wpa-analysis',
    '/vision/wpa',
    '/vision/win-chance',
    '/builds/eternus-builds/abrams',
    '/builds/build-lab',
    '/items',
  ];

  private readonly targets: StatlockerProbeTarget[] = [
    {
      id: 'item-meta-wpa',
      title: 'Item Meta / WPA',
      priority: 'HIGH',
      sourcePage: '/wpa-analysis',
      usefulFor: 'External candidate-value evidence and item ranking diagnostics.',
      expectedSignals: [
        'hero/item WPA',
        'sample size',
        'rank/queue/patch filters',
        'build archetype filters',
      ],
      suggestedQuery: {
        hero: 'Abrams',
        mode: 'items-heroes',
        min: 500,
      },
    },
    {
      id: 'purchase-timing',
      title: 'Purchase Time / Souls Timing',
      priority: 'HIGH',
      sourcePage: '/wpa-analysis',
      usefulFor: 'Timing priors for candidate generation and build trajectory scoring.',
      expectedSignals: [
        'purchase-time distribution',
        'souls/net-worth at purchase',
        'optimal timing bands',
      ],
      suggestedQuery: {
        hero: 'Abrams',
      },
    },
    {
      id: 't4-build-chains',
      title: 'T4 Build Chains / Synergy',
      priority: 'HIGH',
      sourcePage: '/vision/wpa?graph=t4-chains&hero=Abrams&min=500&mode=items-heroes',
      usefulFor: 'Build continuation priors and candidate-item interaction features.',
      expectedSignals: [
        'ordered item chains',
        'per-item WPA',
        'chain WPA',
        'games/sample size',
        'win rate',
      ],
      suggestedQuery: {
        hero: 'Abrams',
        graph: 't4-chains',
        mode: 'items-heroes',
        min: 500,
      },
    },
    {
      id: 'comeback-win-more',
      title: 'Comeback / Win-More',
      priority: 'HIGH',
      sourcePage: '/wpa-analysis',
      usefulFor: 'Situation-aware item evidence when the team is ahead or behind.',
      expectedSignals: [
        'comeback score',
        'win-more score',
        'state-conditioned item impact',
      ],
      suggestedQuery: {
        hero: 'Abrams',
      },
    },
    {
      id: 'eternus-builds',
      title: 'Eternus Derived Build Analytics',
      priority: 'HIGH',
      sourcePage: '/builds/eternus-builds/abrams',
      usefulFor: 'High-rank build trajectory priors. Only derived aggregates are interesting; raw purchases are already available elsewhere.',
      expectedSignals: [
        'item pick rate by phase',
        'WPA impact',
        'buy timing',
        'synergy',
        'core/frequent/sometimes classification',
      ],
      suggestedQuery: {
        hero: 'Abrams',
      },
    },
    {
      id: 'build-lab-recommendations',
      title: 'Build Lab WPA Recommendations',
      priority: 'HIGH',
      sourcePage: '/builds/build-lab',
      usefulFor: 'External recommendation evidence and offline comparison with our own candidate ranker.',
      expectedSignals: [
        'purchase rate',
        'WPA impact',
        'optimal buy time',
        'net worth at purchase',
        'Essential/Core/Underrated/Overrated tags',
      ],
    },
    {
      id: 'win-chance',
      title: 'Win Chance Timeline',
      priority: 'MEDIUM',
      sourcePage: '/vision/win-chance',
      usefulFor: 'Independent state-model benchmark and calibration/disagreement diagnostics.',
      expectedSignals: [
        'match timestamp',
        'team win probability',
        'model output timeline',
      ],
    },
  ];

  getTargets(): StatlockerProbeTarget[] {
    return this.targets;
  }

  async discoverEndpoints(): Promise<StatlockerDiscoveryResult> {
    const scripts = new Set<string>();
    const errors: Array<{ source: string; error: string }> = [];

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

    const endpoints = new Map<string, DiscoveredStatlockerEndpoint>();
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
          const classification = this.classifyEndpoint(path);
          const key = `${path}|${scriptUrl}`;
          endpoints.set(key, {
            path,
            sourceAsset: scriptUrl,
            ...classification,
          });
        }
      } catch (error) {
        errors.push({ source: scriptUrl, error: this.describeError(error) });
      }
    }

    const sortedEndpoints = Array.from(endpoints.values()).sort((left, right) => {
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

    const url = this.resolveAllowedApiUrl(input.path);
    const startedAt = Date.now();

    const response: AxiosResponse<unknown> = await axios.request({
      url: url.toString(),
      method,
      params: input.query,
      data: method === 'POST' ? input.body : undefined,
      timeout: 15_000,
      maxContentLength: 2_000_000,
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
      'User-Agent': 'deadlock-dynamo-statlocker-probe/0.1',
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
