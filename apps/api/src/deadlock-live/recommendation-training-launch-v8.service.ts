import { Injectable } from '@nestjs/common';
import {
  RecommendationBehavioralTrainingConfigV1,
  RecommendationBehavioralTrainingLaunchReportV1,
  evaluateRecommendationBehavioralTrainingLaunchV1,
} from '@deadlock-live-probe/shared';
import { RecommendationDatasetRegistryService } from './recommendation-dataset-registry.service';
import { RecommendationRoadmapEvidenceService } from './recommendation-roadmap-evidence.service';

export interface RecommendationTrainingLaunchPreflightV8 {
  ready: boolean;
  datasetId: string;
  datasetSha256: string;
  manifestSha256: string;
  objectBaseUri: string;
  datasetRegistryStatus: 'VERIFIED';
  training: RecommendationBehavioralTrainingLaunchReportV1;
  blockers: readonly string[];
}

@Injectable()
export class RecommendationTrainingLaunchV8Service {
  constructor(
    private readonly datasetRegistry: RecommendationDatasetRegistryService,
    private readonly roadmapEvidence: RecommendationRoadmapEvidenceService,
  ) {}

  async preflight(
    datasetId: string,
    config: RecommendationBehavioralTrainingConfigV1,
  ): Promise<RecommendationTrainingLaunchPreflightV8> {
    if (!datasetId) throw new Error('datasetId is required');
    const [dataset, roadmap] = await Promise.all([
      this.datasetRegistry.getVerified(datasetId),
      this.roadmapEvidence.report(),
    ]);
    const training = evaluateRecommendationBehavioralTrainingLaunchV1({
      manifest: dataset.manifest,
      evidence: roadmap.evidence,
      config,
    });
    const blockers = [...training.blockers];
    if (dataset.manifestSha256 !== dataset.verification?.verifiedManifestSha256) {
      blockers.push('DATASET_REGISTRY_VERIFICATION_MISMATCH');
    }
    if (dataset.datasetSha256 !== dataset.manifest.datasetSha256) {
      blockers.push('DATASET_REGISTRY_SHA_MISMATCH');
    }

    return {
      ready: blockers.length === 0,
      datasetId: dataset.datasetId,
      datasetSha256: dataset.datasetSha256,
      manifestSha256: dataset.manifestSha256,
      objectBaseUri: dataset.objectBaseUri,
      datasetRegistryStatus: 'VERIFIED',
      training,
      blockers: [...new Set(blockers)].sort(),
    };
  }
}
