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
});
