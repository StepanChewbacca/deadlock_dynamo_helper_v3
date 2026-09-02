import { LiveInventoryEventNormalizerService } from '../src/deadlock-live/live-inventory-event-normalizer.service';
import { LiveMatchStateService } from '../src/deadlock-live/live-match-state.service';

describe('LiveMatchStateService local Deadlock player resolution', () => {
  it('joins game_info steam_id to a local roster row whose steam_id is empty', () => {
    const service = new LiveMatchStateService();

    service.applyBatch({
      clientId: 'test-client',
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
            player_name: 'Local',
            is_local: true,
            hero_id: 76,
            team_id: 2,
            souls: 1101,
          },
        },
      ],
    });

    expect(service.getState('42')?.playersBySteamId['76561198000000001']).toMatchObject({
      steamId: '76561198000000001',
      playerName: 'Local',
      isLocal: true,
      heroId: 76,
      teamId: 2,
      souls: 1101,
    });
  });

  it('attaches local items with an empty steam_id to the local roster slot', () => {
    const service = new LiveMatchStateService();

    service.applyBatch({
      clientId: 'test-client',
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
            player_name: 'Local',
            is_local: true,
            hero_id: 76,
            team_id: 2,
          },
        },
      ],
    });

    service.applyBatch({
      clientId: 'test-client',
      events: [
        {
          receivedAt: 4,
          source: 'onInfoUpdates2',
          feature: 'match_info',
          category: 'match_info',
          key: 'items_11',
          payload: {
            steam_id: '',
            items: [
              {
                id: 123,
                name: 'Test Item',
                class_name: 'test_item',
                enhanced: false,
              },
            ],
          },
        },
      ],
    });

    expect(service.getState('42')?.playersBySteamId['76561198000000001']?.items).toEqual([
      {
        id: 123,
        name: 'Test Item',
        className: 'test_item',
        enhanced: false,
        firstSeenAtSec: undefined,
      },
    ]);
  });

  it('attaches local items through the production normalizer when GEP suffixes differ', () => {
    const normalizer = new LiveInventoryEventNormalizerService();
    const service = new LiveMatchStateService();

    const identityBatch = {
      clientId: 'test-client',
      events: [
        {
          receivedAt: 1,
          source: 'onInfoUpdates2' as const,
          feature: 'game_info',
          category: 'game_info',
          key: 'steam_id',
          payload: '76561198000000001',
        },
        {
          receivedAt: 2,
          source: 'onInfoUpdates2' as const,
          feature: 'match_info',
          category: 'match_info',
          key: 'match_id',
          payload: '42',
        },
        {
          receivedAt: 3,
          source: 'onInfoUpdates2' as const,
          feature: 'match_info',
          category: 'match_info',
          key: 'roster_11',
          payload: {
            steam_id: '',
            player_name: 'Local Player',
            is_local: true,
            hero_id: 76,
            team_id: 2,
          },
        },
      ],
    };

    service.applyBatch(normalizer.normalizeBatch(identityBatch));

    const inventoryBatch = {
      clientId: 'test-client',
      events: [
        {
          receivedAt: 4,
          source: 'onInfoUpdates2' as const,
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
    };

    service.applyBatch(normalizer.normalizeBatch(inventoryBatch));

    expect(service.getState('42')?.playersBySteamId['76561198000000001']?.items).toEqual([
      {
        id: 3862866912,
        name: 'Restorative Shot',
        className: 'restorative_shot',
        enhanced: false,
        firstSeenAtSec: undefined,
      },
    ]);
  });

  it('does not bind blank inventory by player name when the name is ambiguous', () => {
    const normalizer = new LiveInventoryEventNormalizerService();
    const service = new LiveMatchStateService();

    const rosterBatch = {
      clientId: 'test-client',
      events: [
        {
          receivedAt: 1,
          source: 'onInfoUpdates2' as const,
          feature: 'match_info',
          category: 'match_info',
          key: 'match_id',
          payload: '42',
        },
        {
          receivedAt: 2,
          source: 'onInfoUpdates2' as const,
          feature: 'match_info',
          category: 'match_info',
          key: 'roster_1',
          payload: {
            steam_id: '111',
            player_name: 'Duplicate',
            hero_id: 1,
            team_id: 2,
          },
        },
        {
          receivedAt: 3,
          source: 'onInfoUpdates2' as const,
          feature: 'match_info',
          category: 'match_info',
          key: 'roster_2',
          payload: {
            steam_id: '222',
            player_name: 'Duplicate',
            hero_id: 2,
            team_id: 3,
          },
        },
      ],
    };

    service.applyBatch(normalizer.normalizeBatch(rosterBatch));

    const inventoryBatch = {
      clientId: 'test-client',
      events: [
        {
          receivedAt: 4,
          source: 'onInfoUpdates2' as const,
          feature: 'match_info',
          category: 'match_info',
          key: 'items_9',
          payload: {
            steam_id: '',
            player_name: 'Duplicate',
            items: [{ id: 123, name: 'Test Item', class_name: 'test_item' }],
          },
        },
      ],
    };

    service.applyBatch(normalizer.normalizeBatch(inventoryBatch));

    expect(service.getState('42')?.playersBySteamId['111']?.items).toEqual([]);
    expect(service.getState('42')?.playersBySteamId['222']?.items).toEqual([]);
  });
});
