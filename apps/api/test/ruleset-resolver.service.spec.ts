import {
  MissingRawMatchMetadataError,
  RulesetResolverService,
  extractDemoMetadataClientVersion,
  extractMatchStartTime,
  extractObservedClientVersion,
  resolveRulesetByTimeWindow,
} from '../src/deadlock-live/ruleset-resolver.service';

describe('RulesetResolverService helpers', () => {
  it('throws a typed error when raw metadata is absent', async () => {
    const service = new RulesetResolverService(
      { findOne: jest.fn(async () => undefined) } as any,
      {} as any,
      {} as any,
    );

    await expect(service.getLatestForMatch(100)).rejects.toBeInstanceOf(MissingRawMatchMetadataError);
  });

  it('prefers explicit observed client_version fields', () => {
    expect(
      extractObservedClientVersion({
        match_info: {
          client_version: 6518,
        },
      }),
    ).toEqual({
      clientVersion: 6518,
      path: 'match_info.client_version',
    });
  });

  it('extracts supported demo metadata build fields without using generic version fields', () => {
    expect(
      extractDemoMetadataClientVersion({
        version: 999,
        demo_metadata: {
          build_id: '6518',
        },
      }),
    ).toEqual({
      clientVersion: 6518,
      path: 'demo_metadata.build_id',
    });
  });

  it('converts match start time from Unix seconds', () => {
    expect(
      extractMatchStartTime({
        match_info: {
          start_time: 1_700_000_000,
        },
      })?.toISOString(),
    ).toBe('2023-11-14T22:13:20.000Z');
  });

  it('resolves one active window and excludes matches near patch boundaries', () => {
    const rulesets = [
      {
        id: 1,
        rulesetKey: 'client-6518',
        clientVersion: 6518,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validTo: new Date('2026-02-01T00:00:00.000Z'),
        status: 'active',
      },
    ];

    expect(
      resolveRulesetByTimeWindow(
        new Date('2026-01-15T00:00:00.000Z'),
        rulesets,
        6 * 60 * 60 * 1000,
      ),
    ).toMatchObject({
      candidate: rulesets[0],
      boundaryExcluded: false,
      ambiguityCount: 1,
    });

    expect(
      resolveRulesetByTimeWindow(
        new Date('2026-01-01T03:00:00.000Z'),
        rulesets,
        6 * 60 * 60 * 1000,
      ),
    ).toEqual({
      candidate: undefined,
      boundaryExcluded: true,
      ambiguityCount: 1,
    });
  });
});
