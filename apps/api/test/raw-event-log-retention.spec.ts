import { mkdtemp, readdir, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { RawEventLogService } from '../src/deadlock-live/raw-event-log.service';

describe('RawEventLogService retention', () => {
  const originalDir = process.env.DEADLOCK_LIVE_RAW_LOG_DIR;
  const originalMaxBytes = process.env.DEADLOCK_LIVE_RAW_LOG_MAX_BYTES;
  const originalMaxFiles = process.env.DEADLOCK_LIVE_RAW_LOG_MAX_FILES;
  const originalPruneInterval = process.env.DEADLOCK_LIVE_RAW_LOG_PRUNE_INTERVAL_MS;
  let outputDir = '';

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'deadlock-live-log-'));
    process.env.DEADLOCK_LIVE_RAW_LOG_DIR = outputDir;
    process.env.DEADLOCK_LIVE_RAW_LOG_MAX_BYTES = '220';
    process.env.DEADLOCK_LIVE_RAW_LOG_MAX_FILES = '2';
    process.env.DEADLOCK_LIVE_RAW_LOG_PRUNE_INTERVAL_MS = '0';
  });

  afterEach(async () => {
    restoreEnv('DEADLOCK_LIVE_RAW_LOG_DIR', originalDir);
    restoreEnv('DEADLOCK_LIVE_RAW_LOG_MAX_BYTES', originalMaxBytes);
    restoreEnv('DEADLOCK_LIVE_RAW_LOG_MAX_FILES', originalMaxFiles);
    restoreEnv('DEADLOCK_LIVE_RAW_LOG_PRUNE_INTERVAL_MS', originalPruneInterval);
    await rm(outputDir, { recursive: true, force: true });
  });

  it('caps each match log and prunes old match files', async () => {
    const service = new RawEventLogService();

    for (let index = 0; index < 6; index += 1) {
      await service.appendEvents([
        {
          receivedAt: index,
          source: 'onInfoUpdates2',
          matchId: 'match-a',
          key: 'items_1',
          payload: { value: 'x'.repeat(50), index },
        },
      ]);
    }

    const matchAStat = await stat(join(outputDir, 'match-a.ndjson'));
    expect(matchAStat.size).toBeLessThanOrEqual(220);

    for (const matchId of ['match-b', 'match-c', 'match-d']) {
      await service.appendEvents([
        {
          receivedAt: Date.now(),
          source: 'onInfoUpdates2',
          matchId,
          key: 'match_clock',
          payload: '01:00',
        },
      ]);
    }

    const files = (await readdir(outputDir)).filter((name) => name.endsWith('.ndjson'));
    expect(files.length).toBeLessThanOrEqual(2);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
