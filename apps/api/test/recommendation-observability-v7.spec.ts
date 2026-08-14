import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRecommendationObservabilityV7DirectIdentityIndex } from '../src/deadlock-live/recommendation-observability-v7-direct-identity';
import { buildRecommendationObservabilityV7PlayerIdentityRow } from '../src/deadlock-live/recommendation-observability-v7-player-identity-export.service';
import { extractRecommendationObservabilityV7FromTimelinePayload } from '../src/deadlock-live/recommendation-observability-v7-raw-extractor';
import { findRecommendationObservabilityV7CompleteEndExclusive } from '../src/deadlock-live/recommendation-observability-v7-timeline-tail.service';

describe('Recommendation Observability V7 direct contracts', () => {
  it('accepts only explicitly spendable player-controller currency', () => {
    const snapshot = extractRecommendationObservabilityV7FromTimelinePayload(
      '123',
      {
        entity_type: 'player_controller',
        steam_id: 4294967295,
        hero_id: 7,
        game_time: 321,
        spendable_souls: 1750,
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

  it('does not treat current souls or net worth as spendable currency', () => {
    for (const payload of [
      {
        entity_type: 'player_controller',
        steam_id: 42,
        hero_id: 7,
        game_time: 321,
        current_souls: 1750,
      },
      {
        entity_type: 'player_controller',
        steam_id: 42,
        hero_id: 7,
        game_time: 321,
        net_worth: 25000,
      },
    ]) {
      expect(
        extractRecommendationObservabilityV7FromTimelinePayload(
          '123',
          payload as never,
        ),
      ).toBeUndefined();
    }
  });

  it('rejects player-pawn observations even with otherwise usable values', () => {
    const snapshot = extractRecommendationObservabilityV7FromTimelinePayload(
      '123',
      {
        entity_type: 'player_pawn',
        steam_id: 42,
        hero_id: 7,
        game_time: 321,
        spendable_souls: 1750,
      },
    );

    expect(snapshot).toBeUndefined();
  });

  it('builds direct metadata account identity only for unambiguous hero records', () => {
    const index = buildRecommendationObservabilityV7DirectIdentityIndex({
      match_info: {
        players: [
          { hero_id: 7, account_id: 42 },
          { hero_id: 8, account_id: '4294967295' },
          { hero_id: 9, account_id: 100 },
          { hero_id: 9, account_id: 101 },
          { hero_id: 10, account_id: 4294967296 },
        ],
      },
    });

    expect([...index.byHeroId.entries()]).toEqual([
      [7, 42],
      [8, 4294967295],
    ]);
    expect(index.conflictingHeroCount).toBe(1);
    expect(index.playerWithAccountIdCount).toBe(4);
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

  it('keeps an incomplete final NDJSON line behind the persisted cursor', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'v7-observability-tail-'));
    const path = join(directory, 'events.ndjson');
    const completeLine = '{"eventId":"complete"}\n';
    const incompleteLine = '{"eventId":"partial"';
    try {
      await writeFile(path, `${completeLine}${incompleteLine}`, 'utf8');
      const partialSize = Buffer.byteLength(
        `${completeLine}${incompleteLine}`,
        'utf8',
      );
      expect(
        await findRecommendationObservabilityV7CompleteEndExclusive(
          path,
          0,
          partialSize,
        ),
      ).toBe(Buffer.byteLength(completeLine, 'utf8'));

      const completedContent = `${completeLine}${incompleteLine}}\n`;
      await writeFile(path, completedContent, 'utf8');
      expect(
        await findRecommendationObservabilityV7CompleteEndExclusive(
          path,
          Buffer.byteLength(completeLine, 'utf8'),
          Buffer.byteLength(completedContent, 'utf8'),
        ),
      ).toBe(Buffer.byteLength(completedContent, 'utf8'));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
