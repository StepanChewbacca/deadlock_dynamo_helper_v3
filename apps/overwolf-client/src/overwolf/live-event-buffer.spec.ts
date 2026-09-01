import { LiveEventBuffer } from './live-event-buffer';

describe('LiveEventBuffer', () => {
  it('flushes a batch to the api', async () => {
    const calls: unknown[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return { ok: true } as Response;
    };

    const buffer = new LiveEventBuffer('client-1', 'http://localhost:3000', fetchImpl, 10);
    buffer.push({ receivedAt: 1, source: 'onInfoUpdates2', payload: { ok: true } });

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(calls).toEqual([
      {
        clientId: 'client-1',
        events: [{ receivedAt: 1, source: 'onInfoUpdates2', payload: { ok: true } }],
      },
    ]);
  });

  it('flushes inventory events without waiting for the normal batch delay', async () => {
    const calls: any[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return { ok: true } as Response;
    };

    const buffer = new LiveEventBuffer(
      'client-1',
      'http://localhost:3000',
      fetchImpl,
      1000,
      () => 'match-1',
    );
    buffer.push({
      receivedAt: 1,
      source: 'onInfoUpdates2',
      key: 'match_clock',
      payload: '01:00',
    });
    buffer.push({
      receivedAt: 2,
      source: 'onInfoUpdates2',
      key: 'items_12',
      payload: {
        steam_id: '76561198000000001',
        items: [{ id: 100, name: 'Extra Regen', class_name: 'extra_regen' }],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toHaveLength(1);
    expect(calls[0].events).toEqual([
      expect.objectContaining({ key: 'match_clock', matchId: 'match-1' }),
      expect.objectContaining({ key: 'items_12', matchId: 'match-1' }),
    ]);
  });

  it('flushes a full state recovery event immediately', async () => {
    const calls: any[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return { ok: true } as Response;
    };

    const buffer = new LiveEventBuffer(
      'client-1',
      'http://localhost:3000',
      fetchImpl,
      1000,
      () => 'match-1',
    );
    buffer.push({
      receivedAt: 1,
      source: 'onInfoUpdates2',
      feature: 'state_safety_poll',
      category: 'roster',
      key: 'roster_12',
      payload: { steam_id: '76561198000000001', hero_id: 15, team_id: 2 },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toHaveLength(1);
    expect(calls[0].events[0]).toEqual(
      expect.objectContaining({
        feature: 'state_safety_poll',
        category: 'roster',
        key: 'roster_12',
        matchId: 'match-1',
      }),
    );
  });

  it('attaches the restored match id to events that do not contain one', async () => {
    const calls: any[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return { ok: true } as Response;
    };

    const buffer = new LiveEventBuffer(
      'client-1',
      'http://localhost:3000',
      fetchImpl,
      10,
      () => '93405163',
    );
    buffer.push({ receivedAt: 1, source: 'onInfoUpdates2', payload: { ok: true } });

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(calls[0].events[0]).toEqual({
      matchId: '93405163',
      receivedAt: 1,
      source: 'onInfoUpdates2',
      payload: { ok: true },
    });
  });

  it('preserves an explicit event match id', async () => {
    const calls: any[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return { ok: true } as Response;
    };

    const buffer = new LiveEventBuffer(
      'client-1',
      'http://localhost:3000',
      fetchImpl,
      10,
      () => 'restored-match',
    );
    buffer.push({
      matchId: 'explicit-match',
      receivedAt: 1,
      source: 'onInfoUpdates2',
      payload: { ok: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(calls[0].events[0].matchId).toBe('explicit-match');
  });

  it('retries the same event batch after a transient HTTP failure', async () => {
    const calls: any[] = [];
    let attempt = 0;
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit): Promise<Response> => {
      attempt += 1;
      calls.push(JSON.parse(String(init?.body)));
      return attempt === 1
        ? ({ ok: false, status: 502 } as Response)
        : ({ ok: true, status: 201 } as Response);
    });
    const buffer = new LiveEventBuffer(
      'client-1',
      'http://localhost:3000',
      fetchImpl,
      5,
      () => 'match-1',
    );

    buffer.push({ receivedAt: 1, source: 'onInfoUpdates2', key: 'match_clock', payload: '01:00' });
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(calls[1]).toEqual(calls[0]);
  });

  it('keeps failed and later event batches separate and never overlaps requests', async () => {
    jest.useFakeTimers();
    try {
      const calls: any[] = [];
      let resolveFirst: ((response: Response) => void) | undefined;
      let resolveSecond: ((response: Response) => void) | undefined;
      const fetchImpl = jest.fn((_url: string, init?: RequestInit): Promise<Response> => {
        calls.push(JSON.parse(String(init?.body)));
        if (calls.length === 1) {
          return new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          });
        }
        if (calls.length === 2) {
          return new Promise<Response>((resolve) => {
            resolveSecond = resolve;
          });
        }
        return Promise.resolve({ ok: true, status: 201 } as Response);
      });
      const buffer = new LiveEventBuffer(
        'client-1',
        'http://localhost:3000',
        fetchImpl,
        10,
        () => 'match-1',
      );

      buffer.push({ receivedAt: 1, source: 'onInfoUpdates2', key: 'match_clock', payload: '01:00' });
      jest.advanceTimersByTime(10);
      await Promise.resolve();
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      buffer.push({ receivedAt: 2, source: 'onInfoUpdates2', key: 'match_clock', payload: '01:01' });
      jest.advanceTimersByTime(10);
      await Promise.resolve();
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      resolveFirst?.({ ok: false, status: 502 } as Response);
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(10);
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(calls[1].events).toEqual([expect.objectContaining({ receivedAt: 1 })]);

      buffer.push({ receivedAt: 3, source: 'onInfoUpdates2', key: 'match_clock', payload: '01:02' });
      resolveSecond?.({ ok: true, status: 201 } as Response);
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(calls[2].events).toEqual([expect.objectContaining({ receivedAt: 2 })]);

      if (fetchImpl.mock.calls.length < 4) {
        jest.advanceTimersByTime(0);
        await Promise.resolve();
        await Promise.resolve();
      }
      expect(fetchImpl).toHaveBeenCalledTimes(4);
      expect(calls[3].events).toEqual([expect.objectContaining({ receivedAt: 3 })]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not resend an accepted inventory batch when its callback throws', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 201 } as Response));
    const callback = jest.fn(() => {
      throw new Error('callback failed');
    });
    const buffer = new LiveEventBuffer(
      'client-1',
      'http://localhost:3000',
      fetchImpl,
      5,
      () => 'match-1',
      callback,
    );

    buffer.push({ receivedAt: 1, source: 'onInfoUpdates2', key: 'items_1', payload: { items: [] } });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(callback).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
