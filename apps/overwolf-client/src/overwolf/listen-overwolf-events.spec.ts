jest.mock('../diagnostics/diagnostic-capture', () => ({
  DiagnosticCapture: class {
    initialize(): void {}
    captureRaw(): void {}
  },
}));

import { listenOverwolfEvents } from './listen-overwolf-events';

describe('listenOverwolfEvents', () => {
  afterEach(() => {
    delete (globalThis as any).overwolf;
  });

  it('attaches the match id restored from getInfo to subsequent events', () => {
    const infoListeners: Array<(value: any) => void> = [];
    const newEventListeners: Array<(value: any) => void> = [];
    const emitted: any[] = [];

    (globalThis as any).overwolf = {
      games: {
        events: {
          getInfo: (callback: (value: unknown) => void) =>
            callback({ success: true, res: { match_info: { match_id: '103061897' } } }),
          onInfoUpdates2: {
            addListener: (listener: (value: any) => void) => infoListeners.push(listener),
          },
          onNewEvents: {
            addListener: (listener: (value: any) => void) => newEventListeners.push(listener),
          },
        },
      },
    };

    listenOverwolfEvents((event) => emitted.push(event));

    infoListeners[0]({
      feature: 'match_info',
      info: {
        match_info: {
          roster_0: '{"steam_id":"76561198066539144","hero_id":62}',
        },
      },
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].matchId).toBe('103061897');
  });
});
