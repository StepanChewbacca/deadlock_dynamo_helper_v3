import { RecommendationTrainingDatasetV8Service } from '../src/deadlock-live/recommendation-training-dataset-v8.service';
import { RecommendationValueTrainingDatasetV8Service } from '../src/deadlock-live/recommendation-value-training-dataset-v8.service';

describe('Recommendation training split boundaries', () => {
  it('requires every Behavioral match to end inside the same chronological split', async () => {
    const queries: string[] = [];
    const dataSource = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return sql.includes('COUNT(DISTINCT')
          ? [{ matchCount: 1, decisionCount: 10_000 }]
          : [];
      }),
    };
    const service = new RecommendationTrainingDatasetV8Service(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const split = {
      split: 'SHADOW_HOLDOUT' as const,
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-08T00:00:00.000Z',
    };

    await (service as any).splitCounts('candidate-v1', split);
    await (service as any).loadSplitDecisions('candidate-v1', split);

    expect(queries).toHaveLength(2);
    for (const sql of queries) {
      expect(sql).toContain('MAX("decidedAt") AS last_decision_at');
      expect(sql).toContain('m.first_decision_at >= $2::timestamptz');
      expect(sql).toContain('m.last_decision_at < $3::timestamptz');
      expect(sql).not.toContain('m.first_decision_at < $3::timestamptz');
    }
  });

  it('requires every causal Value match to end inside its TRAIN, VALIDATION, or SHADOW_HOLDOUT window', async () => {
    const queries: string[] = [];
    const dataSource = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return sql.includes('COUNT(DISTINCT')
          ? [{ matchCount: 1, decisionCount: 100 }]
          : [];
      }),
    };
    const service = new RecommendationValueTrainingDatasetV8Service(
      dataSource as never,
      {} as never,
      {} as never,
    );
    const split = {
      split: 'VALIDATION' as const,
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-08T00:00:00.000Z',
    };

    await (service as any).splitCounts('candidate-v1', 'economyDelta120s', split);
    await (service as any).loadSplitDecisions('candidate-v1', 'economyDelta120s', split);

    expect(queries).toHaveLength(2);
    for (const sql of queries) {
      expect(sql).toContain('MAX(d."decidedAt") AS last_decision_at');
      expect(sql).toContain('m.first_decision_at >= $2::timestamptz');
      expect(sql).toContain('m.last_decision_at < $3::timestamptz');
      expect(sql).not.toContain('m.first_decision_at < $3::timestamptz');
    }
  });
});
