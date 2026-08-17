import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'contextual-v3-recovery-verdict-'));
try {
  const searchPath = join(root, 'search.json');
  const envPath = join(root, 'env.json');
  const verdictPath = join(root, 'verdict.json');
  const legacySha = '8'.repeat(64);
  const envSha = '9'.repeat(64);

  await json(searchPath, {
    schemaVersion: 5,
    expectedModelSha256: '9'.repeat(64),
    legacyModelSha256: legacySha,
    matchingKnownArtifactShaCount: 0,
    searchTimedOut: false,
    productionMutationPerformed: false,
    trainingPerformed: false,
    futureTestEvaluated: false,
  });
  await json(envPath, {
    schemaVersion: 1,
    operation: 'RECOMMENDATION_PRODUCTION_CONTEXTUAL_V3_ENV_INVENTORY',
    expectedModelSha256: envSha,
    productionMutationPerformed: false,
    trainingPerformed: false,
    futureTestEvaluated: false,
  });

  run(searchPath, envPath, verdictPath);
  const unavailable = JSON.parse(await readFile(verdictPath, 'utf8'));
  assert(
    unavailable.verdict === 'ARTIFACT_UNAVAILABLE_FROM_DISCOVERED_RECOVERY_SOURCES',
    'Complete zero-match search must fail closed as unavailable.',
  );
  assert(unavailable.expectedModelSha256 === envSha, 'Production env SHA must win.');
  assert(unavailable.retrainingAuthorized === false, 'Missing artifact must not authorize training.');
  assert(unavailable.productionMutationAuthorized === false, 'Verdict must not authorize mutation.');

  await json(searchPath, {
    schemaVersion: 5,
    expectedModelSha256: envSha,
    legacyModelSha256: legacySha,
    matchingKnownArtifactShaCount: 1,
    searchTimedOut: false,
    productionMutationPerformed: false,
    trainingPerformed: false,
    futureTestEvaluated: false,
  });
  run(searchPath, envPath, verdictPath);
  const found = JSON.parse(await readFile(verdictPath, 'utf8'));
  assert(
    found.verdict === 'EXACT_ARTIFACT_FOUND_REQUIRES_FULL_BUNDLE_PREFLIGHT',
    'Exact model match must still require full bundle preflight.',
  );
  assert(found.productionMutationAuthorized === false, 'Exact match alone must not authorize deploy.');

  console.log('Contextual V3 recovery verdict tests passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}

function run(searchPath, envPath, verdictPath) {
  execFileSync(
    process.execPath,
    ['scripts/summarize-contextual-v3-recovery-verdict.mjs'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CONTEXTUAL_V3_RECOVERY_SEARCH_SUMMARY_PATH: searchPath,
        CONTEXTUAL_V3_RECOVERY_ENV_SUMMARY_PATH: envPath,
        CONTEXTUAL_V3_RECOVERY_VERDICT_PATH: verdictPath,
      },
      stdio: 'pipe',
    },
  );
}

async function json(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
