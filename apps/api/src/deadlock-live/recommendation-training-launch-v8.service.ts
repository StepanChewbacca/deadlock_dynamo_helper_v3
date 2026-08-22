import { Injectable } from '@nestjs/common';
import {
  RecommendationBehavioralTrainingConfigV1,
  RecommendationBehavioralTrainingLaunchReportV1,
  evaluateRecommendationBehavioralTrainingLaunchV1,
} from '@deadlock-live-probe/shared';
import { RecommendationDatasetRegistryService } from './recommendation-dataset-registry.service';
import { RecommendationDatasetV8ReportService } from './recommendation-dataset-v8-report.service';
import { RecommendationObservabilityReportService } from './recommendation-observability-report.service';
import { RecommendationRoadmapEvidenceService } from './recommendation-roadmap-evidence.service';
import { SoulsAffordabilityEvidenceV2Service } from './souls-affordability-evidence-v2.service';

export interface RecommendationTrainingLaunchPreflightV8 {
  ready: boolean;
  datasetId: string;
  datasetSha256: string;
  manifestSha256: string;
  objectBaseUri: string;
  datasetRegistryStatus: 'VERIFIED';
  training: RecommendationBehavioralTrainingLaunchReportV1;
  currentDataGates: {
    from: string;
    to: string;
    candidateGeneratorVersion: string;
    controlledSoulsValidation: 'PASS' | 'FAIL' | 'INSUFFICIENT_EVIDENCE';
    observabilityPassed: boolean;
    datasetStructuralPassed: boolean;
    datasetEmpiricalPassed: boolean;
    explicitFeasibilityCoverage: number;
    observedActionFeasibleCoverage: number;
    minimumMajorActionPhaseCohortObservedActionFeasibleCoverage: number;
    rulesetEvidenceCoverage: number;
  };
  blockers: readonly string[];
}

@Injectable()
export class RecommendationTrainingLaunchV8Service {
  constructor(
    private readonly datasetRegistry: RecommendationDatasetRegistryService,
    private readonly roadmapEvidence: RecommendationRoadmapEvidenceService,
    private readonly datasetReport: RecommendationDatasetV8ReportService,
    private readonly observabilityReport: RecommendationObservabilityReportService,
    private readonly soulsEvidence: SoulsAffordabilityEvidenceV2Service,
  ) {}

  async preflight(
    datasetId: string,
    config: RecommendationBehavioralTrainingConfigV1,
  ): Promise<RecommendationTrainingLaunchPreflightV8> {
    if (!datasetId) throw new Error('datasetId is required');
    const dataset = await this.datasetRegistry.getVerified(datasetId);
    const candidateGeneratorVersion = dataset.manifest.candidateGeneratorVersion?.trim();
    if (!candidateGeneratorVersion) throw new Error('Verified dataset candidateGeneratorVersion is missing');
    const window = developmentWindow(dataset.manifest.splits);
    const [roadmap, currentDataset, currentObservability, currentSouls] = await Promise.all([
      this.roadmapEvidence.report(),
      this.datasetReport.buildReport({
        from: window.from,
        to: window.to,
        candidateGeneratorVersion,
      }),
      this.observabilityReport.buildReport({
        from: window.from,
        to: window.to,
        candidateGeneratorVersion,
      }),
      this.soulsEvidence.report(),
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
    if (currentDataset.candidateGeneratorVersion !== candidateGeneratorVersion) {
      blockers.push('CURRENT_DATASET_CANDIDATE_GENERATOR_SCOPE_MISMATCH');
    }
    if (currentObservability.candidateGeneratorVersion !== candidateGeneratorVersion) {
      blockers.push('CURRENT_OBSERVABILITY_CANDIDATE_GENERATOR_SCOPE_MISMATCH');
    }
    if (currentSouls.verdict !== 'PASS' || !currentSouls.canMarkSpendableSoulsVerified) {
      blockers.push(`CURRENT_CONTROLLED_SOULS_${currentSouls.verdict}`);
    }
    if (!currentObservability.gate.passed) {
      blockers.push(...currentObservability.gate.blockers.map((blocker) => `CURRENT_OBSERVABILITY:${blocker}`));
    }
    if (!currentDataset.passedStructuralGate) {
      blockers.push(...currentDataset.blockers.map((blocker) => `CURRENT_DATASET_STRUCTURAL:${blocker}`));
    }
    if (!currentDataset.passedEmpiricalGate) {
      blockers.push(...currentDataset.blockers.map((blocker) => `CURRENT_DATASET_EMPIRICAL:${blocker}`));
    }
    if (!roadmap.evidence.futureTestUntouched) blockers.push('FUTURE_TEST_INTEGRITY_VIOLATION');
    if ((roadmap.evidence.futureTestEvaluation ?? 'NOT_EVALUATED') !== 'NOT_EVALUATED') {
      blockers.push('FUTURE_TEST_ALREADY_EVALUATED');
    }

    return {
      ready: blockers.length === 0,
      datasetId: dataset.datasetId,
      datasetSha256: dataset.datasetSha256,
      manifestSha256: dataset.manifestSha256,
      objectBaseUri: dataset.objectBaseUri,
      datasetRegistryStatus: 'VERIFIED',
      training,
      currentDataGates: {
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        candidateGeneratorVersion,
        controlledSoulsValidation: currentSouls.verdict,
        observabilityPassed: currentObservability.gate.passed,
        datasetStructuralPassed: currentDataset.passedStructuralGate,
        datasetEmpiricalPassed: currentDataset.passedEmpiricalGate,
        explicitFeasibilityCoverage: currentDataset.explicitFeasibilityCoverage,
        observedActionFeasibleCoverage: currentDataset.observedActionFeasibleCoverage,
        minimumMajorActionPhaseCohortObservedActionFeasibleCoverage:
          currentDataset.minimumMajorActionPhaseCohortObservedActionFeasibleCoverage,
        rulesetEvidenceCoverage: currentDataset.rulesetEvidenceCoverage,
      },
      blockers: [...new Set(blockers)].sort(),
    };
  }
}

function developmentWindow(
  splits: readonly { split: string; from: string; to: string }[],
): { from: Date; to: Date } {
  const train = splits.find((split) => split.split === 'TRAIN');
  const shadow = splits.find((split) => split.split === 'SHADOW_HOLDOUT');
  if (!train || !shadow) throw new Error('Dataset development split descriptors are missing');
  const from = new Date(train.from);
  const to = new Date(shadow.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new Error('Dataset development window is invalid');
  }
  return { from, to };
}
