import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SoulsAffordabilityControlledObservationV2,
  SoulsAffordabilityEvidenceV2Report,
  evaluateSoulsAffordabilityEvidenceV2,
  validateControlledSoulsObservationV2,
} from '@deadlock-live-probe/shared';
import { SoulsAffordabilityEvidenceV2Entity } from './entities/souls-affordability-evidence-v2.entity';

export interface AppendSoulsAffordabilityEvidenceV2Result {
  status: 'APPENDED' | 'DUPLICATE';
  observationId: string;
}

@Injectable()
export class SoulsAffordabilityEvidenceV2Service {
  constructor(
    @InjectRepository(SoulsAffordabilityEvidenceV2Entity)
    private readonly evidenceRepo: Repository<SoulsAffordabilityEvidenceV2Entity>,
  ) {}

  async append(
    observation: SoulsAffordabilityControlledObservationV2,
  ): Promise<AppendSoulsAffordabilityEvidenceV2Result> {
    const errors = validateControlledSoulsObservationV2(observation);
    if (errors.length > 0) {
      throw new Error(`Invalid controlled souls observation ${observation.observationId}: ${errors.join(',')}`);
    }
    const existing = await this.evidenceRepo.findOne({ where: { observationId: observation.observationId } });
    if (existing) {
      if (JSON.stringify(existing.observation) !== JSON.stringify(observation)) {
        throw new Error(`Immutable controlled souls observation conflict: ${observation.observationId}`);
      }
      return { status: 'DUPLICATE', observationId: observation.observationId };
    }
    try {
      await this.evidenceRepo.save(this.evidenceRepo.create({
        observationId: observation.observationId,
        sessionId: observation.sessionId,
        rulesetVersion: observation.rulesetVersion,
        catalogSha256: observation.catalogSha256,
        observation,
      }));
      return { status: 'APPENDED', observationId: observation.observationId };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.evidenceRepo.findOne({ where: { observationId: observation.observationId } });
      if (!raced || JSON.stringify(raced.observation) !== JSON.stringify(observation)) {
        throw new Error(`Immutable controlled souls observation conflict: ${observation.observationId}`);
      }
      return { status: 'DUPLICATE', observationId: observation.observationId };
    }
  }

  async report(): Promise<SoulsAffordabilityEvidenceV2Report> {
    const rows = await this.evidenceRepo.find({ order: { createdAt: 'ASC', observationId: 'ASC' } });
    return evaluateSoulsAffordabilityEvidenceV2(rows.map((row) => row.observation));
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
