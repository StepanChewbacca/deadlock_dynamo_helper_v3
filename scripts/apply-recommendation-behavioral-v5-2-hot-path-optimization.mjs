import { readFile, writeFile } from 'node:fs/promises';

const path = 'apps/api/src/deadlock-live/recommendation-behavioral-v5-2.ts';
let source = await readFile(path, 'utf8');

const fullValidatorMarker = 'export function validateRecommendationBehavioralV52Model(\n';
if (!source.includes(fullValidatorMarker)) {
  throw new Error('Behavioral V5.2 full validator marker is missing.');
}
if (source.includes('function validateRecommendationBehavioralV52ModelHeader(')) {
  throw new Error('Behavioral V5.2 hot-path validator is already present.');
}

const helper = `function validateRecommendationBehavioralV52ModelHeader(\n  model: RecommendationBehavioralV52Model,\n): void {\n  if (\n    model.schemaVersion !== RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION ||\n    model.modelVersion !== RECOMMENDATION_BEHAVIORAL_V5_2_MODEL_VERSION ||\n    model.featureVersion !== RECOMMENDATION_BEHAVIORAL_V5_2_FEATURE_VERSION ||\n    model.probabilityContract !==\n      RECOMMENDATION_BEHAVIORAL_V5_2_PROBABILITY_CONTRACT\n  ) {\n    throw new Error('Unsupported Recommendation Behavioral V5.2 model.');\n  }\n  validateModelConfig({\n    linearHashDimension: model.linearHashDimension,\n    embeddingHashDimension: model.embeddingHashDimension,\n    latentDimension: model.latentDimension,\n    candidateInitializationScale: model.candidateInitializationScale,\n  });\n  if (\n    !Number.isFinite(model.candidateInitializationScale) ||\n    model.candidateInitializationScale <= 0 ||\n    model.candidateInitializationScale > 1\n  ) {\n    throw new Error('Invalid Recommendation Behavioral V5.2 model initialization scale.');\n  }\n  const expectedEmbeddingValueCount =\n    model.embeddingHashDimension * model.latentDimension;\n  if (\n    model.linearWeights.length !== model.linearHashDimension ||\n    model.contextEmbeddings.length !== expectedEmbeddingValueCount ||\n    model.candidateEmbeddings.length !== expectedEmbeddingValueCount ||\n    !Number.isSafeInteger(model.trainedDecisionCount) ||\n    model.trainedDecisionCount < 0 ||\n    !Number.isSafeInteger(model.updateCount) ||\n    model.updateCount < 0\n  ) {\n    throw new Error('Invalid Recommendation Behavioral V5.2 model shape.');\n  }\n}\n\n`;

source = source.replace(fullValidatorMarker, `${helper}${fullValidatorMarker}`);

function replaceHotPathValidation(functionName) {
  const startMarker = `export function ${functionName}(`;
  const start = source.indexOf(startMarker);
  if (start < 0) {
    throw new Error(`Missing ${functionName}.`);
  }
  const nextExport = source.indexOf('\nexport function ', start + startMarker.length);
  const end = nextExport < 0 ? source.length : nextExport;
  const block = source.slice(start, end);
  const needle = '  validateRecommendationBehavioralV52Model(model);';
  const count = block.split(needle).length - 1;
  if (count !== 1) {
    throw new Error(`${functionName} expected exactly one full-model validation call, found ${count}.`);
  }
  const optimized = block.replace(
    needle,
    '  validateRecommendationBehavioralV52ModelHeader(model);',
  );
  source = `${source.slice(0, start)}${optimized}${source.slice(end)}`;
}

replaceHotPathValidation('trainRecommendationBehavioralV52Decision');
replaceHotPathValidation('predictRecommendationBehavioralV52');

const remainingFullCalls = source.match(/validateRecommendationBehavioralV52Model\(model\);/g)?.length ?? 0;
if (remainingFullCalls < 2) {
  throw new Error('Boundary full-model validation calls were unexpectedly removed.');
}

await writeFile(path, source, 'utf8');
console.log('Applied Behavioral V5.2 O(1) hot-path model validation optimization.');
