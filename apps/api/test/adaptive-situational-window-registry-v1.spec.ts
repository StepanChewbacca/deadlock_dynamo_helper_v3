import {
  loadAdaptiveSituationalWindowRegistryV1,
  resolveAdaptiveSituationalWindowsV1,
} from '../src/statlocker-adaptive/adaptive-situational-window-registry-v1';

describe('adaptive situational window registry', () => {
  it('resolves only exact hero/ruleset/catalog metadata and preserves explicit purpose', () => {
    const raw = JSON.stringify([{
      heroId: 10,
      rulesetId: 'ruleset-a',
      catalogSha256: 'a'.repeat(64),
      windowId: 'catch-window',
      purpose: 'CATCH',
      targetItemIds: [100, 101],
      maxItems: 1,
      maxSoulsDelay: 1600,
      reservedSlots: 1,
    }]);
    const registry = loadAdaptiveSituationalWindowRegistryV1(raw);

    expect(resolveAdaptiveSituationalWindowsV1(registry, 10, 'ruleset-a', 'a'.repeat(64))).toHaveLength(1);
    expect(resolveAdaptiveSituationalWindowsV1(registry, 11, 'ruleset-a', 'a'.repeat(64))).toEqual([]);
    expect(registry[0].purpose).toBe('CATCH');
  });

  it('fails closed on malformed metadata instead of inventing mechanics', () => {
    expect(loadAdaptiveSituationalWindowRegistryV1('[{"heroId":10}]')).toEqual([]);
    expect(loadAdaptiveSituationalWindowRegistryV1('not-json')).toEqual([]);
  });
});
