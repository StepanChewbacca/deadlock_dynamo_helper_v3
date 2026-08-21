import {
  RecommendationBehavioralV8Decision,
  RecommendationBehavioralV8LinearModel,
  RecommendationBehavioralV8ModelFamily,
  RecommendationBehavioralV8Prediction,
  predictRecommendationBehavioralV8Linear,
  validateRawBehaviorProbabilityVectorV8,
} from './recommendation-behavioral-v8';

export const RECOMMENDATION_BEHAVIORAL_RUNTIME_VERSION = 'recommendation-behavioral-runtime-v1' as const;

export interface RecommendationBehavioralRuntimePredictorV1 {
  runtimeContract: typeof RECOMMENDATION_BEHAVIORAL_RUNTIME_VERSION;
  family: RecommendationBehavioralV8ModelFamily;
  modelVersion: string;
  featureContractVersion: string;
  predict(decision: RecommendationBehavioralV8Decision): RecommendationBehavioralV8Prediction;
}

export function createRecommendationBehavioralLinearRuntimePredictorV1(
  model: RecommendationBehavioralV8LinearModel,
): RecommendationBehavioralRuntimePredictorV1 {
  return {
    runtimeContract: RECOMMENDATION_BEHAVIORAL_RUNTIME_VERSION,
    family: model.family,
    modelVersion: model.modelVersion,
    featureContractVersion: model.featureContractVersion,
    predict: (decision) => predictRecommendationBehavioralV8Linear(model, decision),
  };
}

export function assertRecommendationBehavioralRuntimePredictionV1(
  predictor: RecommendationBehavioralRuntimePredictorV1,
  decision: RecommendationBehavioralV8Decision,
  prediction: RecommendationBehavioralV8Prediction,
): void {
  if (predictor.runtimeContract !== RECOMMENDATION_BEHAVIORAL_RUNTIME_VERSION) {
    throw new Error('Behavioral runtime predictor contract mismatch');
  }
  if (!predictor.modelVersion) throw new Error('Behavioral runtime modelVersion is required');
  if (predictor.featureContractVersion !== decision.state.contractVersion) {
    throw new Error('Behavioral runtime feature contract mismatch');
  }
  if (prediction.decisionId !== decision.decisionId) throw new Error('Behavioral runtime decisionId mismatch');
  validateRawBehaviorProbabilityVectorV8(prediction);
  const expected = [...decision.candidates.map((candidate) => candidate.actionKey)].sort();
  const actual = [...prediction.candidates.map((candidate) => candidate.actionKey)].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error('Behavioral runtime prediction must cover exactly the feasible choice set');
  }
}

export function predictRecommendationBehavioralRuntimeV1(
  predictor: RecommendationBehavioralRuntimePredictorV1,
  decision: RecommendationBehavioralV8Decision,
): RecommendationBehavioralV8Prediction {
  const prediction = predictor.predict(decision);
  assertRecommendationBehavioralRuntimePredictionV1(predictor, decision, prediction);
  return prediction;
}
