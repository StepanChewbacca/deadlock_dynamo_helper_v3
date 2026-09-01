import { canonicalizeLiveBatchForStateV2 } from '../src/deadlock-live/canonical-live-batch';

describe('canonical live batch v2', () => {
  it('maps official roster aliases onto the state reducer contract', () => {
    const result = canonicalizeLiveBatchForStateV2({
      clientId: 'client-1',
      events: [{
        receivedAt: 1000,
        source: 'onInfoUpdates2',
        key: 'roster_0',
        payload: {
          steamId: '123',
          playerName: 'Player',
          heroId: 7,
          team_id: 2,
          assigned_lane: 4,
          soulsRaw: 3510,
          assist: 5,
          heroHealing: 99,
        },
      }],
    });

    expect(result.events[0].payload).toEqual({
      steam_id: '123',
      player_name: 'Player',
      hero_id: 7,
      team: 2,
      lane: 4,
      souls: 3510,
      assists: 5,
      healing: 99,
    });
  });

  it('does not mutate non-roster events', () => {
    const event = {
      receivedAt: 1000,
      source: 'onNewEvents' as const,
      key: 'items_0',
      payload: { steam_id: '123', items: [] },
    };
    const result = canonicalizeLiveBatchForStateV2({ clientId: 'client-1', events: [event] });
    expect(result.events[0]).toBe(event);
  });
});
