import { LiveEventBuffer } from './live-event-buffer';

describe('LiveEventBuffer inventory refresh', () => {
  it('refreshes the build only after the inventory batch is accepted', async () => {
    const response = deferred<Response>();
    const onInventoryFlushSuccess = jest.fn();
    const fetchImpl = jest.fn(() => response.promise);
    const buffer = new LiveEventBuffer(
      'client-1',
      'http://localhost:3000',
      fetchImpl,
      1000,
      () => 'match-1',
      onInventoryFlushSuccess,
    );

    buffer.push({
      receivedAt: 1,
      source: 'onInfoUpdates2',
      key: 'items_0',
      payload: {
        steam_id: 'local',
        items: [{ id: 100 }],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onInventoryFlushSuccess).not.toHaveBeenCalled();

    response.resolve({ ok: true } as Response);
    await Promise.resolve();
    await Promise.resolve();

    expect(onInventoryFlushSuccess).toHaveBeenCalledTimes(1);
    expect(onInventoryFlushSuccess).toHaveBeenCalledWith({
      clientId: 'client-1',
      events: [
        expect.objectContaining({
          matchId: 'match-1',
          key: 'items_0',
        }),
      ],
    });
  });

  it('does not refresh after a rejected inventory batch', async () => {
    jest.useFakeTimers();
    try {
      const onInventoryFlushSuccess = jest.fn();
      const fetchImpl = jest.fn(async () => ({ ok: false, status: 500 } as Response));
      const buffer = new LiveEventBuffer(
        'client-1',
        'http://localhost:3000',
        fetchImpl,
        1000,
        () => 'match-1',
        onInventoryFlushSuccess,
      );

      buffer.push({
        receivedAt: 1,
        source: 'onInfoUpdates2',
        key: 'items_0',
        payload: { steam_id: 'local', items: [{ id: 100 }] },
      });

      jest.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(onInventoryFlushSuccess).not.toHaveBeenCalled();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
