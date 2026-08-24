import fs from 'node:fs';

const workflows = [
  '.github/workflows/recommendation-pretraining-readiness.yml',
  '.github/workflows/recommendation-behavioral-training.yml',
];
const errors = [];

for (const path of workflows) {
  const text = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const required = [
    /^\s*workflow_dispatch\s*:/m,
    /^\s*environment\s*:\s*recommendation-training\s*$/m,
    /runs-on\s*:\s*\[[^\]]*self-hosted[^\]]*recommendation-training[^\]]*\]/i,
    /permissions:\s*\n\s*contents:\s*read/m,
    /RECOMMENDATION_TRAINING_WHEELHOUSE/,
    /RECOMMENDATION_TRAINING_WHEELHOUSE_SHA256/,
    /EXPECTED_WHEELHOUSE_SHA256/,
    /wheelhouse_identity\.py/,
    /--expected-sha256\s+"\$EXPECTED_WHEELHOUSE_SHA256"/,
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
  if (/pip\s+install(?![^\n]*--no-index)/i.test(extractRunBlocks(text))) {
    errors.push(`${path}: training dependency installation must be offline (--no-index)`);
  }
}

const training = fs.readFileSync('.github/workflows/recommendation-behavioral-training.yml', 'utf8');
const readinessStep = training.indexOf('Require final server-owned readiness before optimizer steps');
const firstOptimizerStep = training.indexOf('Train RNN baseline');
if (readinessStep < 0 || firstOptimizerStep < 0 || readinessStep >= firstOptimizerStep) {
  errors.push('Behavioral training must re-evaluate final readiness before the first optimizer step');
}
if (!/bundleManifestSha256["']?\s*:\s*registry_sha/.test(training)) {
  errors.push('Behavioral training summary must emit the registry-compatible model manifest SHA');
}
if (!/trainingWheelhouseSha256["']?\s*:\s*sys\.argv\[6\]\.lower\(\)/.test(training)) {
  errors.push('Behavioral training summary must retain the exact wheelhouse identity');
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
