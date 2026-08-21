import {
  SHOP_SIGNAL_CANDIDATE_ANALYSIS_VERSION,
  analyzeShopSignalCandidatesV1,
} from './shop-signal-candidate-analysis';

const base = Date.parse('2026-08-22T00:00:00.000Z');

function iso(offsetMs: number): string {
  return new Date(base + offsetMs).toISOString();
}

describe('analyzeShopSignalCandidatesV1', () => {
  it('ranks a low-cardinality channel that separates manual shop states without promoting it', () => {
    const notes = Array.from({ length: 6 }, (_, index) => ({
      id: `marker-${index}`,
      createdAt: iso(index * 10_000),
      matchId: 'match-1',
      action: index % 2 === 0 ? 'SHOP_AVAILABLE' : 'SHOP_UNAVAILABLE',
    }));
    const entries = notes.flatMap((note, index) => ([
      {
        sequence: index * 2 + 1,
        receivedAt: iso(index * 10_000 + 100),
        source: 'onInfoUpdates2',
        feature: 'match_info',
        category: 'match_info',
        key: 'undocumented_candidate',
        matchId: 'match-1',
        rawPayload: note.action === 'SHOP_AVAILABLE' ? true : false,
      },
      {
        sequence: index * 2 + 2,
        receivedAt: iso(index * 10_000 + 120),
        source: 'onInfoUpdates2',
        feature: 'match_info',
        category: 'roster',
        key: 'roster_1',
        matchId: 'match-1',
        rawPayload: { souls: 1000 + index * 100 },
      },
    ]));

    const report = analyzeShopSignalCandidatesV1(entries, notes);

    expect(report.version).toBe(SHOP_SIGNAL_CANDIDATE_ANALYSIS_VERSION);
    expect(report.blockers).toEqual([]);
    expect(report.candidateOnly).toBe(true);
    expect(report.canPromoteToDirectSource).toBe(false);
    expect(report.candidates[0].channel.key).toBe('undocumented_candidate');
    expect(report.candidates[0].provenanceSourceField).toBe(
      'onInfoUpdates2|match_info|match_info|undocumented_candidate',
    );
    expect(report.candidates[0].markerCoverage).toBe(1);
    expect(report.candidates[0].distinctPayloadCount).toBe(2);
    expect(report.candidates[0].lowCardinality).toBe(true);
    expect(report.candidates[0].observedPayloadsSeparatedByMarkerState).toBe(true);
  });

  it('reports insufficient marker evidence rather than treating correlation as a direct signal', () => {
    const report = analyzeShopSignalCandidatesV1(
      [{
        sequence: 1,
        receivedAt: iso(100),
        source: 'onInfoUpdates2',
        feature: 'match_info',
        category: 'match_info',
        key: 'candidate',
        matchId: 'match-1',
        rawPayload: true,
      }],
      [{ id: 'marker-1', createdAt: iso(0), matchId: 'match-1', action: 'SHOP_AVAILABLE' }],
    );

    expect(report.blockers).toContain('SHOP_UNAVAILABLE_MARKERS_MISSING');
    expect(report.blockers).toContain('SHOP_MARKER_COUNT_BELOW_6');
    expect(report.blockers).toContain('NO_LOW_CARDINALITY_SEPARATING_CANDIDATE');
    expect(report.canPromoteToDirectSource).toBe(false);
  });

  it('does not correlate a marker with entries from another known match', () => {
    const report = analyzeShopSignalCandidatesV1(
      [{
        sequence: 1,
        receivedAt: iso(100),
        source: 'onInfoUpdates2',
        feature: 'match_info',
        category: 'match_info',
        key: 'candidate',
        matchId: 'match-2',
        rawPayload: true,
      }],
      [{ id: 'marker-1', createdAt: iso(0), matchId: 'match-1', action: 'SHOP_AVAILABLE' }],
    );

    expect(report.candidateCount).toBe(0);
  });

  it('ignores unrelated diagnostic/system channels and malformed timestamps', () => {
    const report = analyzeShopSignalCandidatesV1(
      [
        {
          sequence: 1,
          receivedAt: iso(100),
          source: 'getInfo',
          key: 'initial_snapshot',
          rawPayload: { candidate: true },
        },
        {
          sequence: 2,
          receivedAt: 'invalid',
          source: 'onInfoUpdates2',
          key: 'candidate',
          rawPayload: true,
        },
      ],
      [
        { id: 'a', createdAt: iso(0), action: 'SHOP_AVAILABLE' },
        { id: 'u', createdAt: iso(1000), action: 'SHOP_UNAVAILABLE' },
      ],
    );

    expect(report.candidateCount).toBe(0);
    expect(report.blockers).toContain('NO_LOW_CARDINALITY_SEPARATING_CANDIDATE');
  });

  it('validates the analysis window', () => {
    expect(() => analyzeShopSignalCandidatesV1([], [], 0)).toThrow('analysisWindowMs must be a positive integer');
  });
});
