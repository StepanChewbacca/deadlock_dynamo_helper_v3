jest.mock('../diagnostics/diagnostic-capture', () => ({
  DiagnosticCapture: class {
    initialize(): void {}
    captureRaw(): void {}
  },
}));

import { listenOverwolfEvents } from './listen-overwolf-events';

describe('listenOverwolfEvents', () => {
  it('reconciles the full live state with the restored match id immediately and every three seconds', () => {
    jest.useFakeTimers();
    const onEvent = jest.fn();
    const getInfo = jest.fn((callback: (result: unknown) => void) => {
      callback({
        success: true,
        res: {
          match_info: {
            match_id: '93946399',
          },
          roster: {
            roster_12: JSON.stringify({
              steam_id: '76561198000000001',
              hero_id: 15,
              team_id: 2,
            }),
          },
          items: {
            items_12: JSON.stringify({
              steam_id: '76561198000000001',
              items: [
                {
                  id: 100,
                  name: 'Extra Regen',
                  class_name: 'extra_regen',
                },
              ],
            }),
          },
          unsupported: {
            ignored: 'value',
          },
        },
      });
    });

    (globalThis as any).overwolf = {
      games: {
        events: {
          onInfoUpdates2: { addListener: jest.fn() },
          onNewEvents: { addListener: jest.fn() },
          getInfo,
        },
      },
    };

    listenOverwolfEvents(onEvent);

    expect(getInfo).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(onEvent.mock.calls.map(([event]) => event.category)).toEqual([
      'match_info',
      'roster',
      'items',
    ]);
    expect(onEvent).toHaveBeenCalledWith({
      matchId: '93946399',
      receivedAt: expect.any(Number),
      source: 'onInfoUpdates2',
      feature: 'state_safety_poll',
      category: 'roster',
      key: 'roster_12',
      payload: {
        steam_id: '76561198000000001',
        hero_id: 15,
        team_id: 2,
      },
    });
    expect(onEvent.mock.calls.every(([event]) => event.matchId === '93946399')).toBe(true);

    jest.advanceTimersByTime(3_000);

    expect(getInfo).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenCalledTimes(6);

    jest.clearAllTimers();
    jest.useRealTimers();
    delete (globalThis as any).overwolf;
  });

  it('does not replay match_outcome from the periodic state snapshot', () => {
    jest.useFakeTimers();
    const onEvent = jest.fn();
    const getInfo = jest.fn((callback: (result: unknown) => void) => {
      callback({
        success: true,
        res: {
          match_info: {
            match_id: '93946399',
            match_outcome: JSON.stringify({ winning_team: 'SAPPHIRE' }),
          },
        },
      });
    });

    (globalThis as any).overwolf = {
      games: {
        events: {
          onInfoUpdates2: { addListener: jest.fn() },
          onNewEvents: { addListener: jest.fn() },
          getInfo,
        },
      },
    };

    listenOverwolfEvents(onEvent);

    expect(onEvent.mock.calls.map(([event]) => event.key)).toEqual(['match_id']);

    jest.clearAllTimers();
    jest.useRealTimers();
    delete (globalThis as any).overwolf;
  });
});
