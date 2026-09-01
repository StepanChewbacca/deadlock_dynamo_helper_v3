import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('recommendation_item_catalog_recipes_v1')
@Index(
  'idx_recommendation_item_catalog_recipes_v1_parent_component',
  ['catalogVersionId', 'parentItemId', 'componentItemId'],
  { unique: true },
)
export class RecommendationItemCatalogRecipeV1 {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index('idx_recommendation_item_catalog_recipes_v1_catalog_id')
  @Column({ type: 'varchar', length: 128 })
  catalogVersionId!: string;

  @Column({ type: 'bigint' })
  parentItemId!: number;

  @Column({ type: 'bigint' })
  componentItemId!: number;

  @Column({ type: 'int' })
  componentOrder!: number;
}
