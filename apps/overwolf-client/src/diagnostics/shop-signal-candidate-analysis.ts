export const SHOP_SIGNAL_CANDIDATE_ANALYSIS_VERSION = 'shop-signal-candidate-analysis-v1' as const;

export type ShopSignalMarkerState = 'AVAILABLE' | 'UNAVAILABLE';

export interface ShopSignalDiagnosticEntry {
  sequence: number;
  receivedAt: string;
  source: string;
  matchId?: string;
  feature?: string;
  category?: string;
  key?: string;
  rawPayload: unknown;
}

export interface ShopSignalDiagnosticNote {
  id: string;
  createdAt: string;
  matchId?: string;
  action: string;
}

export interface ShopSignalChannelV1 {
  source: string;
  feature?: string;
  category?: string;
  key: string;
}

export interface ShopSignalCandidateV1 {
  channel: ShopSignalChannelV1;
  provenanceSourceField: string;
  markerHitCount: number;
  availableMarkerHitCount: number;
  unavailableMarkerHitCount: number;
  markerCoverage: number;
  distinctPayloadCount: number;
  lowCardinality: boolean;
  observedPayloadsSeparatedByMarkerState: boolean;
  availablePayloadFingerprints: readonly string[];
  unavailablePayloadFingerprints: readonly string[];
}

export interface ShopSignalCandidateAnalysisV1 {
  version: typeof SHOP_SIGNAL_CANDIDATE_ANALYSIS_VERSION;
  candidateOnly: true;
  canPromoteToDirectSource: false;
  analysisWindowMs: number;
  markerCount: number;
  availableMarkerCount: number;
  unavailableMarkerCount: number;
  candidateCount: number;
  blockers: readonly string[];
  candidates: readonly ShopSignalCandidateV1[];
}

const SHOP_MARKER_ACTIONS: Readonly<Record<string, ShopSignalMarkerState>> = {
  SHOP_AVAILABLE: 'AVAILABLE',
  SHOP_UNAVAILABLE: 'UNAVAILABLE',
};

export function analyzeShopSignalCandidatesV1(
  entries: readonly ShopSignalDiagnosticEntry[],
  notes: readonly ShopSignalDiagnosticNote[],
  analysisWindowMs = 2_500,
): ShopSignalCandidateAnalysisV1 {
  if (!Number.isInteger(analysisWindowMs) || analysisWindowMs <= 0) {
    throw new Error('analysisWindowMs must be a positive integer');
  }

  const markers = notes.flatMap((note) => {
    const state = SHOP_MARKER_ACTIONS[note.action];
    const timestampMs = Date.parse(note.createdAt);
    if (!state || !Number.isFinite(timestampMs)) return [];
    return [{ id: note.id, state, timestampMs, matchId: note.matchId }];
  });
  const availableMarkerCount = markers.filter((marker) => marker.state === 'AVAILABLE').length;
  const unavailableMarkerCount = markers.filter((marker) => marker.state === 'UNAVAILABLE').length;

  const byChannel = new Map<string, {
    channel: ShopSignalChannelV1;
    entries: Array<ShopSignalDiagnosticEntry & { timestampMs: number; payloadFingerprint: string }>;
  }>();
  for (const entry of entries) {
    if (!entry.key) continue;
    if (entry.source !== 'onInfoUpdates2' && entry.source !== 'onNewEvents') continue;
    const timestampMs = Date.parse(entry.receivedAt);
    if (!Number.isFinite(timestampMs)) continue;
    const channel: ShopSignalChannelV1 = {
      source: entry.source,
      feature: entry.feature,
      category: entry.category,
      key: entry.key,
    };
    const channelKey = canonicalJson(channel);
    const bucket = byChannel.get(channelKey) ?? { channel, entries: [] };
    bucket.entries.push({
      ...entry,
      timestampMs,
      payloadFingerprint: fingerprintCanonical(entry.rawPayload),
    });
    byChannel.set(channelKey, bucket);
  }

  const candidates = [...byChannel.values()].flatMap((bucket) => {
    bucket.entries.sort((left, right) => left.timestampMs - right.timestampMs || left.sequence - right.sequence);
    const availablePayloads = new Set<string>();
    const unavailablePayloads = new Set<string>();
    let availableMarkerHitCount = 0;
    let unavailableMarkerHitCount = 0;

    for (const marker of markers) {
      const nearest = nearestEntry(bucket.entries, marker.timestampMs, analysisWindowMs, marker.matchId);
      if (!nearest) continue;
      if (marker.state === 'AVAILABLE') {
        availableMarkerHitCount += 1;
        availablePayloads.add(nearest.payloadFingerprint);
      } else {
        unavailableMarkerHitCount += 1;
        unavailablePayloads.add(nearest.payloadFingerprint);
      }
    }

    const markerHitCount = availableMarkerHitCount + unavailableMarkerHitCount;
    if (markerHitCount === 0) return [];
    const distinctPayloads = new Set(bucket.entries.map((entry) => entry.payloadFingerprint));
    const lowCardinality = distinctPayloads.size >= 2 && distinctPayloads.size <= 4;
    const observedPayloadsSeparatedByMarkerState = availablePayloads.size > 0
      && unavailablePayloads.size > 0
      && areDisjoint(availablePayloads, unavailablePayloads);

    return [{
      channel: bucket.channel,
      provenanceSourceField: channelSourceField(bucket.channel),
      markerHitCount,
      availableMarkerHitCount,
      unavailableMarkerHitCount,
      markerCoverage: markers.length > 0 ? markerHitCount / markers.length : 0,
      distinctPayloadCount: distinctPayloads.size,
      lowCardinality,
      observedPayloadsSeparatedByMarkerState,
      availablePayloadFingerprints: [...availablePayloads].sort(),
      unavailablePayloadFingerprints: [...unavailablePayloads].sort(),
    } satisfies ShopSignalCandidateV1];
  }).sort(compareCandidates);

  const blockers: string[] = [];
  if (availableMarkerCount === 0) blockers.push('SHOP_AVAILABLE_MARKERS_MISSING');
  if (unavailableMarkerCount === 0) blockers.push('SHOP_UNAVAILABLE_MARKERS_MISSING');
  if (markers.length < 6) blockers.push('SHOP_MARKER_COUNT_BELOW_6');
  if (!candidates.some((candidate) => (
    candidate.availableMarkerHitCount > 0
    && candidate.unavailableMarkerHitCount > 0
    && candidate.lowCardinality
    && candidate.observedPayloadsSeparatedByMarkerState
  ))) blockers.push('NO_LOW_CARDINALITY_SEPARATING_CANDIDATE');

  return {
    version: SHOP_SIGNAL_CANDIDATE_ANALYSIS_VERSION,
    candidateOnly: true,
    canPromoteToDirectSource: false,
    analysisWindowMs,
    markerCount: markers.length,
    availableMarkerCount,
    unavailableMarkerCount,
    candidateCount: candidates.length,
    blockers: [...new Set(blockers)].sort(),
    candidates,
  };
}

function nearestEntry<T extends { timestampMs: number; matchId?: string }>(
  entries: readonly T[],
  markerTimestampMs: number,
  analysisWindowMs: number,
  markerMatchId: string | undefined,
): T | undefined {
  let best: T | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    if (markerMatchId && entry.matchId !== markerMatchId) continue;
    const distance = Math.abs(entry.timestampMs - markerTimestampMs);
    if (distance > analysisWindowMs) continue;
    if (distance < bestDistance || (distance === bestDistance && entry.timestampMs <= markerTimestampMs)) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best;
}

function compareCandidates(left: ShopSignalCandidateV1, right: ShopSignalCandidateV1): number {
  if (left.observedPayloadsSeparatedByMarkerState !== right.observedPayloadsSeparatedByMarkerState) {
    return left.observedPayloadsSeparatedByMarkerState ? -1 : 1;
  }
  if (left.lowCardinality !== right.lowCardinality) return left.lowCardinality ? -1 : 1;
  if (left.markerCoverage !== right.markerCoverage) return right.markerCoverage - left.markerCoverage;
  if (left.markerHitCount !== right.markerHitCount) return right.markerHitCount - left.markerHitCount;
  return left.provenanceSourceField.localeCompare(right.provenanceSourceField);
}

function channelSourceField(channel: ShopSignalChannelV1): string {
  return [channel.source, channel.feature ?? '', channel.category ?? '', channel.key].join('|');
}

function areDisjoint(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const value of left) if (right.has(value)) return false;
  return true;
}

function fingerprintCanonical(value: unknown): string {
  const text = canonicalJson(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
