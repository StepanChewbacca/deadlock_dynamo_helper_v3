import {
  StatlockerBrowserCollectorService,
  StatlockerCollectionAccessError,
} from '../src/statlocker-adaptive/statlocker-browser-collector.service';

function createHarness(overrides: Record<string, { status: number; data: unknown }> = {}) {
  const calls: string[] = [];
  const close = jest.fn().mockResolvedValue(undefined);
  const page = {
    goto: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn(async (_fn: unknown, input: { path: string }) => {
      calls.push(input.path);
      const overridden = overrides[input.path];
      if (overridden) return overridden;
      if (input.path === '/api/info/wpa-patches') {
        return {
          status: 200,
          data: {
            current_minor_patch_id: 'patch_15-1',
            patches: [{ minor_patch_id: '15-1' }],
          },
        };
      }
      return { status: 200, data: { path: input.path } };
    }),
  };
  const launch = jest.fn().mockResolvedValue({
    newPage: jest.fn().mockResolvedValue(page),
    close,
  });

  return {
    service: new StatlockerBrowserCollectorService({ launch }),
    launch,
    close,
    calls,
  };
}

describe('StatlockerBrowserCollectorService', () => {
  it('uses one browser session for a multi-dataset batch and closes it once', async () => {
    const harness = createHarness();

    const result = await harness.service.collectBatch([
      { dataset: 'WPA_PATCH_DATA', scopeKey: 'patch:current' },
      { dataset: 'VS_HERO_WPA', scopeKey: 'global' },
      { dataset: 'T4_CHAINS', scopeKey: 'global' },
      { dataset: 'PRO_BUILD_ANALYSIS', scopeKey: 'hero:10:account:101', heroId: 10, accountId: '101' },
    ]);

    expect(harness.launch).toHaveBeenCalledTimes(1);
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(result.statlockerPatchId).toBe('15-1');
    expect(harness.calls).toContain('/api/info/wpa-patch-data/15-1');
    expect(harness.calls).not.toContain('/api/info/wpa-patch-data/patch_15-1');
    expect(result.datasets.map((entry) => entry.dataset)).toEqual([
      'WPA_PATCH_DATA',
      'VS_HERO_WPA',
      'T4_CHAINS',
      'PRO_BUILD_ANALYSIS',
    ]);
  });

  it.each([401, 403])('treats HTTP %s as an access collection failure', async (status) => {
    const harness = createHarness({
      '/api/info/wpa-patches': { status, data: { error: 'restricted' } },
    });

    await expect(harness.service.collectBatch([
      { dataset: 'T4_CHAINS', scopeKey: 'global' },
    ])).rejects.toBeInstanceOf(StatlockerCollectionAccessError);
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it('does not expose browser session or authentication material in collector results', async () => {
    const harness = createHarness();
    const result = await harness.service.collectBatch([
      { dataset: 'T4_CHAINS', scopeKey: 'global' },
    ]);

    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized).not.toContain('cookie');
    expect(serialized).not.toContain('header');
    expect(serialized).not.toContain('localstorage');
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('api-key');
    expect(serialized).not.toContain('apikey');
  });
});
