import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('recommendation_economy_rules_snapshots_v1')
@Index('idx_recommendation_economy_rules_scope_v1', [
  'rulesetId',
  'catalogSha256',
  'active',
  'verifiedAt',
])
export class RecommendationEconomyRulesSnapshotV1Entity {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  snapshotId!: string;

  @Column({ type: 'varchar', length: 128 })
  rulesetId!: string;

  @Column({ type: 'char', length: 64 })
  catalogSha256!: string;

  @Column({ type: 'varchar', length: 256 })
  source!: string;

  @Column({ type: 'char', length: 64 })
  contentSha256!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'timestamptz' })
  verifiedAt!: Date;
}
