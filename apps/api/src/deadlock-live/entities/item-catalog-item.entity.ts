import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('item_catalog_items')
@Index('idx_item_catalog_items_version_item', ['catalogVersionId', 'itemId'], { unique: true })
export class ItemCatalogItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index('idx_item_catalog_items_catalog_version_id')
  @Column({ type: 'varchar', length: 128 })
  catalogVersionId!: string;

  @Column({ type: 'bigint' })
  itemId!: number;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  className?: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  itemType?: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  slotType?: string;

  @Column({ type: 'int', nullable: true })
  cost?: number;

  @Column({ type: 'int', nullable: true })
  tier?: number;

  @Column({ type: 'boolean', nullable: true })
  shopable?: boolean;

  @Column({ type: 'boolean', nullable: true })
  disabled?: boolean;

  @Column({ type: 'boolean', nullable: true })
  active?: boolean;

  @Column({ type: 'boolean', nullable: true })
  isActiveItem?: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true })
  activationType?: string;

  @Column({ type: 'jsonb' })
  rawPayload!: Record<string, unknown>;
}
