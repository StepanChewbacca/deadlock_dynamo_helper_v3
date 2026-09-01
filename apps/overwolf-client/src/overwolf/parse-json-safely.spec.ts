import { parseJsonSafely } from './parse-json-safely';

describe('parseJsonSafely', () => {
  it('parses valid JSON object strings', () => {
    expect(parseJsonSafely('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses valid JSON array strings', () => {
    expect(parseJsonSafely('[1,2]')).toEqual([1, 2]);
  });

  it('preserves primitive numeric strings such as match IDs', () => {
    expect(parseJsonSafely('103059727')).toBe('103059727');
  });

  it('preserves primitive JSON strings', () => {
    expect(parseJsonSafely('"PreGameWait"')).toBe('"PreGameWait"');
  });

  it('returns raw value for invalid JSON', () => {
    expect(parseJsonSafely('not-json')).toBe('not-json');
  });
});
