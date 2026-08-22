import { RecommendationRealtimeStateV8Service } from '../src/deadlock-live/recommendation-realtime-state-v8.service';

describe('RecommendationRealtimeStateV8Service point-in-time causality', () => {
  it('never selects state or history that was received after the decision', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const dataSource = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return [];
      }),
    };
    const service = new RecommendationRealtimeStateV8Service(dataSource as never);

    const result = await service.build({
      decisionId: 'decision-1',
      matchId: 'match-1',
      playerKey: 'player-1',
      playerSlot: 1,
      decisionAtMs: Date.parse('2026-08-22T00:00:10.000Z'),
    });

    expect(result.ready).toBe(false);
    const player = calls.find((call) => call.sql.includes("\"eventType\" = 'PLAYER_STATE'"));
    const inventory = calls.find((call) => call.sql.includes("\"eventType\" = 'INVENTORY_SNAPSHOT'"));
    const history = calls.find((call) => call.sql.includes("\"eventType\" IN ('RECOMMENDATION_DECISION', 'RECOMMENDATION_OUTCOME')"));
    expect(player?.sql).toContain('"receivedAt" <= $4');
    expect(inventory?.sql).toContain('"receivedAt" <= $4');
    expect(history?.sql).toContain('"receivedAt" <= $3');
  });
});
