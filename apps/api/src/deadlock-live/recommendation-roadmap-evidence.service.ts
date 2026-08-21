import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  RecommendationRoadmapEvidenceRecordV1,
  RecommendationRoadmapEvidenceV1,
  RecommendationRoadmapGateStateV1,
  RecommendationRoadmapStateReportV1,
  assertRecommendationRoadmapEvidenceRecordV1,
  evaluateRecommendationRoadmapStateV1,
} from '@deadlock-live-probe/shared';
import { RecommendationRoadmapEvidenceEntityV1 } from './entities/recommendation-roadmap-evidence.entity';

export interface AppendRecommendationRoadmapEvidenceResultV1 {
  status: 'APPENDED' | 'DUPLICATE';
  evidenceId: string;
}

export interface RecommendationRoadmapEvidenceReportV1 {
  generatedAt: string;
  evidence: RecommendationRoadmapEvidenceV1;
  state: RecommendationRoadmapStateReportV1;
  latestEvidenceByGate: Readonly<Record<string, RecommendationRoadmapEvidenceRecordV1 | undefined>>;
}

@Injectable()
export class RecommendationRoadmapEvidenceService {
  constructor(
    @InjectRepository(RecommendationRoadmapEvidenceEntityV1)
    private readonly evidenceRepo: Repository<RecommendationRoadmapEvidenceEntityV1>,
  ) {}

  async append(record: RecommendationRoadmapEvidenceRecordV1): Promise<AppendRecommendationRoadmapEvidenceResultV1> {
    assertRecommendationRoadmapEvidenceRecordV1(record);
    const existing = await this.evidenceRepo.findOne({ where: { evidenceId: record.evidenceId } });
    if (existing) {
      if (JSON.stringify(existing.record) !== JSON.stringify(record)) {
        throw new Error(`Immutable roadmap evidence conflict: ${record.evidenceId}`);
      }
      return { status: 'DUPLICATE', evidenceId: record.evidenceId };
    }
    try {
      await this.evidenceRepo.save(this.evidenceRepo.create({
        evidenceId: record.evidenceId,
        gateName: record.gateName,
        status: record.status,
        evidenceRef: record.evidenceRef,
        evaluator: record.evaluator,
        evaluatedAt: new Date(record.evaluatedAt),
        subjectSha256: record.subjectSha256,
        notes: record.notes,
        record,
      }));
      return { status: 'APPENDED', evidenceId: record.evidenceId };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.evidenceRepo.findOne({ where: { evidenceId: record.evidenceId } });
      if (!raced || JSON.stringify(raced.record) !== JSON.stringify(record)) {
        throw new Error(`Immutable roadmap evidence conflict: ${record.evidenceId}`);
      }
      return { status: 'DUPLICATE', evidenceId: record.evidenceId };
    }
  }

  async report(): Promise<RecommendationRoadmapEvidenceReportV1> {
    const rows = await this.evidenceRepo.find({ order: { evaluatedAt: 'ASC', recordedAt: 'ASC' } });
    const latest = new Map<string, RecommendationRoadmapEvidenceRecordV1>();
    for (const row of rows) latest.set(row.gateName, row.record);
    const gate = (name: keyof RecommendationRoadmapEvidenceV1): RecommendationRoadmapGateStateV1 =>
      latest.get(name)?.status ?? 'NOT_EVALUATED';
    const futureTestRecord = latest.get('futureTestUntouched');
    const evidence: RecommendationRoadmapEvidenceV1 = {
      canonicalGepV2: gate('canonicalGepV2'),
      controlledSoulsValidation: gate('controlledSoulsValidation'),
      versionedRulesetCatalog: gate('versionedRulesetCatalog'),
      deterministicLegality: gate('deterministicLegality'),
      recommendationTelemetryV8: gate('recommendationTelemetryV8'),
      observabilityCoverage: gate('observabilityCoverage'),
      datasetV8Structural: gate('datasetV8Structural'),
      datasetV8Empirical: gate('datasetV8Empirical'),
      behavioralOffline: gate('behavioralOffline'),
      shadowSafety: gate('shadowSafety'),
      matchLevelAbSafety: gate('matchLevelAbSafety'),
      exactActionPropensity: gate('exactActionPropensity'),
      safeExplorationSafety: gate('safeExplorationSafety'),
      valueActionSensitivity: gate('valueActionSensitivity'),
      offPolicySupport: gate('offPolicySupport'),
      causalValueRelease: gate('causalValueRelease'),
      policyAbRelease: gate('policyAbRelease'),
      sequentialRlResearchGate: gate('sequentialRlResearchGate'),
      futureTestUntouched: futureTestRecord ? futureTestRecord.status === 'PASS' : true,
    };
    return {
      generatedAt: new Date().toISOString(),
      evidence,
      state: evaluateRecommendationRoadmapStateV1(evidence),
      latestEvidenceByGate: Object.fromEntries(latest.entries()),
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
