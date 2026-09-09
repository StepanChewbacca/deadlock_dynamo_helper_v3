import { getMetadataArgsStorage } from 'typeorm';
import { StatlockerVsHeroWpaRawSnapshotV1Entity } from '../src/deadlock-live/entities/statlocker-vs-hero-wpa-raw-snapshot-v1.entity';

describe('Statlocker VS_HERO_WPA RAW snapshot V1 persistence contract', () => {
  it('maps the dedicated immutable RAW snapshot table and required provenance fields', () => {
    const metadata = getMetadataArgsStorage();
    const table = metadata.tables.find(
      (candidate) => candidate.target === StatlockerVsHeroWpaRawSnapshotV1Entity,
    );
    const columns = metadata.columns
      .filter((candidate) => candidate.target === StatlockerVsHeroWpaRawSnapshotV1Entity)
      .map((candidate) => candidate.propertyName);

    expect(table?.name).toBe('statlocker_vs_hero_wpa_raw_snapshots_v1');
    expect(columns).toEqual(
      expect.arrayContaining([
        'snapshotId',
        'contentSha256',
        'fetchedAt',
        'sourcePath',
        'sourceStatus',
        'statlockerPatchId',
        'rulesetVersion',
        'catalogSha256',
        'collectorVersion',
        'rawPayload',
        'ingestStatus',
        'ingestMetadata',
      ]),
    );
  });

  it('uses the content hash as immutable content identity', () => {
    const metadata = getMetadataArgsStorage();
    const unique = metadata.uniques.find(
      (candidate) => candidate.target === StatlockerVsHeroWpaRawSnapshotV1Entity,
    );

    expect(unique?.columns).toEqual(['contentSha256']);
  });
});
