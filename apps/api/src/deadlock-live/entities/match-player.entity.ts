import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
  OneToMany,
} from 'typeorm';
import { Match } from './match.entity';
import { MatchPlayerItem } from './match-player-item.entity';
import { MatchPlayerSkillUpgrade } from './match-player-skill-upgrade.entity';

@Entity('match_players')
@Unique(['matchId', 'heroId'])
@Index('idx_match_players_hero_id', ['heroId'])
@Index('idx_match_players_match_account_id', ['matchId', 'accountId'])
export class MatchPlayer {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'bigint' })
  matchId!: number;

  @ManyToOne(() => Match, (m) => m.players, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'matchId', referencedColumnName: 'matchId' })
  match!: Match;

  @Column({ type: 'int' })
  heroId!: number;

  @Column({ type: 'bigint', nullable: true })
  accountId!: number;

  @Column({ type: 'int' })
  team!: number;

  @Column({ type: 'boolean' })
  won!: boolean;

  @Column({ type: 'int', nullable: true })
  kills!: number;

  @Column({ type: 'int', nullable: true })
  deaths!: number;

  @Column({ type: 'int', nullable: true })
  assists!: number;

  @Column({ type: 'int', nullable: true })
  netWorth!: number;

  @OneToMany(() => MatchPlayerItem, (item) => item.matchPlayer, { cascade: true })
  itemPurchases!: MatchPlayerItem[];

  @OneToMany(() => MatchPlayerSkillUpgrade, (skill) => skill.matchPlayer, { cascade: true })
  skillUpgrades!: MatchPlayerSkillUpgrade[];

  @CreateDateColumn()
  crawledAt!: Date;
}
