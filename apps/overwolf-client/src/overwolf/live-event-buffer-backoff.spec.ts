import { LiveEventBuffer } from './live-event-buffer';

describe('LiveEventBuffer retry backoff', () => {
  it('backs off repeated failures and does not let immediate events bypass the retry delay', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn(async () => ({ ok: false, status: 500 } as Response));
      const buffer = new LiveEventBuffer(
        'client-1',
        'http://localhost:3000',
        fetchImpl,
        100,
        () => 'match-1',
      );

      buffer.push({
        receivedAt: 1,
        source: 'onInfoUpdates2',
        key: 'match_clock',
        payload: '01:00',
      });

      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchImpl).toHaveBeenCalledTimes(2);

      buffer.push({
        receivedAt: 2,
        source: 'onInfoUpdates2',
        key: 'items_12',
        payload: { items: [] },
      });
      jest.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchImpl).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(199);
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchImpl).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });
});
