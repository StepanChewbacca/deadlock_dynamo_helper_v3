import { buildRecommendationObservabilityV7PlayerIdentityRow } from '../src/deadlock-live/recommendation-observability-v7-player-identity-export.service';
import { extractRecommendationObservabilityV7FromTimelinePayload } from '../src/deadlock-live/recommendation-observability-v7-raw-extractor';

describe('Recommendation Observability V7 direct contracts', () => {
  it('accepts direct player-controller currency without using net worth', () => {
    const snapshot = extractRecommendationObservabilityV7FromTimelinePayload(
      '123',
      {
        entity_type: 'player_controller',
        steam_id: 4294967295,
        hero_id: 7,
        game_time: 321,
        current_souls: 1750,
      },
    );

    expect(snapshot).toMatchObject({
      matchId: '123',
      steamId: '4294967295',
      heroId: 7,
      gameTimeS: 321,
      spendableSouls: 1750,
      source: 'SERVER_STATE_DIRECT',
    });
  });

  it('does not treat net worth as spendable currency', () => {
    const snapshot = extractRecommendationObservabilityV7FromTimelinePayload(
      '123',
      {
        entity_type: 'player_controller',
        steam_id: 42,
        hero_id: 7,
        game_time: 321,
        net_worth: 25000,
      } as never,
    );

    expect(snapshot).toBeUndefined();
  });

  it('rejects player-pawn observations even with otherwise usable values', () => {
    const snapshot = extractRecommendationObservabilityV7FromTimelinePayload(
      '123',
      {
        entity_type: 'player_pawn',
        steam_id: 42,
        hero_id: 7,
        game_time: 321,
        current_souls: 1750,
      },
    );

    expect(snapshot).toBeUndefined();
  });

  it('exports the persisted u32 account identity without conversion', () => {
    const row = buildRecommendationObservabilityV7PlayerIdentityRow({
      id: 991,
      matchId: 123,
      accountId: 4294967295,
    });

    expect(row).toEqual({
      schemaVersion: 1,
      identityVersion:
        'RECOMMENDATION_OBSERVABILITY_V7_DATASET_PLAYER_IDENTITY_1',
      matchId: '123',
      datasetPlayerId: '991',
      accountId: '4294967295',
      steamId: '4294967295',
      source: 'DIRECT_PERSISTED_IDENTITY',
      sourceField: 'match_players.accountId',
      identityDomain: 'STEAM_ACCOUNT_ID_U32',
    });
  });

  it('rejects account identities outside the u32 domain', () => {
    expect(
      buildRecommendationObservabilityV7PlayerIdentityRow({
        id: 991,
        matchId: 123,
        accountId: 4294967296,
      }),
    ).toBeUndefined();
  });
});
