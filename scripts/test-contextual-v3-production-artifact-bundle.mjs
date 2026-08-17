import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'contextual-v3-production-preflight-'));
try {
  const trainingDir = join(root, 'training');
  const candidateDir = join(root, 'candidate');
  const finalDir = join(root, 'final');
  await Promise.all([
    mkdir(trainingDir, { recursive: true }),
    mkdir(candidateDir, { recursive: true }),
    mkdir(finalDir, { recursive: true }),
  ]);

  const model = {
    schemaVersion: 1,
    modelVersion: 'CONTEXTUAL_V3_HIERARCHICAL_COUNT_RANKER_1',
    generatedAt: '2026-08-17T00:00:00.000Z',
    archetypes: { fitSplit: 'TRAIN', definitionsByHero: {} },
    counts: { hero: {}, heroPhase: {}, heroPhaseArchetype: {}, ally: {}, enemy: {} },
  };
  const modelRaw = `${JSON.stringify(model)}\n`;
  const modelSha256 = createHash('sha256').update(modelRaw).digest('hex');
  const catalogSha256 = 'a'.repeat(64);

  await writeFile(join(trainingDir, 'model.json'), modelRaw);
  await json(join(trainingDir, 'manifest.json'), {
    pipelineVersion: 'CONTEXTUAL_V3_TRAINING_PIPELINE_1',
    artifacts: { model: { sha256: modelSha256 } },
  });
  await json(join(candidateDir, 'manifest.json'), {
    evaluationVersion: 'CONTEXTUAL_V3_CANDIDATE_EVALUATION_1',
    source: {
      modelSha256,
      modelVersion: 'CONTEXTUAL_V3_HIERARCHICAL_COUNT_RANKER_1',
    },
    candidatePolicy: {
      name: 'TRAIN_OBSERVED_GLOBAL_BACKOFF_LEGAL_SHORTLIST',
      candidateLimit: 128,
    },
    evaluationReleaseGatePassed: true,
  });
  await json(join(candidateDir, 'evaluation.json'), { releaseGate: { passed: true } });
  await json(join(candidateDir, 'audit.json'), { passed: true });
  await json(join(finalDir, 'manifest.json'), {
    evaluationVersion: 'CONTEXTUAL_V3_FINAL_TEST_1',
    source: {
      modelSha256,
      modelVersion: 'CONTEXTUAL_V3_HIERARCHICAL_COUNT_RANKER_1',
      catalogSha256,
    },
    candidatePolicy: {
      name: 'TRAIN_OBSERVED_GLOBAL_BACKOFF_LEGAL_SHORTLIST',
      candidateLimit: 128,
    },
    auditPassed: true,
    finalTestReleaseGatePassed: true,
    productionDecision: { status: 'ELIGIBLE_FOR_SHADOW_MODE' },
  });
  await json(join(finalDir, 'evaluation.json'), {
    releaseGate: { passed: true },
    productionDecision: { status: 'ELIGIBLE_FOR_SHADOW_MODE' },
  });
  await json(join(finalDir, 'audit.json'), { passed: true });

  const env = {
    ...process.env,
    CONTEXTUAL_V3_PREFLIGHT_TRAINING_DIR: trainingDir,
    CONTEXTUAL_V3_PREFLIGHT_CANDIDATE_EVALUATION_DIR: candidateDir,
    CONTEXTUAL_V3_PREFLIGHT_FINAL_TEST_DIR: finalDir,
    CONTEXTUAL_V3_PREFLIGHT_EXPECTED_MODEL_SHA256: modelSha256,
  };
  const output = execFileSync(
    process.execPath,
    ['scripts/verify-contextual-v3-production-artifact-bundle.mjs'],
    { cwd: process.cwd(), env, encoding: 'utf8' },
  );
  const report = JSON.parse(output);
  assert(report.passed === true, 'Valid production bundle must pass.');
  assert(report.modelSha256 === modelSha256, 'Model SHA must be preserved.');
  assert(report.productionMutationPerformed === false, 'Preflight must not mutate production.');
  assert(report.trainingPerformed === false, 'Preflight must not train.');

  await rm(join(trainingDir, 'model.json'));
  let missingModelFailed = false;
  try {
    execFileSync(
      process.execPath,
      ['scripts/verify-contextual-v3-production-artifact-bundle.mjs'],
      { cwd: process.cwd(), env, encoding: 'utf8', stdio: 'pipe' },
    );
  } catch (error) {
    missingModelFailed = String(error?.stderr ?? error?.message ?? error).includes(
      'Unable to hash Contextual V3 artifact',
    );
  }
  assert(missingModelFailed, 'Missing model must fail closed before deployment.');

  console.log('Contextual V3 production artifact preflight tests passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}

async function json(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
