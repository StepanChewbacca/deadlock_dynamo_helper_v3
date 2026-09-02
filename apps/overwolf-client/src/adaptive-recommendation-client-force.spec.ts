import { AdaptiveRecommendationClient } from './adaptive-recommendation-client';

const readyResult = {
  ready: true,
  blockers: [],
} as any;

function response() {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(readyResult),
  } as any;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('AdaptiveRecommendationClient forced scheduling', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does not postpone an already pending identical forced request', async () => {
    const fetcher = jest.fn().mockResolvedValue(response());
    const client = new AdaptiveRecommendationClient('https://api.example', fetcher, 1500);
    const request = { matchId: 'match-a', localSteamId: 'steam-a' };
    const handlers = { onResult: jest.fn() };

    client.schedule(request, handlers, true);
    jest.advanceTimersByTime(1000);

    client.schedule(request, handlers, true);
    jest.advanceTimersByTime(500);
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('queues one forced refresh when live state changes during an identical in-flight request', async () => {
    let resolveFirst: ((value: Response) => void) | undefined;
    const fetcher = jest.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValue(response());
    const client = new AdaptiveRecommendationClient('https://api.example', fetcher, 100);
    const request = { matchId: 'match-a', localSteamId: 'steam-a' };
    const handlers = { onResult: jest.fn() };

    client.schedule(request, handlers, true);
    jest.advanceTimersByTime(100);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    client.schedule(request, handlers, true);
    client.schedule(request, handlers, true);
    jest.advanceTimersByTime(100);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveFirst?.(response());
    await flush();
    jest.runOnlyPendingTimers();
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
