import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('adaptive_recommendation_decisions_v1')
@Index('idx_adaptive_decisions_v1_match_player_time', ['matchId', 'playerKey', 'decidedAt'])
export class AdaptiveRecommendationDecisionV1Entity {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  decisionId!: string;

  @Index('idx_adaptive_decisions_v1_match_id')
  @Column({ type: 'varchar', length: 128 })
  matchId!: string;

  @Index('idx_adaptive_decisions_v1_player_key')
  @Column({ type: 'varchar', length: 255 })
  playerKey!: string;

  @Index('idx_adaptive_decisions_v1_state_revision')
  @Column({ type: 'char', length: 64 })
  stateRevision!: string;

  @Column({ type: 'jsonb' })
  replayInput!: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  result!: Record<string, unknown>;

  @Index('idx_adaptive_decisions_v1_decided_at')
  @Column({ type: 'timestamptz' })
  decidedAt!: Date;
}
