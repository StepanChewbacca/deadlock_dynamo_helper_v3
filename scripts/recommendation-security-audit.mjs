import fs from 'node:fs';
import path from 'node:path';

const workflowDir = path.resolve('.github/workflows');
const errors = [];
for (const name of fs.existsSync(workflowDir) ? fs.readdirSync(workflowDir) : []) {
  if (!/\.ya?ml$/i.test(name)) continue;
  const filePath = path.join(workflowDir, name);
  const text = fs.readFileSync(filePath, 'utf8');
  const normalized = text.replace(/\r\n/g, '\n');
  const hasPullRequest = /^\s*pull_request\s*:/m.test(normalized);
  const hasPush = /^\s*push\s*:/m.test(normalized);
  const hasSchedule = /^\s*schedule\s*:/m.test(normalized);
  const hasWorkflowDispatch = /^\s*workflow_dispatch\s*:/m.test(normalized);
  const hasSelfHosted = /runs-on\s*:\s*[^\n]*self-hosted/i.test(normalized)
    || /runs-on\s*:\s*\[[^\]]*self-hosted/i.test(normalized);
  if (hasPullRequest && hasSelfHosted) {
    errors.push(`${name}: pull_request workflow must not execute on self-hosted runner`);
  }
  if (/^\s*pull_request_target\s*:/m.test(normalized)) {
    errors.push(`${name}: pull_request_target is forbidden for recommendation workflows`);
  }
  if (/permissions\s*:\s*write-all/i.test(normalized)) {
    errors.push(`${name}: write-all GITHUB_TOKEN permission is forbidden`);
  }
  if (/docker\s+compose[^\n]*--env-file\s+\.env[^\n]*\sconfig(?:\s|$)(?![^\n]*--no-interpolate)/i.test(normalized)) {
    errors.push(`${name}: expanded docker compose config may materialize .env secrets`);
  }

  const privilegedTraining = /recommendation-.*training/i.test(name);
  if (privilegedTraining) {
    if (!hasWorkflowDispatch) errors.push(`${name}: privileged training must require workflow_dispatch`);
    if (hasPullRequest || hasPush || hasSchedule) errors.push(`${name}: privileged training must not have automatic triggers`);
    if (!hasSelfHosted) errors.push(`${name}: privileged training must run on a dedicated self-hosted runner`);
    if (!/runs-on\s*:\s*\[[^\]]*recommendation-training/i.test(normalized)) {
      errors.push(`${name}: privileged training runner must include recommendation-training label`);
    }
    if (!/^\s*environment\s*:\s*recommendation-training\s*$/m.test(normalized)) {
      errors.push(`${name}: privileged training must use the recommendation-training protected environment`);
    }
    if (!/permissions:\s*\n\s*contents:\s*read/m.test(normalized)) {
      errors.push(`${name}: privileged training must use read-only repository contents permission`);
    }
  }
}

const trainingConfigDir = path.resolve('training/recommendation_v8/config');
for (const name of fs.existsSync(trainingConfigDir) ? fs.readdirSync(trainingConfigDir) : []) {
  if (!name.endsWith('.json')) continue;
  const config = JSON.parse(fs.readFileSync(path.join(trainingConfigDir, name), 'utf8'));
  if (config.futureTestAllowed !== false) errors.push(`${name}: FUTURE_TEST must be disabled for model-development training`);
  if (config.deterministic !== true) errors.push(`${name}: deterministic training must be enabled`);
  if (config.trainSplit !== 'TRAIN' || config.validationSplit !== 'VALIDATION' || config.selectionSplit !== 'SHADOW_HOLDOUT') {
    errors.push(`${name}: training/validation/selection split contract is invalid`);
  }
}

if (errors.length > 0) {
  console.error('recommendation security audit: FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('recommendation security audit: PASS');
