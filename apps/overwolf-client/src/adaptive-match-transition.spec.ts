import { didAdaptiveMatchChange } from './adaptive-match-transition';

describe('adaptive match transition', () => {
  it('clears a preserved recommendation when a live match id changes', () => {
    expect(didAdaptiveMatchChange('match-a', 'match-b')).toBe(true);
  });

  it('does not treat initial detection or repeated events as a match change', () => {
    expect(didAdaptiveMatchChange('', 'match-a')).toBe(false);
    expect(didAdaptiveMatchChange('match-a', 'match-a')).toBe(false);
    expect(didAdaptiveMatchChange(' match-a ', 'match-a')).toBe(false);
  });
});
