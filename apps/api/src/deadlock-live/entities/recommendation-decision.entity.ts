import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('recommendation_decisions_v8')
export class RecommendationDecisionV8 {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  decisionId!: string;

  @Index('idx_recommendation_decisions_v8_event_id', { unique: true })
  @Column({ type: 'varchar', length: 128 })
  eventId!: string;

  @Index('idx_recommendation_decisions_v8_match_id')
  @Column({ type: 'varchar', length: 128 })
  matchId!: string;

  @Column({ type: 'varchar', length: 255 })
  playerKey!: string;

  @Index('idx_recommendation_decisions_v8_decided_at')
  @Column({ type: 'timestamptz' })
  decidedAt!: Date;

  @Column({ type: 'int', nullable: true })
  gameTimeMs?: number;

  @Column({ type: 'varchar', length: 128 })
  stateRevision!: string;

  @Column({ type: 'varchar', length: 128 })
  candidateGeneratorVersion!: string;

  @Column({ type: 'varchar', length: 128 })
  rulesetVersion!: string;

  @Column({ type: 'char', length: 64 })
  catalogSha256!: string;

  @Column({ type: 'varchar', length: 255 })
  selectedActionKey!: string;

  @Column({ type: 'varchar', length: 128 })
  modelVersion!: string;

  @Column({ type: 'double precision' })
  policyProbability!: number;

  @Column({ type: 'varchar', length: 128, nullable: true })
  experimentId?: string;

  @Column({ type: 'varchar', length: 128 })
  experimentArm!: string;

  @Column({ type: 'varchar', length: 128 })
  assignmentVersion!: string;

  @Column({ type: 'double precision' })
  loggingPropensity!: number;

  @Column({ type: 'boolean' })
  randomized!: boolean;

  @Column({ type: 'boolean', default: false })
  observedActionInjected!: boolean;
}
