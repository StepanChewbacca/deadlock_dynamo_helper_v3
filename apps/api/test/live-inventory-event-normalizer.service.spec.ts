import { LiveInventoryEventNormalizerService } from '../src/deadlock-live/live-inventory-event-normalizer.service';

describe('LiveInventoryEventNormalizerService', () => {
  it('keeps a partial item and recovers its player from the roster slot', () => {
    const service = new LiveInventoryEventNormalizerService();

    service.normalizeBatch({
      clientId: 'client-1',
      events: [
        {
          receivedAt: 1,
          source: 'onInfoUpdates2',
          key: 'roster_0',
          payload: { steam_id: 's1' },
        },
        {
          receivedAt: 2,
          source: 'onInfoUpdates2',
          key: 'items_0',
          payload: {
            steam_id: 's1',
            items: [
              {
                id: 100,
                name: 'Extra Charge',
                class_name: 'extra_charge',
                enhanced: false,
              },
            ],
          },
        },
      ],
    });

    const normalized = service.normalizeBatch({
      clientId: 'client-1',
      events: [
        {
          receivedAt: 3,
          source: 'onInfoUpdates2',
          key: 'items_0',
          payload: {
            items: [{ id: '100' }, { item_id: 200 }],
          },
        },
      ],
    });

    expect(normalized.events[0].payload).toEqual({
      steam_id: 's1',
      items: [
        {
          id: 100,
          name: 'Extra Charge',
          class_name: 'extra_charge',
          enhanced: false,
        },
        {
          item_id: 200,
          id: 200,
          name: 'Item 200',
          class_name: 'item_200',
          enhanced: false,
        },
      ],
    });
  });

  it('binds a blank local inventory payload by player name when GEP suffixes differ', () => {
    const service = new LiveInventoryEventNormalizerService();

    service.normalizeBatch({
      clientId: 'client-1',
      events: [
        {
          receivedAt: 1,
          source: 'onInfoUpdates2',
          feature: 'game_info',
          category: 'game_info',
          key: 'steam_id',
          payload: '76561198000000001',
        },
        {
          receivedAt: 2,
          source: 'onInfoUpdates2',
          feature: 'match_info',
          category: 'match_info',
          key: 'match_id',
          payload: '42',
        },
        {
          receivedAt: 3,
          source: 'onInfoUpdates2',
          feature: 'match_info',
          category: 'match_info',
          key: 'roster_11',
          payload: {
            steam_id: '',
            player_name: 'Local Player',
            is_local: true,
          },
        },
      ],
    });

    const normalized = service.normalizeBatch({
      clientId: 'client-1',
      events: [
        {
          receivedAt: 4,
          source: 'onInfoUpdates2',
          feature: 'match_info',
          category: 'match_info',
          key: 'items_3',
          payload: {
            steam_id: '',
            player_name: 'Local Player',
            items: [
              {
                id: -432100384,
                name: 'Restorative Shot',
                class_name: 'restorative_shot',
                enhanced: false,
              },
            ],
          },
        },
      ],
    });

    expect(normalized.events[0].payload).toMatchObject({
      steam_id: '76561198000000001',
      player_name: 'Local Player',
      items: [
        expect.objectContaining({
          id: 3862866912,
          name: 'Restorative Shot',
        }),
      ],
    });
  });

  it('does not modify non-inventory events', () => {
    const service = new LiveInventoryEventNormalizerService();
    const event = {
      receivedAt: 1,
      source: 'onInfoUpdates2' as const,
      key: 'roster_0',
      payload: { steam_id: 's1' },
    };

    const normalized = service.normalizeBatch({
      clientId: 'client-1',
      events: [event],
    });

    expect(normalized.events[0]).toBe(event);
  });
});
