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
    auditManualSelfHostedWorkflow(name, normalized, {
      label: 'recommendation-training',
      environment: 'recommendation-training',
      purpose: 'privileged training',
    });
    auditNoGitHubExpressionsInsideRunBlocks(name, normalized);
    if (!/pip[^\n]*install[^\n]*--no-index[^\n]*--find-links/m.test(normalized)) {
      errors.push(`${name}: privileged training dependencies must be installed from an approved offline wheelhouse`);
    }
  }

  const privilegedDatasetExport = /recommendation-.*dataset-export/i.test(name);
  if (privilegedDatasetExport) {
    auditManualSelfHostedWorkflow(name, normalized, {
      label: 'recommendation-dataset-export',
      environment: 'recommendation-dataset-export',
      purpose: 'privileged dataset export',
    });
    auditNoGitHubExpressionsInsideRunBlocks(name, normalized);
  }

  function auditManualSelfHostedWorkflow(workflowName, workflowText, contract) {
    if (!hasWorkflowDispatch) errors.push(`${workflowName}: ${contract.purpose} must require workflow_dispatch`);
    if (hasPullRequest || hasPush || hasSchedule) errors.push(`${workflowName}: ${contract.purpose} must not have automatic triggers`);
    if (!hasSelfHosted) errors.push(`${workflowName}: ${contract.purpose} must run on a dedicated self-hosted runner`);
    const labelPattern = new RegExp(`runs-on\\s*:\\s*\\[[^\\]]*${contract.label}`, 'i');
    if (!labelPattern.test(workflowText)) {
      errors.push(`${workflowName}: runner must include ${contract.label} label`);
    }
    const environmentPattern = new RegExp(`^\\s*environment\\s*:\\s*${contract.environment}\\s*$`, 'm');
    if (!environmentPattern.test(workflowText)) {
      errors.push(`${workflowName}: must use the ${contract.environment} protected environment`);
    }
    if (!/permissions:\s*\n\s*contents:\s*read/m.test(workflowText)) {
      errors.push(`${workflowName}: must use read-only repository contents permission`);
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

const trainingRequirements = path.resolve('training/recommendation_v8/requirements-training.txt');
if (fs.existsSync(trainingRequirements)) {
  const requirementLines = fs.readFileSync(trainingRequirements, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (requirementLines.length === 0) errors.push('requirements-training.txt: at least one pinned dependency is required');
  for (const line of requirementLines) {
    if (!/^[A-Za-z0-9_.-]+==[A-Za-z0-9_.+!-]+$/.test(line)) {
      errors.push(`requirements-training.txt: dependency must be exactly pinned: ${line}`);
    }
  }
}

if (errors.length > 0) {
  console.error('recommendation security audit: FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('recommendation security audit: PASS');

function auditNoGitHubExpressionsInsideRunBlocks(workflowName, workflowText) {
  const lines = workflowText.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)run:\s*\|[-+]?\s*$/);
    if (!match) continue;
    const runIndent = match[1].length;
    for (let inner = index + 1; inner < lines.length; inner += 1) {
      const line = lines[inner];
      if (line.trim() === '') continue;
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= runIndent) break;
      if (line.includes('${{')) {
        errors.push(`${workflowName}: GitHub expressions are forbidden inside privileged run blocks; map values through env instead`);
        break;
      }
    }
  }
}
