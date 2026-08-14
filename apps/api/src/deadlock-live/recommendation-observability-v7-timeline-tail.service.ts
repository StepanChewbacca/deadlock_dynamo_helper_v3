import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { extractRecommendationObservabilityV7FromTimelinePayload } from './recommendation-observability-v7-raw-extractor';
import type { RecommendationObservabilityV7RawTimelinePayload } from './recommendation-observability-v7-raw-extractor';
import { RecommendationObservabilityV7TelemetryStore } from './recommendation-observability-v7-telemetry';

const DEFAULT_TIMELINE_ROOT = '/app/apps/api/storage/match-timeline-events-v1';
const DEFAULT_OBSERVABILITY_ROOT =
  '/app/apps/api/storage/recommendation-observability-v7';
const CURSOR_FILE = 'timeline-cursors.json';
const SAFE_TAIL_SCAN_CHUNK_BYTES = 64 * 1024;

interface TimelineCursorState {
  schemaVersion: 1;
  updatedAt: string;
  cursors: Record<string, number>;
}

interface TimelineRawEvent {
  eventId?: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class RecommendationObservabilityV7TimelineTailService
  implements OnModuleInit
{
  private readonly logger = new Logger(
    RecommendationObservabilityV7TimelineTailService.name,
  );
  private readonly timelineRoot =
    process.env.DEADLOCK_TIMELINE_STORAGE_DIR?.trim() || DEFAULT_TIMELINE_ROOT;
  private readonly observabilityRoot =
    process.env.DEADLOCK_RECOMMENDATION_OBSERVABILITY_V7_DIR?.trim() ||
    DEFAULT_OBSERVABILITY_ROOT;
  private readonly cursorPath = join(this.observabilityRoot, CURSOR_FILE);
  private readonly enabled =
    process.env.DEADLOCK_RECOMMENDATION_OBSERVABILITY_V7_ENABLED?.trim().toLowerCase() !==
    'false';
  private readonly backfillExisting =
    process.env.DEADLOCK_RECOMMENDATION_OBSERVABILITY_V7_BACKFILL_EXISTING
      ?.trim()
      .toLowerCase() === 'true';
  private readonly cursors = new Map<string, number>();
  private running = false;

  constructor(
    private readonly telemetryStore: RecommendationObservabilityV7TelemetryStore,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Behavioral V7 observability telemetry collection is disabled.');
      return;
    }
    await mkdir(this.observabilityRoot, { recursive: true });
    await this.loadCursors();
    await this.initializeExistingFiles();
    void this.scan().catch((error) => {
      this.logger.warn(`Initial V7 observability scan failed: ${errorMessage(error)}`);
    });
  }

  @Cron('45 * * * * *', {
    name: 'recommendation-observability-v7-timeline-tail',
  })
  async scheduledScan(): Promise<void> {
    if (this.enabled) {
      await this.scan();
    }
  }

  private async scan(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const files = await this.listTimelineFiles();
      let accepted = 0;
      let cursorChanged = false;

      for (const file of files) {
        const metadata = await stat(file.path);
        const previousOffset = this.cursors.get(file.path);
        if (previousOffset === undefined) {
          const initialOffset = this.backfillExisting
            ? 0
            : await findCompleteEndExclusive(file.path, 0, metadata.size);
          this.cursors.set(file.path, initialOffset);
          cursorChanged = true;
          if (!this.backfillExisting) continue;
        }

        let start = this.cursors.get(file.path) ?? 0;
        if (metadata.size < start) {
          start = this.backfillExisting
            ? 0
            : await findCompleteEndExclusive(file.path, 0, metadata.size);
          this.cursors.set(file.path, start);
          cursorChanged = true;
        }
        if (metadata.size <= start) continue;

        const completeEndExclusive = await findCompleteEndExclusive(
          file.path,
          start,
          metadata.size,
        );
        if (completeEndExclusive <= start) continue;

        accepted += await this.consumeFile(
          file.matchId,
          file.path,
          start,
          completeEndExclusive - 1,
        );
        this.cursors.set(file.path, completeEndExclusive);
        cursorChanged = true;
      }

      await this.telemetryStore.waitForIdle();
      if (cursorChanged) await this.persistCursors();
      if (accepted > 0) {
        this.logger.log(
          `Persisted ${accepted} direct Behavioral V7 observability events.`,
        );
      }
    } finally {
      this.running = false;
    }
  }

  private async initializeExistingFiles(): Promise<void> {
    let changed = false;
    for (const file of await this.listTimelineFiles()) {
      if (this.cursors.has(file.path)) continue;
      const metadata = await stat(file.path);
      const initialOffset = this.backfillExisting
        ? 0
        : await findCompleteEndExclusive(file.path, 0, metadata.size);
      this.cursors.set(file.path, initialOffset);
      changed = true;
    }
    if (changed) await this.persistCursors();
  }

  private async consumeFile(
    matchId: string,
    path: string,
    start: number,
    end: number,
  ): Promise<number> {
    let accepted = 0;
    const lines = createInterface({
      input: createReadStream(path, { encoding: 'utf8', start, end }),
      crlfDelay: Infinity,
    });

    for await (const line of lines) {
      if (!line.trim()) continue;
      let event: TimelineRawEvent;
      try {
        event = JSON.parse(line) as TimelineRawEvent;
      } catch {
        continue;
      }
      if (!isRecord(event.payload)) continue;
      const snapshot = extractRecommendationObservabilityV7FromTimelinePayload(
        matchId,
        event.payload as RecommendationObservabilityV7RawTimelinePayload,
      );
      if (!snapshot) continue;
      this.telemetryStore.record({
        ...snapshot,
        ...(typeof event.eventId === 'string' && event.eventId.trim()
          ? { sourceEventId: event.eventId.trim() }
          : {}),
      });
      accepted += 1;
    }
    return accepted;
  }

  private async listTimelineFiles(): Promise<
    Array<{ matchId: string; path: string }>
  > {
    let entries;
    try {
      entries = await readdir(this.timelineRoot, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }

    const files: Array<{ matchId: string; path: string }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(this.timelineRoot, entry.name, 'events.ndjson');
      try {
        const metadata = await stat(path);
        if (metadata.isFile()) files.push({ matchId: entry.name, path });
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
      }
    }
    return files.sort((left, right) =>
      left.matchId.localeCompare(right.matchId, undefined, { numeric: true }),
    );
  }

  private async loadCursors(): Promise<void> {
    try {
      const state = JSON.parse(
        await readFile(this.cursorPath, 'utf8'),
      ) as TimelineCursorState;
      if (state?.schemaVersion !== 1 || !isRecord(state.cursors)) return;
      for (const [path, value] of Object.entries(state.cursors)) {
        if (Number.isSafeInteger(value) && value >= 0) {
          this.cursors.set(path, value);
        }
      }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        this.logger.warn(
          `Ignored invalid V7 observability cursor state: ${errorMessage(error)}`,
        );
      }
    }
  }

  private async persistCursors(): Promise<void> {
    const partial = `${this.cursorPath}.partial`;
    const state: TimelineCursorState = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      cursors: Object.fromEntries(
        [...this.cursors.entries()].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    };
    await writeFile(partial, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(partial, this.cursorPath);
  }
}

export async function findRecommendationObservabilityV7CompleteEndExclusive(
  path: string,
  start: number,
  fileSize: number,
): Promise<number> {
  return findCompleteEndExclusive(path, start, fileSize);
}

async function findCompleteEndExclusive(
  path: string,
  start: number,
  fileSize: number,
): Promise<number> {
  if (fileSize <= start) return start;
  const handle = await open(path, 'r');
  try {
    let cursor = fileSize;
    while (cursor > start) {
      const chunkStart = Math.max(
        start,
        cursor - SAFE_TAIL_SCAN_CHUNK_BYTES,
      );
      const length = cursor - chunkStart;
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        length,
        chunkStart,
      );
      for (let index = bytesRead - 1; index >= 0; index -= 1) {
        if (buffer[index] === 0x0a) {
          return chunkStart + index + 1;
        }
      }
      cursor = chunkStart;
    }
    return start;
  } finally {
    await handle.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
