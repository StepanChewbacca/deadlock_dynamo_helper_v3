import { LiveInventoryEventNormalizerService } from '../src/deadlock-live/live-inventory-event-normalizer.service';

describe('LiveInventoryEventNormalizerService signed item ids', () => {
  it('canonicalizes signed int32 item ids to uint32 ids', () => {
    const service = new LiveInventoryEventNormalizerService();

    const normalized = service.normalizeBatch({
      clientId: 'client-1',
      events: [
        {
          receivedAt: 1,
          source: 'onInfoUpdates2',
          key: 'items_12',
          payload: {
            steam_id: '76561198000000001',
            items: [{ id: -432100384 }],
          },
        },
      ],
    });

    expect(normalized.events[0].payload).toEqual({
      steam_id: '76561198000000001',
      items: [
        expect.objectContaining({
          id: 3862866912,
        }),
      ],
    });
  });
});
