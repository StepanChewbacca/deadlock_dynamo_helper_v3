import { RecommendationObservabilityReportService } from '../src/deadlock-live/recommendation-observability-report.service';

const ENV = 'RECOMMENDATION_DIRECT_SHOP_SOURCE_ALLOWLIST';

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
    const query = jest.fn(async () => []);
    const service = new RecommendationObservabilityReportService({ query } as never);

    const report = await service.buildReport({ maximumAlignmentAgeMs: 5000 });

    expect(report.approvedDirectShopSourceKeys).toEqual([
      'OVERWOLF_GEP:onInfoUpdates2|match_info|match_info|shop_state',
      'OVERWOLF_GEP:onNewEvents|match_info||shop_enter',
    ]);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('ANY($4::text[])');
    expect(sql).toContain('player_source');
    expect(params[3]).toEqual(report.approvedDirectShopSourceKeys);
  });

  it('uses an empty allowlist by default so historical unapproved claims cannot count as coverage', async () => {
    delete process.env[ENV];
    const query = jest.fn(async () => []);
    const service = new RecommendationObservabilityReportService({ query } as never);

    const report = await service.buildReport();

    expect(report.approvedDirectShopSourceKeys).toEqual([]);
    expect(query.mock.calls[0][1][3]).toEqual([]);
    expect(report.metrics.shopOpportunityCoverage).toBe(0);
  });
});
