import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('item_catalog_recipes')
@Index(
  'idx_item_catalog_recipes_version_parent_component',
  ['catalogVersionId', 'parentItemId', 'componentItemId'],
  { unique: true },
)
export class ItemCatalogRecipe {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index('idx_item_catalog_recipes_catalog_version_id')
  @Column({ type: 'varchar', length: 128 })
  catalogVersionId!: string;

  @Column({ type: 'bigint' })
  parentItemId!: number;

  @Column({ type: 'bigint' })
  componentItemId!: number;

  @Column({ type: 'int' })
  componentOrder!: number;
}
