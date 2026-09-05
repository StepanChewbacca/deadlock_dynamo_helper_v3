import { PlannerTrajectoryV2 } from './planner-trajectory-v2';

export interface BuildArchetypeFeatureVectorV1 {
  traceId: string;
  heroId: number;
  familyWeights: Readonly<Record<number, number>>;
  orderedFamilyIds: readonly number[];
  normalizedTiming: readonly number[];
  investmentShare: {
    weapon: number;
    vitality: number;
    spirit: number;
  };
  finalSlotShape: {
    weapon: number;
    vitality: number;
    spirit: number;
  };
}

export interface BuildArchetypeV1 {
  schemaVersion: 1;
  archetypeId: string;
  heroId: number;
  patchId: string;
  rulesetId: string;
  support: number;
  stability: number;
  representativeTraceId: string;
  memberTraceIds: readonly string[];
  representativeFamilyIds: readonly number[];
  withinClusterDistance: number;
  nearestOtherClusterDistance?: number;
  sourceTraceCount: number;
}

export interface BuildArchetypeMiningConfigV1 {
  distanceThreshold: number;
  minClusterSize: number;
}

export interface BuildArchetypeMiningResultV1 {
  archetypes: readonly BuildArchetypeV1[];
  noiseTraceIds: readonly string[];
  pairwiseDistances: Readonly<Record<string, number>>;
  traceCount: number;
}

export interface BuildArchetypeClusterV1 {
  members: readonly PlannerTrajectoryV2[];
}
