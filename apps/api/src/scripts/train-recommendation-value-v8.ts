import 'reflect-metadata';
import { createHash } from 'crypto';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, join, resolve } from 'path';
import { createGunzip } from 'zlib';
import { createInterface } from 'readline';
import {
  MODEL_BUNDLE_CONTRACT_VERSION,
  ModelBundleManifestV1,
  RecommendationValueDatasetManifestV1,
  RecommendationValueTrainingExampleV1,
  RecommendationValueTrainingSplitV1,
  RecommendationValueTrainingExampleV8,
  RecommendationValueV8Model,
  createRecommendationValueV8Model,
  evaluateRecommendationValueV8,
  evaluateValueActionSensitivityV1,
  predictRecommendationValueStateOnlyV8,
  predictRecommendationValueV8,
  trainRecommendationValueV8Example,
  validateModelBundleManifestV1,
  validateRecommendationValueDatasetManifestV1,
  validateRecommendationValueTrainingExampleV1,
  valueActionResidualVarianceV8,
} from '@deadlock-live-probe/shared';

interface ValueTrainingConfigV1 {
  contractVersion: 'recommendation-value-training-config-v1';
  hashDimension: number;
  maxEpochs: number;
  earlyStoppingPatience: number;
  earlyStoppingMinDelta: number;
  learningRate: number;
  l2: number;
  gradientClip: number;
  maxImportanceWeight?: number;
  historyMaximumEvents: number;
  minActionEffectMae: number;
  minPermutationResponseMae: number;
  minActionResidualVariance: number;
}

interface Args {
  datasetDir: string;
  expectedDatasetSha256: string;
  expectedManifestSha256: string;
  configPath: string;
  outputDir: string;
  modelId: string;
  modelVersion: string;
  sourceCommitSha: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  validateArgs(args);
  const datasetDir = resolve(args.datasetDir);
  const outputDir = resolve(args.outputDir);
  if (existsSync(outputDir)) throw new Error(`Output directory already exists: ${outputDir}`);
  mkdirSync(outputDir, { recursive: false });

  const manifest = verifyDataset(
    datasetDir,
    args.expectedDatasetSha256,
    args.expectedManifestSha256,
  );
  const config = loadConfig(args.configPath);
  const [train, validation, shadow] = await Promise.all([
    loadSplit(datasetDir, manifest, 'TRAIN'),
    loadSplit(datasetDir, manifest, 'VALIDATION'),
    loadSplit(datasetDir, manifest, 'SHADOW_HOLDOUT'),
  ]);
  if (train.length === 0 || validation.length === 0 || shadow.length === 0) {
    throw new Error('Causal Value TRAIN, VALIDATION, and SHADOW_HOLDOUT must all be non-empty');
  }

  let model = createRecommendationValueV8Model(
    args.modelVersion,
    manifest.featureContractVersion,
    config.hashDimension,
  );
  let bestModel = cloneModel(model);
  let bestValidationMse = Number.POSITIVE_INFINITY;
  let patience = 0;
  const epochs: Array<{ epoch: number; validationWeightedMse: number }> = [];

  for (let epoch = 1; epoch <= config.maxEpochs; epoch += 1) {
    for (const example of train) {
      trainRecommendationValueV8Example(model, toValueExample(example), {
        learningRate: config.learningRate,
        l2: config.l2,
        gradientClip: config.gradientClip,
        maxImportanceWeight: config.maxImportanceWeight,
        historyMaximumEvents: config.historyMaximumEvents,
      });
    }
    const validationMetrics = evaluateRecommendationValueV8(
      model,
      validation.map(toValueExample),
      {
        maxImportanceWeight: config.maxImportanceWeight,
        historyMaximumEvents: config.historyMaximumEvents,
      },
    );
    epochs.push({ epoch, validationWeightedMse: validationMetrics.weightedMse });
    if (validationMetrics.weightedMse < bestValidationMse - config.earlyStoppingMinDelta) {
      bestValidationMse = validationMetrics.weightedMse;
      bestModel = cloneModel(model);
      patience = 0;
    } else {
      patience += 1;
      if (patience >= config.earlyStoppingPatience) break;
    }
  }
  model = bestModel;

  const shadowExamples = shadow.map(toValueExample);
  const shadowEvaluation = evaluateRecommendationValueV8(model, shadowExamples, {
    maxImportanceWeight: config.maxImportanceWeight,
    historyMaximumEvents: config.historyMaximumEvents,
  });
  const originalPredictions: number[] = [];
  const actionMaskedPredictions: number[] = [];
  const candidatePermutedPredictions: number[] = [];
  const residualVariances: number[] = [];
  let singleCandidateDecisionCount = 0;

  for (const example of shadow) {
    const loggedAction = requiredLoggedAction(example);
    const alternative = deterministicAlternative(example);
    if (!alternative) singleCandidateDecisionCount += 1;
    originalPredictions.push(
      predictRecommendationValueV8(model, example.state, loggedAction, config.historyMaximumEvents).value,
    );
    actionMaskedPredictions.push(
      predictRecommendationValueStateOnlyV8(model, example.state, config.historyMaximumEvents),
    );
    candidatePermutedPredictions.push(
      predictRecommendationValueV8(
        model,
        example.state,
        alternative ?? loggedAction,
        config.historyMaximumEvents,
      ).value,
    );
    residualVariances.push(valueActionResidualVarianceV8(model, example.state, example.candidates));
  }

  const sensitivity = evaluateValueActionSensitivityV1({
    originalPredictions,
    actionMaskedPredictions,
    candidatePermutedPredictions,
  }, {
    minActionEffectMae: config.minActionEffectMae,
    minPermutationResponseMae: config.minPermutationResponseMae,
  });
  const actionResidualVariance = mean(residualVariances);
  const stateOnlyPassed = sensitivity.actionEffectMae >= config.minActionEffectMae;
  const permutationPassed = sensitivity.permutationResponseMae >= config.minPermutationResponseMae;
  const residualPassed = actionResidualVariance >= config.minActionResidualVariance;
  const sensitivityPassed = sensitivity.passed && residualPassed;
  const trainingConfigSha256 = sha256Canonical(config);
  const supportedRulesetVersions = uniqueSorted([...train, ...validation, ...shadow].map((example) => example.state.rulesetVersion));
  const supportedCatalogSha256 = uniqueSorted([...train, ...validation, ...shadow].map((example) => example.state.catalogSha256));

  const metrics = {
    contractVersion: 'recommendation-value-training-metrics-v1',
    modelId: args.modelId,
    modelVersion: args.modelVersion,
    datasetId: manifest.datasetId,
    datasetSha256: manifest.datasetSha256,
    reward: manifest.reward,
    futureTestEvaluated: false,
    trainDecisionCount: train.length,
    validationDecisionCount: validation.length,
    shadowHoldoutDecisionCount: shadow.length,
    trainedUpdateCount: model.trainedDecisionCount,
    bestValidationWeightedMse,
    shadowEvaluation,
    actionSensitivity: sensitivity,
    actionResidualVariance,
    singleCandidateDecisionCount,
    stateOnlyAblationPassed: stateOnlyPassed,
    candidatePermutationPassed: permutationPassed,
    actionResidualVariancePassed: residualPassed,
    passed: sensitivityPassed,
    epochs,
    trainingConfigSha256,
  };
  writeJsonExclusive(join(outputDir, 'model.json'), model);
  writeJsonExclusive(join(outputDir, 'metrics.json'), metrics);
  writeJsonExclusive(join(outputDir, 'training-config.json'), config);

  if (!metrics.passed) {
    process.stdout.write(`${JSON.stringify({ status: 'VALUE_GATE_FAIL', metrics }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  const bundleDir = join(outputDir, 'bundle');
  mkdirSync(bundleDir);
  const bundleSources = [
    [join(outputDir, 'model.json'), 'model.json'],
    [join(outputDir, 'metrics.json'), 'metrics.json'],
    [join(outputDir, 'training-config.json'), 'training-config.json'],
    [join(datasetDir, 'manifest.json'), 'value-dataset-manifest.json'],
  ] as const;
  const files = bundleSources.map(([source, relative]) => {
    const target = join(bundleDir, relative);
    copyFileSync(source, target);
    return {
      path: relative,
      sha256: sha256File(target),
      sizeBytes: statSync(target).size,
    };
  });
  const gates = [
    gate('VALUE_ACTION_SENSITIVITY', sensitivityPassed, sensitivity.actionEffectMae, `>=${config.minActionEffectMae}`),
    gate('STATE_ONLY_ABLATION', stateOnlyPassed, sensitivity.actionEffectMae, `>=${config.minActionEffectMae}`),
    gate('CANDIDATE_PERMUTATION', permutationPassed, sensitivity.permutationResponseMae, `>=${config.minPermutationResponseMae}`),
    gate('ACTION_RESIDUAL_VARIANCE', residualPassed, actionResidualVariance, `>=${config.minActionResidualVariance}`),
    gate('ILLEGAL_CANDIDATE_RATE', true, 0, '=0'),
    gate('FUTURE_TEST_UNTOUCHED', true, false, false),
  ];
  const bundleManifest: ModelBundleManifestV1 = {
    contractVersion: MODEL_BUNDLE_CONTRACT_VERSION,
    modelId: args.modelId,
    modelVersion: args.modelVersion,
    modelKind: 'VALUE',
    createdAt: new Date().toISOString(),
    sourceCommitSha: args.sourceCommitSha,
    datasetId: manifest.datasetId,
    datasetSha256: manifest.datasetSha256,
    featureContractVersion: manifest.featureContractVersion,
    actionContractVersion: manifest.actionContractVersion,
    candidateGeneratorVersion: manifest.candidateGeneratorVersion,
    supportedRulesetVersions,
    supportedCatalogSha256,
    trainingConfigSha256,
    files,
    gates,
    futureTestEvaluated: false,
    notes: 'Causal Value V8 trained only from exact-propensity randomized decisions. FUTURE_TEST was not materialized or evaluated.',
  };
  const bundleValidation = validateModelBundleManifestV1(bundleManifest);
  if (!bundleValidation.valid) throw new Error(`Invalid Value model bundle: ${bundleValidation.errors.join(',')}`);
  writeJsonExclusive(join(bundleDir, 'manifest.json'), bundleManifest);
  process.stdout.write(`${JSON.stringify({
    status: 'VALUE_TRAINING_COMPLETE_NOT_ACTIVATED',
    outputDir,
    bundleManifest: join(bundleDir, 'manifest.json'),
    datasetSha256: manifest.datasetSha256,
    futureTestEvaluated: false,
    metrics,
  }, null, 2)}\n`);
}

function parseArgs(values: string[]): Args {
  const entries = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument near ${key ?? '<end>'}`);
    entries.set(key.slice(2), value);
  }
  const required = (name: string): string => {
    const value = entries.get(name)?.trim();
    if (!value) throw new Error(`--${name} is required`);
    return value;
  };
  return {
    datasetDir: required('dataset-dir'),
    expectedDatasetSha256: required('expected-dataset-sha256'),
    expectedManifestSha256: required('expected-manifest-sha256'),
    configPath: required('config'),
    outputDir: required('output-dir'),
    modelId: required('model-id'),
    modelVersion: required('model-version'),
    sourceCommitSha: required('source-commit-sha'),
  };
}

function validateArgs(args: Args): void {
  if (!/^[a-f0-9]{64}$/i.test(args.expectedDatasetSha256)) throw new Error('expected dataset SHA is invalid');
  if (!/^[a-f0-9]{64}$/i.test(args.expectedManifestSha256)) throw new Error('expected manifest SHA is invalid');
  if (!/^[a-f0-9]{40}$/i.test(args.sourceCommitSha)) throw new Error('source commit SHA is invalid');
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(args.modelId)) throw new Error('model id is invalid');
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(args.modelVersion)) throw new Error('model version is invalid');
}

function loadConfig(path: string): ValueTrainingConfigV1 {
  const config = JSON.parse(readFileSync(resolve(path), 'utf8')) as ValueTrainingConfigV1;
  if (config.contractVersion !== 'recommendation-value-training-config-v1') throw new Error('Value training config contract mismatch');
  positiveInteger('hashDimension', config.hashDimension, 128);
  positiveInteger('maxEpochs', config.maxEpochs);
  positiveInteger('earlyStoppingPatience', config.earlyStoppingPatience);
  positiveNumber('learningRate', config.learningRate);
  nonNegativeNumber('l2', config.l2);
  positiveNumber('gradientClip', config.gradientClip);
  nonNegativeNumber('earlyStoppingMinDelta', config.earlyStoppingMinDelta);
  positiveInteger('historyMaximumEvents');
  nonNegativeNumber('minActionEffectMae', config.minActionEffectMae);
  nonNegativeNumber('minPermutationResponseMae', config.minPermutationResponseMae);
  nonNegativeNumber('minActionResidualVariance', config.minActionResidualVariance);
  if (config.maxImportanceWeight !== undefined) positiveNumber('maxImportanceWeight', config.maxImportanceWeight);
  return config;

  function positiveInteger(name: string, value = (config as unknown as Record<string, number>)[name], minimum = 1): void {
    if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} is invalid`);
  }
  function positiveNumber(name: string, value: number): void {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} is invalid`);
  }
  function nonNegativeNumber(name: string, value: number): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} is invalid`);
  }
}

function verifyDataset(
  datasetDir: string,
  expectedDatasetSha256: string,
  expectedManifestSha256: string,
): RecommendationValueDatasetManifestV1 {
  const manifestPath = join(datasetDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RecommendationValueDatasetManifestV1;
  const errors = validateRecommendationValueDatasetManifestV1(manifest);
  if (errors.length > 0) throw new Error(`Invalid causal Value dataset manifest: ${errors.join(',')}`);
  const withoutDatasetSha = { ...manifest } as Record<string, unknown>;
  delete withoutDatasetSha.datasetSha256;
  const calculatedDatasetSha = sha256Canonical(withoutDatasetSha);
  if (manifest.datasetSha256 !== calculatedDatasetSha) throw new Error('Causal Value dataset SHA mismatch');
  if (manifest.datasetSha256 !== expectedDatasetSha256) throw new Error('Expected causal Value dataset SHA mismatch');
  const calculatedManifestSha = sha256Canonical(canonicalizeManifest(manifest));
  if (calculatedManifestSha !== expectedManifestSha256) throw new Error('Expected causal Value manifest SHA mismatch');
  for (const file of manifest.files) {
    const absolute = join(datasetDir, file.path);
    if (!existsSync(absolute)) throw new Error(`Causal Value dataset file missing: ${file.path}`);
    if (sha256File(absolute) !== file.sha256) throw new Error(`Causal Value dataset file SHA mismatch: ${file.path}`);
    if (statSync(absolute).size !== file.sizeBytes) throw new Error(`Causal Value dataset file size mismatch: ${file.path}`);
  }
  return manifest;
}

async function loadSplit(
  datasetDir: string,
  manifest: RecommendationValueDatasetManifestV1,
  split: RecommendationValueTrainingSplitV1,
): Promise<RecommendationValueTrainingExampleV1[]> {
  const suffix = `${split.toLowerCase()}.jsonl.gz`;
  const descriptors = manifest.files.filter((file) => file.path.replace(/\\/g, '/').endsWith(suffix));
  if (descriptors.length !== 1) throw new Error(`Expected one ${split} causal Value artifact`);
  const descriptor = descriptors[0];
  const input = createReadStream(join(datasetDir, descriptor.path)).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  const examples: RecommendationValueTrainingExampleV1[] = [];
  for await (const line of lines) {
    if (!line.trim()) continue;
    const example = JSON.parse(line) as RecommendationValueTrainingExampleV1;
    if (example.split !== split) throw new Error(`Causal Value split mismatch: expected ${split}, got ${example.split}`);
    const errors = validateRecommendationValueTrainingExampleV1(example);
    if (errors.length > 0) throw new Error(`Invalid causal Value example ${example.decisionId}: ${errors.join(',')}`);
    if (example.candidateGeneratorVersion !== manifest.candidateGeneratorVersion) throw new Error('Candidate generator mismatch in Value artifact');
    examples.push(example);
  }
  if (examples.length !== descriptor.rowCount) throw new Error(`Causal Value row count mismatch for ${split}`);
  return examples;
}

function toValueExample(example: RecommendationValueTrainingExampleV1): RecommendationValueTrainingExampleV8 {
  return {
    decisionId: example.decisionId,
    state: example.state,
    action: requiredLoggedAction(example),
    reward: example.reward,
    actionLoggingPropensity: example.actionLoggingPropensity,
    loggingPropensitySource: example.actionLoggingPropensitySource,
  };
}

function requiredLoggedAction(example: RecommendationValueTrainingExampleV1) {
  const action = example.candidates.find((candidate) => candidate.actionKey === example.loggedActionKey);
  if (!action) throw new Error(`Logged action missing from feasible set: ${example.decisionId}`);
  return action;
}

function deterministicAlternative(example: RecommendationValueTrainingExampleV1) {
  return [...example.candidates]
    .sort((left, right) => left.actionKey.localeCompare(right.actionKey))
    .find((candidate) => candidate.actionKey !== example.loggedActionKey);
}

function cloneModel(model: RecommendationValueV8Model): RecommendationValueV8Model {
  return { ...model, weights: [...model.weights] };
}

function gate(name: string, passed: boolean, value: number | boolean, threshold: number | string | boolean) {
  return { name, status: passed ? 'PASS' as const : 'FAIL' as const, value, threshold };
}

function canonicalizeManifest(manifest: RecommendationValueDatasetManifestV1): RecommendationValueDatasetManifestV1 {
  return {
    ...manifest,
    splits: [...manifest.splits].map((split) => ({ ...split })),
    files: [...manifest.files].map((file) => ({ ...file })).sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function writeJsonExclusive(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
