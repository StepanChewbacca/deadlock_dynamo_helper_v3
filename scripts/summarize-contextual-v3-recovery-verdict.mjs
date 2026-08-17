import { readFile, writeFile } from 'node:fs/promises';

const searchSummaryPath = required('CONTEXTUAL_V3_RECOVERY_SEARCH_SUMMARY_PATH');
const envSummaryPath = required('CONTEXTUAL_V3_RECOVERY_ENV_SUMMARY_PATH');
const outputPath = required('CONTEXTUAL_V3_RECOVERY_VERDICT_PATH');

const [search, environment] = await Promise.all([
  readJson(searchSummaryPath),
  readJson(envSummaryPath),
]);

assertEqual(search?.operation, undefined, 'Search summary operation is not part of schema 5');
if (search?.schemaVersion !== 5) {
  throw new Error(`Unsupported recovery search schemaVersion: ${search?.schemaVersion}.`);
}
if (
  search?.productionMutationPerformed !== false ||
  search?.trainingPerformed !== false ||
  search?.futureTestEvaluated !== false
) {
  throw new Error('Recovery search evidence is not read-only evidence.');
}
if (
  environment?.operation !== 'RECOMMENDATION_PRODUCTION_CONTEXTUAL_V3_ENV_INVENTORY' ||
  environment?.schemaVersion !== 1 ||
  environment?.productionMutationPerformed !== false ||
  environment?.trainingPerformed !== false ||
  environment?.futureTestEvaluated !== false
) {
  throw new Error('Contextual V3 production env evidence is invalid.');
}

const matchingKnownArtifactShaCount = Number(search.matchingKnownArtifactShaCount);
if (!Number.isInteger(matchingKnownArtifactShaCount) || matchingKnownArtifactShaCount < 0) {
  throw new Error('Recovery search matchingKnownArtifactShaCount is invalid.');
}

const expectedModelSha256 = environment.expectedModelSha256 || search.legacyModelSha256;
const expectedModelShaSource = environment.expectedModelSha256
  ? 'PRODUCTION_ENV'
  : 'CURRENT_SOURCE_DEFAULT_FALLBACK';
const discoveredExactArtifact = matchingKnownArtifactShaCount > 0;
const searchComplete = search.searchTimedOut === false;
const recoveryTargetProven = discoveredExactArtifact && searchComplete;
const verdict = recoveryTargetProven
  ? 'EXACT_ARTIFACT_FOUND_REQUIRES_FULL_BUNDLE_PREFLIGHT'
  : searchComplete
    ? 'ARTIFACT_UNAVAILABLE_FROM_DISCOVERED_RECOVERY_SOURCES'
    : 'RECOVERY_SEARCH_INCOMPLETE';

const report = {
  schemaVersion: 1,
  operation: 'CONTEXTUAL_V3_PRODUCTION_RECOVERY_VERDICT',
  generatedAt: new Date().toISOString(),
  verdict,
  expectedModelSha256,
  expectedModelShaSource,
  matchingKnownArtifactShaCount,
  recoverySearchTimedOut: search.searchTimedOut,
  recoveryTargetProven,
  retrainingAuthorized: false,
  productionMutationAuthorized: false,
  productionApiRestartAuthorized: false,
  nextAuthorizedOperation: recoveryTargetProven
    ? 'RUN_CONTEXTUAL_V3_FULL_BUNDLE_PREFLIGHT'
    : 'PRESERVE_INCIDENT_AND_REQUIRE_EXPLICIT_RECOVERY_DECISION',
  contracts: {
    absenceOfArtifactDoesNotAuthorizeTraining: true,
    exactModelFileAloneDoesNotAuthorizeDeployment: true,
    fullBundlePreflightRequiredBeforeAnyFutureDeployment: true,
    productionEnvOverridesSourceDefaultWhenPresent: true,
    futureTestEvaluated: false,
  },
  source: {
    searchSummaryPath,
    envSummaryPath,
  },
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

async function readJson(path) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}.`);
  }
}
