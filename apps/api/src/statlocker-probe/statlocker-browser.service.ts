import { BadRequestException, Injectable } from '@nestjs/common';

export type StatlockerBrowserModel =
  | 'ITEM_META_WPA'
  | 'ETERNUS_BUILD_ANALYSIS'
  | 'T4_BUILD_CHAINS'
  | 'WIN_CHANCE';

export interface StatlockerBrowserProbeRequest {
  model: StatlockerBrowserModel;
  hero?: string;
  minSampleSize?: number;
  matchId?: string;
}

export interface StatlockerBrowserCapturedResponse {
  url: string;
  path: string;
  status: number;
  method: string;
  data: unknown;
}

export interface StatlockerBrowserProbeResult {
  model: StatlockerBrowserModel;
  sourcePage: string;
  elapsedMs: number;
  browserMode: true;
  apiKeyProvidedByUs: false;
  captured: StatlockerBrowserCapturedResponse[];
  primary: StatlockerBrowserCapturedResponse;
}

interface BrowserTarget {
  sourcePage: (input: StatlockerBrowserProbeRequest) => string;
  matches: (path: string) => boolean;
  primary: (
    responses: StatlockerBrowserCapturedResponse[],
  ) => StatlockerBrowserCapturedResponse | undefined;
}

@Injectable()
export class StatlockerBrowserService {
  private readonly baseUrl = 'https://statlocker.gg';
  private readonly responseBodyTimeoutMs = 10_000;

  async probe(
    input: StatlockerBrowserProbeRequest,
  ): Promise<StatlockerBrowserProbeResult> {
    const target = this.getTarget(input?.model);
    const sourcePage = target.sourcePage(input);
    const startedAt = Date.now();

    // POC only: puppeteer-core is injected into the isolated probe image at deploy time.
    // Using require keeps the production API dependency graph untouched.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const puppeteer = require('puppeteer-core') as {
      launch(options: Record<string, unknown>): Promise<any>;
    };

    const browser = await puppeteer.launch({
      executablePath:
        process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 1000 });
      await page.setUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      );

      const captured: StatlockerBrowserCapturedResponse[] = [];

      page.on('response', (response: any) => {
        void this.captureResponse(response, target, captured);
      });

      await page.goto(sourcePage, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });

      if (input.model === 'WIN_CHANCE') {
        await this.triggerWinChance(
          page,
          this.normalizeMatchId(input.matchId),
        );
      }

      if (input.model === 'T4_BUILD_CHAINS') {
        // The route can render from cached state without re-requesting the T4 dataset.
        // Trigger the same public fetch from inside the Statlocker page so the probe stays browser-driven.
        await this.sleep(1_500);
        if (!target.primary(captured)) {
          await this.withTimeout(
            page.evaluate(async () => {
              await fetch('/api/info/t4-chains-data');
            }),
            15_000,
            'Timed out waiting for the Statlocker T4 dataset request',
          );
        }
      }

      const primary = await this.waitForPrimary(
        target,
        captured,
        this.primaryWaitTimeoutMs(input.model),
        input.model,
      );

      return {
        model: input.model,
        sourcePage,
        elapsedMs: Date.now() - startedAt,
        browserMode: true,
        apiKeyProvidedByUs: false,
        captured,
        primary,
      };
    } finally {
      await this.closeBrowser(browser);
    }
  }

  private getTarget(model: StatlockerBrowserModel): BrowserTarget {
    if (model === 'ITEM_META_WPA') {
      return {
        sourcePage: (input) => {
          const hero = this.normalizeHeroName(input.hero, 'all');
          const min = this.normalizeMinSampleSize(
            input.minSampleSize,
            500,
          );
          const query = new URLSearchParams({
            hero,
            min: String(min),
          });
          return `${this.baseUrl}/items/meta-model/wpa-analysis/?${query.toString()}`;
        },
        matches: (path) => path === '/api/info/wpa-filtered-items',
        primary: (responses) =>
          [...responses]
            .reverse()
            .find(
              (entry) =>
                entry.path === '/api/info/wpa-filtered-items' &&
                entry.status === 200,
            ),
      };
    }

    if (model === 'ETERNUS_BUILD_ANALYSIS') {
      return {
        sourcePage: (input) => {
          const hero = this.normalizeHeroName(input.hero, 'Abrams');
          return `${this.baseUrl}/builds/eternus-builds/${this.toHeroSlug(hero)}`;
        },
        matches: (path) =>
          path === '/api/info/wpa-filtered-items' ||
          path.startsWith('/api/info/player-build-analysis/'),
        primary: (responses) =>
          [...responses]
            .reverse()
            .find(
              (entry) =>
                entry.path.startsWith('/api/info/player-build-analysis/') &&
                entry.status === 200,
            ) ??
          [...responses]
            .reverse()
            .find(
              (entry) =>
                entry.path === '/api/info/wpa-filtered-items' &&
                entry.status === 200,
            ),
      };
    }

    if (model === 'T4_BUILD_CHAINS') {
      return {
        sourcePage: (input) => {
          const hero = this.normalizeHeroName(input.hero, 'Abrams');
          const min = this.normalizeMinSampleSize(
            input.minSampleSize,
            500,
          );
          const query = new URLSearchParams({
            graph: 't4-chains',
            hero,
            min: String(min),
            mode: 'items-heroes',
          });
          return `${this.baseUrl}/vision/wpa?${query.toString()}`;
        },
        matches: (path) => path === '/api/info/t4-chains-data',
        primary: (responses) =>
          [...responses]
            .reverse()
            .find(
              (entry) =>
                entry.path === '/api/info/t4-chains-data' &&
                entry.status === 200,
            ),
      };
    }

    if (model === 'WIN_CHANCE') {
      return {
        sourcePage: () => `${this.baseUrl}/vision/win-chance`,
        matches: (path) =>
          /^\/api\/match\/[^/]+\/win-rate$/.test(path),
        primary: (responses) =>
          [...responses]
            .reverse()
            .find(
              (entry) =>
                /^\/api\/match\/[^/]+\/win-rate$/.test(entry.path) &&
                entry.status === 200,
            ),
      };
    }

    throw new BadRequestException('Unsupported browser model');
  }

  private async triggerWinChance(
    page: any,
    matchId: string,
  ): Promise<void> {
    const triggered = await page.evaluate((value: string) => {
      const inputs = Array.from(
        document.querySelectorAll('input'),
      ) as HTMLInputElement[];
      const input =
        inputs.find((element) =>
          /match/i.test(
            `${element.placeholder} ${element.name} ${element.id}`,
          ),
        ) ?? inputs[0];

      if (!input) {
        return false;
      }

      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      const buttons = Array.from(
        document.querySelectorAll('button'),
      ) as HTMLButtonElement[];
      const button =
        buttons.find((element) =>
          /analy|load|submit/i.test(element.textContent ?? ''),
        ) ?? buttons.find((element) => element.type === 'submit');

      if (!button) {
        return false;
      }

      button.click();
      return true;
    }, matchId);

    if (!triggered) {
      throw new BadRequestException(
        'Could not find Win Chance input/button on Statlocker page',
      );
    }
  }

  private async captureResponse(
    response: any,
    target: BrowserTarget,
    captured: StatlockerBrowserCapturedResponse[],
  ): Promise<void> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(response.url());
    } catch {
      return;
    }

    if (
      parsedUrl.hostname !== 'statlocker.gg' &&
      parsedUrl.hostname !== 'www.statlocker.gg'
    ) {
      return;
    }

    if (!target.matches(parsedUrl.pathname)) {
      return;
    }

    let data: unknown;
    try {
      const contentType = String(
        response.headers()?.['content-type'] ?? '',
      );
      data = await this.withTimeout(
        contentType.includes('application/json')
          ? response.json()
          : response.text(),
        this.responseBodyTimeoutMs,
        `Timed out reading Statlocker response body for ${parsedUrl.pathname}`,
      );
    } catch (error) {
      data = {
        error:
          error instanceof Error
            ? error.message
            : 'Response body was not readable by the browser probe',
      };
    }

    captured.push({
      url: response.url(),
      path: parsedUrl.pathname,
      status: response.status(),
      method: response.request().method(),
      data,
    });
  }

  private async waitForPrimary(
    target: BrowserTarget,
    captured: StatlockerBrowserCapturedResponse[],
    timeoutMs: number,
    model: StatlockerBrowserModel,
  ): Promise<StatlockerBrowserCapturedResponse> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const primary = target.primary(captured);
      if (primary) {
        return primary;
      }
      await this.sleep(100);
    }

    throw new BadRequestException(
      `Statlocker page loaded but no ${model} model response was captured within ${timeoutMs} ms`,
    );
  }

  private primaryWaitTimeoutMs(model: StatlockerBrowserModel): number {
    if (model === 'ETERNUS_BUILD_ANALYSIS') {
      return 35_000;
    }
    if (model === 'WIN_CHANCE') {
      return 40_000;
    }
    return 25_000;
  }

  private async closeBrowser(browser: any): Promise<void> {
    const closed = await Promise.race([
      Promise.resolve(browser.close())
        .then(() => true)
        .catch(() => true),
      this.sleep(5_000).then(() => false),
    ]);

    if (closed) {
      return;
    }

    try {
      browser.process()?.kill('SIGKILL');
    } catch {
      // Best-effort cleanup only.
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(new BadRequestException(message)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private normalizeHeroName(
    value: string | undefined,
    fallback: string,
  ): string {
    const normalized = value?.trim();
    if (!normalized) {
      return fallback;
    }
    if (normalized.length > 80) {
      throw new BadRequestException('hero is too long');
    }
    return normalized;
  }

  private normalizeMinSampleSize(
    value: number | undefined,
    fallback: number,
  ): number {
    if (value === undefined) {
      return fallback;
    }
    if (!Number.isFinite(value) || value < 1 || value > 100_000) {
      throw new BadRequestException(
        'minSampleSize must be between 1 and 100000',
      );
    }
    return Math.floor(value);
  }

  private normalizeMatchId(value: string | undefined): string {
    const normalized = value?.trim();
    if (!normalized || !/^\d{6,30}$/.test(normalized)) {
      throw new BadRequestException(
        'matchId must be a numeric Deadlock match ID',
      );
    }
    return normalized;
  }

  private toHeroSlug(hero: string): string {
    return hero
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
