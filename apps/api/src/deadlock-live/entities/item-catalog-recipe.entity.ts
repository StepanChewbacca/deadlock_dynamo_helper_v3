import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('recommendation_item_catalog_recipes_v8')
@Index(
  'idx_rec_v8_recipe_version_parent_component',
  ['catalogVersionId', 'parentItemId', 'componentItemId'],
  { unique: true },
)
export class ItemCatalogRecipe {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index('idx_rec_v8_recipe_catalog_version')
  @Column({ type: 'varchar', length: 128 })
  catalogVersionId!: string;

  @Column({ type: 'bigint' })
  parentItemId!: number;

  @Column({ type: 'bigint' })
  componentItemId!: number;

  @Column({ type: 'int' })
  componentOrder!: number;
}
