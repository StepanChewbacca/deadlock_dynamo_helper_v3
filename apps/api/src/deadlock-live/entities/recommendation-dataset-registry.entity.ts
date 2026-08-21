import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { RecommendationDatasetManifestV1 } from '@deadlock-live-probe/shared';

@Entity('recommendation_dataset_registry_v1')
export class RecommendationDatasetRegistryV1 {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_recommendation_dataset_registry_v1_dataset_id', { unique: true })
  @Column({ type: 'varchar', length: 128 })
  datasetId!: string;

  @Index('idx_recommendation_dataset_registry_v1_dataset_sha256', { unique: true })
  @Column({ type: 'char', length: 64 })
  datasetSha256!: string;

  @Index('idx_recommendation_dataset_registry_v1_manifest_sha256', { unique: true })
  @Column({ type: 'char', length: 64 })
  manifestSha256!: string;

  @Column({ type: 'varchar', length: 2048 })
  objectBaseUri!: string;

  @Column({ type: 'jsonb' })
  manifest!: RecommendationDatasetManifestV1;

  @CreateDateColumn({ type: 'timestamptz' })
  registeredAt!: Date;
}
