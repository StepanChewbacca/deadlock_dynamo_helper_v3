import { LiveMatchStateService } from '../src/deadlock-live/live-match-state.service';

describe('LiveMatchStateService canonical GEP v2 integration', () => {
  it('accepts canonical compatibility aliases through the live ingestion path', () => {
    const service = new LiveMatchStateService();
    const state = service.applyBatch({
      clientId: 'canonical-v2-client',
      events: [
        {
          receivedAt: 1,
          source: 'onInfoUpdates2',
          key: 'match_id',
          payload: 'canonical-v2-match',
        },
        {
          receivedAt: 2,
          source: 'onInfoUpdates2',
          key: 'roster_1',
          payload: {
            steamId: '76561198000000123',
            playerName: 'Local',
            isLocal: '1',
            heroId: '35',
            heroName: 'Hero',
            teamId: '2',
            laneId: '6',
            level: '9',
            soulsRaw: '5700',
            health: '1200',
            maxHealth: '1600',
            kills: '3',
            deaths: '1',
            assists: '4',
            heroDamage: '12000',
            objectDamage: '2500',
            heroHealing: '800',
          },
        },
        {
          receivedAt: 3,
          source: 'onInfoUpdates2',
          key: 'items_1',
          payload: {
            steamId: '76561198000000123',
            items: [
              {
                id: 101,
                name: 'Fixture Item',
                class_name: 'fixture_item',
                enhanced: false,
              },
            ],
          },
        },
      ],
    });

    expect(state?.playersBySteamId['76561198000000123']).toMatchObject({
      steamId: '76561198000000123',
      playerName: 'Local',
      isLocal: true,
      heroId: 35,
      heroName: 'Hero',
      teamId: 2,
      lane: 6,
      level: 9,
      souls: 5700,
      health: 1200,
      maxHealth: 1600,
      kills: 3,
      deaths: 1,
      assists: 4,
      heroDamage: 12000,
      objectDamage: 2500,
      healing: 800,
      items: [{ id: 101, name: 'Fixture Item', className: 'fixture_item' }],
    });
  });
});
