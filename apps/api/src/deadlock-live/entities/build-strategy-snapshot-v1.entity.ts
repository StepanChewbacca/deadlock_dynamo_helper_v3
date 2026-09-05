import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('build_strategy_snapshots_v1')
@Index('idx_build_strategy_snapshot_scope_v1', [
  'heroId',
  'rulesetId',
  'patchId',
  'catalogSha256',
  'active',
  'publishedAt',
])
export class BuildStrategySnapshotV1Entity {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  snapshotId!: string;

  @Column({ type: 'int' })
  heroId!: number;

  @Column({ type: 'varchar', length: 128 })
  rulesetId!: string;

  @Column({ type: 'varchar', length: 128 })
  patchId!: string;

  @Column({ type: 'char', length: 64 })
  catalogSha256!: string;

  @Column({ type: 'char', length: 64 })
  sourceSha256!: string;

  @Column({ type: 'char', length: 64 })
  contentSha256!: string;

  @Column({ type: 'varchar', length: 32, default: 'build-strategy-v1' })
  schemaVersion!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'timestamptz' })
  publishedAt!: Date;
}
