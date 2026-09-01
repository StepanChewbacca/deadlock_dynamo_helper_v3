import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('recommendation_item_catalog_versions_v1')
export class RecommendationItemCatalogVersionV1 {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_recommendation_item_catalog_versions_v1_catalog_id', { unique: true })
  @Column({ type: 'varchar', length: 128 })
  catalogVersionId!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  contentCatalogVersionId?: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  clientVersion?: string;

  @Column({ type: 'varchar', length: 128 })
  rulesetKey!: string;

  @Column({ type: 'varchar', length: 64 })
  source!: string;

  @Index('idx_recommendation_item_catalog_versions_v1_sha256', { unique: true })
  @Column({ type: 'char', length: 64 })
  payloadSha256!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  importedAt!: Date;
}
