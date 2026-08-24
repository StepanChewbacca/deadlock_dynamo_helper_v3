import fs from 'node:fs';

const path = '.github/workflows/recommendation-dataset-register-verify.yml';
const text = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const errors = [];

const required = [
  /^\s*workflow_dispatch\s*:/m,
  /^\s*environment\s*:\s*recommendation-artifact-registry\s*$/m,
  /runs-on\s*:\s*\[[^\]]*self-hosted[^\]]*recommendation-artifact-registry[^\]]*\]/i,
  /permissions:\s*\n\s*contents:\s*read/m,
  /RECOMMENDATION_DATASET_STAGING_ROOT/,
  /RECOMMENDATION_ARTIFACT_REGISTRY_TOKEN/,
  /objectBaseUri/,
  /manifestSha256/,
  /datasetSha256/,
  /rowCount/,
  /recommendation-datasets\/v1\/register/,
  /recommendation-datasets\/v1\/verify/,
  /VERIFIED_READY_FOR_PRETRAINING_READINESS/,
];
for (const pattern of required) {
  if (!pattern.test(text)) errors.push(`${path}: missing required protected-registry contract ${pattern}`);
}
if (/^\s*(pull_request|pull_request_target|push|schedule)\s*:/m.test(text)) {
  errors.push(`${path}: dataset registry workflow must be manual-only`);
}
if (/permissions\s*:\s*write-all/i.test(text)) {
  errors.push(`${path}: write-all permission is forbidden`);
}
if (/\$\{\{/.test(extractRunBlocks(text))) {
  errors.push(`${path}: GitHub expressions are forbidden inside privileged run blocks`);
}

if (errors.length > 0) {
  console.error('recommendation dataset registry workflow audit: FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('recommendation dataset registry workflow audit: PASS');

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
