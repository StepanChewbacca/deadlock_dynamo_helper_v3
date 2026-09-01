import { RecommendationObservabilityReportService } from '../src/deadlock-live/recommendation-observability-report.service';

const ENV = 'RECOMMENDATION_DIRECT_SHOP_SOURCE_ALLOWLIST';
type QueryCall = [string, unknown[]];

function queryMock() {
  return jest.fn<Promise<unknown[]>, QueryCall>(async () => []);
}

describe('RecommendationObservabilityReportService direct shop approval', () => {
  const original = process.env[ENV];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  it('passes the exact approved source keys into the SQL coverage calculation', async () => {
    process.env[ENV] = [
      'OVERWOLF_GEP:onInfoUpdates2|match_info|match_info|shop_state',
      'OVERWOLF_GEP:onNewEvents|match_info||shop_enter',
    ].join(',');
    const query = queryMock();
    const service = new RecommendationObservabilityReportService({ query } as never);

    const report = await service.buildReport({ maximumAlignmentAgeMs: 5000 });

    expect(report.approvedDirectShopSourceKeys).toEqual([
      'OVERWOLF_GEP:onInfoUpdates2|match_info|match_info|shop_state',
      'OVERWOLF_GEP:onNewEvents|match_info||shop_enter',
    ]);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain('ANY($4::text[])');
    expect(sql).toContain('player_source');
    expect(params[3]).toEqual(report.approvedDirectShopSourceKeys);
  });

  it('uses an empty allowlist by default so historical unapproved claims cannot count as coverage', async () => {
    delete process.env[ENV];
    const query = queryMock();
    const service = new RecommendationObservabilityReportService({ query } as never);

    const report = await service.buildReport();

    expect(report.approvedDirectShopSourceKeys).toEqual([]);
    expect(query.mock.calls[0]![1][3]).toEqual([]);
    expect(report.metrics.shopOpportunityCoverage).toBe(0);
  });

  it('scopes observability to one generator and rejects state received after the decision', async () => {
    const query = queryMock();
    const service = new RecommendationObservabilityReportService({ query } as never);

    const report = await service.buildReport({ candidateGeneratorVersion: '  candidate-v8.4  ' });

    expect(report.candidateGeneratorVersion).toBe('candidate-v8.4');
    const [sql, params] = query.mock.calls[0]!;
    expect(params[4]).toBe('candidate-v8.4');
    expect(sql).toContain('d.\"candidateGeneratorVersion\" = $5::text');
    expect(sql).toContain('e.\"receivedAt\" <= d.\"decidedAt\"');
    expect(sql).toContain('player_received_at');
    expect(sql).toContain('inventory_received_at');
  });

  it('rejects an empty candidate generator scope instead of silently mixing versions', async () => {
    const service = new RecommendationObservabilityReportService({ query: jest.fn() } as never);

    await expect(service.buildReport({ candidateGeneratorVersion: '   ' }))
      .rejects.toThrow('candidateGeneratorVersion must be non-empty when provided');
  });
});
