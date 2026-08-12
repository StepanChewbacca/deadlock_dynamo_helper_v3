import { readFile, writeFile } from 'node:fs/promises';

const path = 'apps/api/src/deadlock-live/recommendation-behavioral-v6.ts';
let source = await readFile(path, 'utf8');

const fullValidatorCall = '  validateRecommendationBehavioralV6Model(model);';
const trainMarker = 'export function trainRecommendationBehavioralV6Decision(';
const predictMarker = 'export function predictRecommendationBehavioralV6(';
const helperMarker = 'function validateRecommendationBehavioralV6ModelHeader(';

if (source.includes(helperMarker)) {
  throw new Error('Behavioral V6 hot-path validator helper already exists.');
}

const fullCallCount = occurrences(source, fullValidatorCall);
if (fullCallCount < 2) {
  throw new Error(`Expected at least two full V6 validator calls, received ${fullCallCount}.`);
}

source = replaceInFunction(source, trainMarker, predictMarker, fullValidatorCall, '  validateRecommendationBehavioralV6ModelHeader(model);');
source = replaceInFunction(source, predictMarker, 'export function recommendationBehavioralV6FoldId(', fullValidatorCall, '  validateRecommendationBehavioralV6ModelHeader(model);');

const insertionMarker = '\nexport function trainRecommendationBehavioralV6Decision(';
const helper = `
function validateRecommendationBehavioralV6ModelHeader(
  model: RecommendationBehavioralV6Model,
): void {
  if (
    model.schemaVersion !== RECOMMENDATION_BEHAVIORAL_V6_SCHEMA_VERSION ||
    model.modelVersion !== RECOMMENDATION_BEHAVIORAL_V6_MODEL_VERSION ||
    model.featureVersion !== RECOMMENDATION_BEHAVIORAL_V6_FEATURE_VERSION ||
    model.probabilityContract !== RECOMMENDATION_BEHAVIORAL_V6_PROBABILITY_CONTRACT ||
    model.optimizerContract !== RECOMMENDATION_BEHAVIORAL_V6_OPTIMIZER_CONTRACT
  ) {
    throw new Error('Unsupported Recommendation Behavioral V6 model.');
  }
  validateModelConfig(model);
  const embeddingValueCount =
    model.embeddingHashDimension * model.latentDimension;
  if (
    model.linearWeights.length !== model.linearHashDimension ||
    model.contextEmbeddings.length !== embeddingValueCount ||
    model.candidateEmbeddings.length !== embeddingValueCount ||
    !Number.isSafeInteger(model.trainedDecisionCount) ||
    model.trainedDecisionCount < 0 ||
    !Number.isSafeInteger(model.updateCount) ||
    model.updateCount < 0
  ) {
    throw new Error('Invalid Recommendation Behavioral V6 model header.');
  }
}
`;

if (!source.includes(insertionMarker)) {
  throw new Error('Behavioral V6 train function insertion marker is missing.');
}
source = source.replace(insertionMarker, `${helper}${insertionMarker}`);

if (occurrences(source, 'validateRecommendationBehavioralV6ModelHeader(model);') !== 2) {
  throw new Error('Expected exactly two V6 hot-path header validator calls.');
}
if (occurrences(source, fullValidatorCall) < 0) {
  throw new Error('Behavioral V6 full validator unexpectedly disappeared.');
}

await writeFile(path, source, 'utf8');
console.log('Applied Behavioral V6 O(1) hot-path model-header validation.');

function replaceInFunction(value, startMarker, endMarker, search, replacement) {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Unable to locate function segment ${startMarker}.`);
  }
  const segment = value.slice(start, end);
  if (occurrences(segment, search) !== 1) {
    throw new Error(`Expected one validator call inside ${startMarker}.`);
  }
  return value.slice(0, start) + segment.replace(search, replacement) + value.slice(end);
}

function occurrences(value, search) {
  return value.split(search).length - 1;
}
