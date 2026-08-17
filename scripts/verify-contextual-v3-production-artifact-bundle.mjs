import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const EXPECTED_MODEL_VERSION = 'CONTEXTUAL_V3_HIERARCHICAL_COUNT_RANKER_1';
const EXPECTED_CANDIDATE_POLICY =
  'TRAIN_OBSERVED_GLOBAL_BACKOFF_LEGAL_SHORTLIST';
const EXPECTED_CANDIDATE_LIMIT = 128;
const EXPECTED_PRODUCTION_DECISION = 'ELIGIBLE_FOR_SHADOW_MODE';

const trainingDir = resolve(required('CONTEXTUAL_V3_PREFLIGHT_TRAINING_DIR'));
const candidateEvaluationDir = resolve(
  required('CONTEXTUAL_V3_PREFLIGHT_CANDIDATE_EVALUATION_DIR'),
);
const finalTestDir = resolve(required('CONTEXTUAL_V3_PREFLIGHT_FINAL_TEST_DIR'));
const expectedModelSha256 = required(
  'CONTEXTUAL_V3_PREFLIGHT_EXPECTED_MODEL_SHA256',
).toLowerCase();

if (!isSha256(expectedModelSha256)) {
  throw new Error('CONTEXTUAL_V3_PREFLIGHT_EXPECTED_MODEL_SHA256 must be SHA-256.');
}

const result = await verifyBundle();
console.log(JSON.stringify(result, null, 2));

async function verifyBundle() {
  const modelPath = join(trainingDir, 'model.json');
  const [
    trainingManifest,
    candidateManifest,
    candidateEvaluation,
    candidateAudit,
    finalManifest,
    finalEvaluation,
    finalAudit,
    modelRaw,
    modelSha256,
  ] = await Promise.all([
    readJson(join(trainingDir, 'manifest.json')),
    readJson(join(candidateEvaluationDir, 'manifest.json')),
    readJson(join(candidateEvaluationDir, 'evaluation.json')),
    readJson(join(candidateEvaluationDir, 'audit.json')),
    readJson(join(finalTestDir, 'manifest.json')),
    readJson(join(finalTestDir, 'evaluation.json')),
    readJson(join(finalTestDir, 'audit.json')),
    readFile(modelPath, 'utf8'),
    hashFile(modelPath),
  ]);

  let model;
  try {
    model = JSON.parse(modelRaw);
  } catch {
    throw new Error('Contextual V3 model.json is not valid JSON.');
  }

  assertEqual(model?.modelVersion, EXPECTED_MODEL_VERSION, 'Model version');
  assertEqual(modelSha256, expectedModelSha256, 'Configured model SHA-256');
  assertEqual(
    trainingManifest?.artifacts?.model?.sha256,
    modelSha256,
    'Training manifest model SHA-256',
  );
  assertEqual(
    candidateManifest?.source?.modelSha256,
    modelSha256,
    'Candidate-evaluation model SHA-256',
  );
  assertEqual(
    finalManifest?.source?.modelSha256,
    modelSha256,
    'Final-test model SHA-256',
  );
  assertEqual(
    candidateManifest?.source?.modelVersion,
    EXPECTED_MODEL_VERSION,
    'Candidate-evaluation model version',
  );
  assertEqual(
    finalManifest?.source?.modelVersion,
    EXPECTED_MODEL_VERSION,
    'Final-test model version',
  );
  assertEqual(
    candidateManifest?.candidatePolicy?.name,
    EXPECTED_CANDIDATE_POLICY,
    'Candidate-evaluation policy',
  );
  assertEqual(
    candidateManifest?.candidatePolicy?.candidateLimit,
    EXPECTED_CANDIDATE_LIMIT,
    'Candidate-evaluation candidate limit',
  );
  assertEqual(
    finalManifest?.candidatePolicy?.name,
    EXPECTED_CANDIDATE_POLICY,
    'Final-test candidate policy',
  );
  assertEqual(
    finalManifest?.candidatePolicy?.candidateLimit,
    EXPECTED_CANDIDATE_LIMIT,
    'Final-test candidate limit',
  );

  requireTrue(
    candidateManifest?.evaluationReleaseGatePassed,
    'Candidate-evaluation manifest release gate',
  );
  requireTrue(candidateEvaluation?.releaseGate?.passed, 'Candidate-evaluation gate');
  requireTrue(candidateAudit?.passed, 'Candidate-evaluation audit');
  requireTrue(finalManifest?.finalTestReleaseGatePassed, 'Final-test manifest gate');
  requireTrue(finalEvaluation?.releaseGate?.passed, 'Final-test evaluation gate');
  requireTrue(finalManifest?.auditPassed, 'Final-test manifest audit');
  requireTrue(finalAudit?.passed, 'Final-test audit');
  assertEqual(
    finalManifest?.productionDecision?.status,
    EXPECTED_PRODUCTION_DECISION,
    'Final-test manifest production decision',
  );
  assertEqual(
    finalEvaluation?.productionDecision?.status,
    EXPECTED_PRODUCTION_DECISION,
    'Final-test evaluation production decision',
  );

  const catalogSha256 = finalManifest?.source?.catalogSha256;
  if (!isSha256(catalogSha256)) {
    throw new Error('Final-test catalog SHA-256 is missing or invalid.');
  }

  return {
    schemaVersion: 1,
    operation: 'CONTEXTUAL_V3_PRODUCTION_ARTIFACT_PREFLIGHT',
    checkedAt: new Date().toISOString(),
    passed: true,
    modelVersion: EXPECTED_MODEL_VERSION,
    modelSha256,
    catalogSha256,
    candidatePolicy: EXPECTED_CANDIDATE_POLICY,
    candidateLimit: EXPECTED_CANDIDATE_LIMIT,
    validationGatePassed: true,
    validationAuditPassed: true,
    finalTestGatePassed: true,
    finalTestAuditPassed: true,
    productionDecision: EXPECTED_PRODUCTION_DECISION,
    productionMutationPerformed: false,
    productionApiRestarted: false,
    trainingPerformed: false,
    futureTestEvaluatedByPreflight: false,
  };
}

async function readJson(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`Required Contextual V3 artifact is missing: ${path}. ${message(error)}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Required Contextual V3 artifact is invalid JSON: ${path}.`);
  }
}

async function hashFile(path) {
  const hash = createHash('sha256');
  try {
    for await (const chunk of createReadStream(path)) {
      hash.update(chunk);
    }
  } catch (error) {
    throw new Error(`Unable to hash Contextual V3 artifact ${path}. ${message(error)}`);
  }
  return hash.digest('hex');
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function requireTrue(value, label) {
  if (value !== true) {
    throw new Error(`${label} must be true.`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${String(expected)}, got ${String(actual)}.`);
  }
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
