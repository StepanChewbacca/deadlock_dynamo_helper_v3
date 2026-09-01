import { parseJsonSafely } from './parse-json-safely';

describe('parseJsonSafely', () => {
  it('parses valid JSON objects', () => {
    expect(parseJsonSafely('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses valid JSON arrays', () => {
    expect(parseJsonSafely('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('preserves numeric primitive strings such as Deadlock match_id', () => {
    expect(parseJsonSafely('103059727')).toBe('103059727');
  });

  it('preserves plain string primitives', () => {
    expect(parseJsonSafely('PreGameWait')).toBe('PreGameWait');
  });

  it('returns raw value for invalid JSON objects', () => {
    expect(parseJsonSafely('{not-json}')).toBe('{not-json}');
  });
});
