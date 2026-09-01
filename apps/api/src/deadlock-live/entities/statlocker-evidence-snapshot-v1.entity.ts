import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('statlocker_evidence_snapshots_v1')
@Index('idx_statlocker_snapshot_lookup_v1', [
  'dataset',
  'rulesetVersion',
  'catalogSha256',
  'statlockerPatchId',
  'scopeKey',
  'fetchedAt',
])
export class StatlockerEvidenceSnapshotV1Entity {
  @PrimaryColumn({ type: 'varchar', length: 96 })
  snapshotId!: string;

  @Column({ type: 'varchar', length: 64 })
  dataset!: string;

  @Column({ type: 'varchar', length: 128 })
  rulesetVersion!: string;

  @Column({ type: 'char', length: 64 })
  catalogSha256!: string;

  @Column({ type: 'varchar', length: 128 })
  statlockerPatchId!: string;

  @Column({ type: 'varchar', length: 255 })
  scopeKey!: string;

  @Column({ type: 'timestamptz' })
  fetchedAt!: Date;

  @Column({ type: 'varchar', length: 64 })
  schemaVersion!: string;

  @Column({ type: 'varchar', length: 64 })
  collectorVersion!: string;

  @Column({ type: 'varchar', length: 64 })
  normalizerVersion!: string;

  @Column({ type: 'char', length: 64 })
  contentSha256!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
