import fs from 'node:fs';

const workflows = [
  '.github/workflows/recommendation-pretraining-readiness.yml',
  '.github/workflows/recommendation-behavioral-training.yml',
];
const errors = [];

for (const path of workflows) {
  const text = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const runBlocks = extractRunBlocks(text);
  const required = [
    /^\s*workflow_dispatch\s*:/m,
    /^\s*environment\s*:\s*recommendation-training\s*$/m,
    /runs-on\s*:\s*\[[^\]]*self-hosted[^\]]*recommendation-training[^\]]*\]/i,
    /permissions:\s*\n\s*contents:\s*read/m,
    /RECOMMENDATION_TRAINING_WHEELHOUSE/,
    /RECOMMENDATION_TRAINING_WHEELHOUSE_SHA256/,
    /EXPECTED_WHEELHOUSE_SHA256/,
    /wheelhouse_identity\.py/,
    /wheelhouse_snapshot\.py/,
    /TRAINING_WHEELHOUSE_SNAPSHOT/,
    /--source\s+"\$TRAINING_WHEELHOUSE"/,
    /--destination\s+"\$WHEELHOUSE_SNAPSHOT"/,
    /--expected-sha256\s+"\$EXPECTED_WHEELHOUSE_SHA256"/,
    /pip"?\s+install\s+--no-index\s+--find-links\s+"\$TRAINING_WHEELHOUSE_SNAPSHOT"/,
    /dataset_snapshot\.py/,
    /DATASET_SOURCE/,
    /DATASET_SNAPSHOT/,
    /--source\s+"\$DATASET_SOURCE"/,
    /--destination\s+"\$DATASET_SNAPSHOT"/,
    /--expected-dataset-sha256\s+"\$EXPECTED_DATASET_SHA256"/,
    /--expected-manifest-sha256\s+"\$EXPECTED_MANIFEST_SHA256"/,
    /echo\s+"DATASET_DIR=\$DATASET_SNAPSHOT"\s*>>\s*"\$GITHUB_ENV"/,
    /echo\s+"DATASET_SOURCE="\s*>>\s*"\$GITHUB_ENV"/,
    /verify_dataset\.py[\s\S]*--dataset-dir\s+"\$DATASET_DIR"/,
    /trainingWheelhouseSha256/,
    /offlineWheelhouseReady["']?\s*:\s*True/,
    /trainingDeviceReady["']?\s*:\s*True/,
    /https:\/\/\*\|http:\/\/127\.0\.0\.1:\*\|http:\/\/localhost:\*/,
    /futureTestEvaluated/,
  ];
  for (const pattern of required) {
    if (!pattern.test(text)) errors.push(`${path}: missing fail-closed pretraining contract ${pattern}`);
  }
  if (/^\s*(pull_request|pull_request_target|push|schedule)\s*:/m.test(text)) {
    errors.push(`${path}: training/readiness workflow must be manual-only`);
  }
  if (/permissions\s*:\s*write-all/i.test(text)) {
    errors.push(`${path}: write-all permission is forbidden`);
  }
  if (/pip\s+install(?![^\n]*--no-index)/i.test(runBlocks)) {
    errors.push(`${path}: training dependency installation must be offline (--no-index)`);
  }
  if (/pip["']?\s+install[^\n]*--find-links\s+"\$TRAINING_WHEELHOUSE"/i.test(runBlocks)) {
    errors.push(`${path}: pip must never install directly from the mutable shared wheelhouse`);
  }

  const wheelhouseSnapshotStep = text.indexOf('wheelhouse_snapshot.py');
  const pipStep = text.search(/pip"?\s+install/);
  if (wheelhouseSnapshotStep < 0 || pipStep < 0 || wheelhouseSnapshotStep >= pipStep) {
    errors.push(`${path}: immutable wheelhouse snapshot must be created before pip installation`);
  }
  const postInstallIdentity = text.indexOf('wheelhouse-post-install-identity.json');
  if (postInstallIdentity < pipStep) {
    errors.push(`${path}: immutable wheelhouse snapshot must be re-verified after pip installation`);
  }

  const datasetSnapshotStep = text.indexOf('dataset_snapshot.py');
  const datasetVerifyStep = text.indexOf('verify_dataset.py');
  if (datasetSnapshotStep < 0 || datasetVerifyStep < 0 || datasetSnapshotStep >= datasetVerifyStep) {
    errors.push(`${path}: immutable dataset snapshot must be created before dataset verification/training reads`);
  }
  const datasetRebind = text.indexOf('echo "DATASET_DIR=$DATASET_SNAPSHOT"', datasetSnapshotStep);
  const datasetSourceClear = text.indexOf('echo "DATASET_SOURCE="', datasetSnapshotStep);
  if (
    datasetRebind < datasetSnapshotStep
    || datasetSourceClear < datasetRebind
    || datasetSourceClear >= datasetVerifyStep
  ) {
    errors.push(`${path}: workflow must rebind DATASET_DIR to the snapshot and clear the mutable staging source before verification`);
  }
  if (datasetSourceClear >= 0 && /\$DATASET_SOURCE\b/.test(text.slice(datasetSourceClear + 1))) {
    errors.push(`${path}: mutable staging DATASET_SOURCE must not be read after the snapshot step`);
  }
  if (/--dataset-dir\s+"\$DATASET_SOURCE"/.test(runBlocks)) {
    errors.push(`${path}: training/readiness commands must never consume the mutable staging dataset directly`);
  }
}

const training = fs.readFileSync('.github/workflows/recommendation-behavioral-training.yml', 'utf8');
const readinessStep = training.indexOf('Require final server-owned readiness before optimizer steps');
const firstOptimizerStep = training.indexOf('Train RNN baseline');
const datasetSnapshotStep = training.indexOf('dataset_snapshot.py');
if (readinessStep < 0 || firstOptimizerStep < 0 || readinessStep >= firstOptimizerStep) {
  errors.push('Behavioral training must re-evaluate final readiness before the first optimizer step');
}
if (datasetSnapshotStep < 0 || datasetSnapshotStep >= firstOptimizerStep) {
  errors.push('Behavioral training must create the immutable dataset snapshot before the first optimizer step');
}
if (!/bundleManifestSha256["']?\s*:\s*registry_sha/.test(training)) {
  errors.push('Behavioral training summary must emit the registry-compatible model manifest SHA');
}
if (!/trainingWheelhouseSha256["']?\s*:\s*sys\.argv\[6\]\.lower\(\)/.test(training)) {
  errors.push('Behavioral training summary must retain the exact wheelhouse identity');
}
if (!/build_model_bundle\.py[\s\S]*--rnn-metrics\s+"\$RUN_ROOT\/rnn\/metrics\.json"/.test(training)) {
  errors.push('Behavioral bundle build must include exact RNN metrics lineage');
}
if (!/compare_behavioral\.py[\s\S]*--rnn-metrics[\s\S]*--transformer-metrics/.test(training)) {
  errors.push('Behavioral architecture comparison must consume both exact metric artifacts');
}

const bundleBuilder = fs.readFileSync('training/recommendation_v8/build_model_bundle.py', 'utf8');
for (const required of [
  'recommendation-behavioral-ablation-v2',
  'ABLATION_RNN_METRICS_SHA_MISMATCH',
  'ABLATION_TRANSFORMER_METRICS_SHA_MISMATCH',
  'MODEL_DATASET_MANIFEST_SHA_MISMATCH',
  'TRAINING_ENVIRONMENT_FINGERPRINT_REQUIRED',
  'EXPECTED_WHEELHOUSE_SHA256',
  'TRAINING_READINESS_SUBJECT_SHA256',
  'datasetManifestSha256',
  'trainingWheelhouseSha256',
  'trainingReadinessSubjectSha256',
  'ablation/rnn-metrics.json',
  'ablation/rnn-training-config.json',
]) {
  if (!bundleBuilder.includes(required)) errors.push(`Behavioral bundle builder is missing immutable lineage check: ${required}`);
}

const modelBundleContract = fs.readFileSync('packages/shared/src/model-bundle-contract-v1.ts', 'utf8');
for (const required of [
  'BEHAVIORAL_DATASET_MANIFEST_SHA256_REQUIRED',
  'BEHAVIORAL_TRAINING_WHEELHOUSE_SHA256_REQUIRED',
  'BEHAVIORAL_TRAINING_READINESS_SUBJECT_SHA256_REQUIRED',
]) {
  if (!modelBundleContract.includes(required)) {
    errors.push(`Behavioral model bundle contract is missing required pretraining lineage guard: ${required}`);
  }
}

const environmentCheck = fs.readFileSync('training/recommendation_v8/pretraining_environment_check.py', 'utf8');
for (const required of [
  'TRAINING_WHEELHOUSE_SNAPSHOT_REQUIRED',
  'TRAINING_WHEELHOUSE_SOURCE_ARCHIVE_FORBIDDEN',
  'APPROVED_WHEELHOUSE_VERSION_AMBIGUOUS',
  'INSTALLED_DEPENDENCY_NOT_IN_APPROVED_WHEELHOUSE',
  'INSTALLED_DEPENDENCY_WHEELHOUSE_VERSION_MISMATCH',
  'installedEnvironmentSha256',
  'wheelhousePackageVersions',
]) {
  if (!environmentCheck.includes(required)) {
    errors.push(`Pretraining environment check is missing dependency provenance guard: ${required}`);
  }
}

const datasetSnapshot = fs.readFileSync('training/recommendation_v8/dataset_snapshot.py', 'utf8');
for (const required of [
  'verify_dataset_manifest',
  'assert_dataset_direct_shop_trust',
  'verify_development_split_isolation',
  'expected_dataset_sha256',
  'expected_manifest_sha256',
  'make_read_only(destination)',
  '"futureTestPayloadDecoded": False',
]) {
  if (!datasetSnapshot.includes(required)) {
    errors.push(`Dataset snapshot implementation is missing immutable verification guard: ${required}`);
  }
}

if (errors.length > 0) {
  console.error('recommendation pretraining runtime workflow audit: FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('recommendation pretraining runtime workflow audit: PASS');

function extractRunBlocks(workflowText) {
  const lines = workflowText.split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)run:\s*\|[-+]?\s*$/);
    if (!match) continue;
    const runIndent = match[1].length;
    const collected = [];
    for (let inner = index + 1; inner < lines.length; inner += 1) {
      const line = lines[inner];
      if (line.trim() === '') {
        collected.push(line);
        continue;
      }
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= runIndent) break;
      collected.push(line);
    }
    blocks.push(collected.join('\n'));
  }
  return blocks.join('\n');
}
