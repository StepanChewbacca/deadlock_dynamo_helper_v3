import {
  ADAPTIVE_HERO_CATALOG,
  getAdaptiveHeroDisplayName,
} from './generated/adaptive-hero-catalog';

describe('adaptive hero catalog', () => {
  it('resolves canonical checked-in hero names and never fabricates unknown labels', () => {
    expect(getAdaptiveHeroDisplayName(3)).toBe('Vindicta');
    expect(getAdaptiveHeroDisplayName(17)).toBe('Grey Talon');
    expect(getAdaptiveHeroDisplayName(999999)).toBeUndefined();
    expect(ADAPTIVE_HERO_CATALOG[3]?.normalizedName).toBe('vindicta');
  });
});
