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

  it('attaches the restored current match id to outgoing events', async () => {
    const calls: any[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return { ok: true } as Response;
    };

    let currentMatchId = '103061897';
    const buffer = new LiveEventBuffer(
      'client-1',
      'http://localhost:3000',
      fetchImpl,
      10,
      () => currentMatchId,
    );

    buffer.push({
      receivedAt: 1,
      source: 'onInfoUpdates2',
      category: 'match_info',
      key: 'roster_0',
      payload: { steam_id: '76561198066539144', hero_id: 62 },
    });

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(calls[0].events[0].matchId).toBe('103061897');

    currentMatchId = '103061898';
    buffer.push({
      receivedAt: 2,
      source: 'onInfoUpdates2',
      category: 'match_info',
      key: 'roster_1',
      payload: { steam_id: 'bot:roster_0', hero_id: 15 },
    });

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(calls[1].events[0].matchId).toBe('103061898');
  });
});
