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

  const causalValueTraining = /^recommendation-value-training\.ya?ml$/i.test(name);
  const pretrainingReadiness = /^recommendation-pretraining-readiness\.ya?ml$/i.test(name);
  const privilegedTraining = /recommendation-.*training/i.test(name);
  if (privilegedTraining) {
    auditManualSelfHostedWorkflow(name, normalized, causalValueTraining
      ? {
          label: 'recommendation-value-training',
          environment: 'recommendation-value-training',
          purpose: 'privileged causal Value training',
        }
      : {
          label: 'recommendation-training',
          environment: 'recommendation-training',
          purpose: pretrainingReadiness ? 'privileged no-training readiness' : 'privileged training',
        });
    auditNoGitHubExpressionsInsideRunBlocks(name, normalized);
    if (!causalValueTraining && !/pip[^\n]*install[^\n]*--no-index[^\n]*--find-links/m.test(normalized)) {
      errors.push(`${name}: privileged Python training dependencies must be installed from an approved offline wheelhouse`);
    }
  }

  if (pretrainingReadiness) {
    auditNoTrainingReadinessWorkflow(name, normalized);
  }

  const causalValueDatasetExport = /^recommendation-value-dataset-export\.ya?ml$/i.test(name);
  const privilegedDatasetExport = /recommendation-.*dataset-export/i.test(name);
  if (privilegedDatasetExport) {
    auditManualSelfHostedWorkflow(name, normalized, causalValueDatasetExport
      ? {
          label: 'recommendation-value-dataset-export',
          environment: 'recommendation-value-dataset-export',
          purpose: 'privileged causal Value dataset export',
        }
      : {
          label: 'recommendation-dataset-export',
          environment: 'recommendation-dataset-export',
          purpose: 'privileged dataset export',
        });
    auditNoGitHubExpressionsInsideRunBlocks(name, normalized);
  }

  const finalOperation = finalOperationContract(name);
  if (finalOperation) {
    auditManualSelfHostedWorkflow(name, normalized, finalOperation);
    auditNoGitHubExpressionsInsideRunBlocks(name, normalized);
  }
  if (/^recommendation-future-test-evaluation\.ya?ml$/i.test(name)) {
    auditFutureTestWorkflowContract(name, normalized);
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
const behavioralConfigs = new Map();
for (const name of fs.existsSync(trainingConfigDir) ? fs.readdirSync(trainingConfigDir) : []) {
  if (!name.endsWith('.json')) continue;
  const config = JSON.parse(fs.readFileSync(path.join(trainingConfigDir, name), 'utf8'));
  if (config.contractVersion === 'recommendation-value-training-config-v1') {
    if (!Number.isInteger(config.hashDimension) || config.hashDimension < 128) errors.push(`${name}: causal Value hashDimension is invalid`);
    if (!Number.isFinite(config.minActionEffectMae) || config.minActionEffectMae <= 0) errors.push(`${name}: causal Value action-effect gate is invalid`);
    if (!Number.isFinite(config.minPermutationResponseMae) || config.minPermutationResponseMae <= 0) errors.push(`${name}: causal Value permutation gate is invalid`);
    if (!Number.isFinite(config.minActionResidualVariance) || config.minActionResidualVariance <= 0) errors.push(`${name}: causal Value residual-variance gate is invalid`);
    continue;
  }
  if (config.contractVersion !== 'recommendation-behavioral-training-launch-v1') {
    errors.push(`${name}: unknown recommendation training config contract`);
    continue;
  }
  if (config.family !== 'SEQUENCE_RNN' && config.family !== 'SEQUENCE_TRANSFORMER') {
    errors.push(`${name}: unsupported Behavioral family`);
  } else if (behavioralConfigs.has(config.family)) {
    errors.push(`${name}: duplicate Behavioral config for ${config.family}`);
  } else {
    behavioralConfigs.set(config.family, { name, config });
  }
  if (config.futureTestAllowed !== false) errors.push(`${name}: FUTURE_TEST must be disabled for model-development training`);
  if (config.deterministic !== true) errors.push(`${name}: deterministic training must be enabled`);
  if (config.trainSplit !== 'TRAIN' || config.validationSplit !== 'VALIDATION' || config.selectionSplit !== 'SHADOW_HOLDOUT') {
    errors.push(`${name}: training/validation/selection split contract is invalid`);
  }
}

auditEqualObservablesBehavioralConfigs();

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

function finalOperationContract(name) {
  const contracts = {
    'recommendation-roadmap-materialization.yml': {
      label: 'recommendation-roadmap-evidence',
      environment: 'recommendation-roadmap-evidence',
      purpose: 'privileged roadmap evidence materialization',
    },
    'recommendation-policy-bundle-build.yml': {
      label: 'recommendation-policy-build',
      environment: 'recommendation-policy-build',
      purpose: 'privileged Policy V1 bundle build',
    },
    'recommendation-model-register-verify.yml': {
      label: 'recommendation-artifact-registry',
      environment: 'recommendation-artifact-registry',
      purpose: 'privileged model registration and verification',
    },
    'recommendation-model-activation.yml': {
      label: 'recommendation-model-activation',
      environment: 'recommendation-model-activation',
      purpose: 'privileged production model activation',
    },
    'recommendation-future-test-evaluation.yml': {
      label: 'recommendation-future-test',
      environment: 'recommendation-future-test',
      purpose: 'privileged one-shot FUTURE_TEST materialization',
    },
    'recommendation-sequential-rl-readiness.yml': {
      label: 'recommendation-sequential-rl',
      environment: 'recommendation-sequential-rl',
      purpose: 'privileged sequential RL research readiness',
    },
  };
  return contracts[name];
}

function auditEqualObservablesBehavioralConfigs() {
  const rnn = behavioralConfigs.get('SEQUENCE_RNN');
  const transformer = behavioralConfigs.get('SEQUENCE_TRANSFORMER');
  if (!rnn) errors.push('Behavioral training requires exactly one SEQUENCE_RNN config');
  if (!transformer) errors.push('Behavioral training requires exactly one SEQUENCE_TRANSFORMER config');
  if (!rnn || !transformer) return;

  const equalFields = [
    'seed',
    'deterministic',
    'trainSplit',
    'validationSplit',
    'selectionSplit',
    'futureTestAllowed',
    'device',
    'hashDimension',
    'maximumHistoryEvents',
    'embeddingDimension',
    'hiddenDimension',
    'layerCount',
    'dropout',
    'supportProbabilityThreshold',
    'majorCohortMinDecisions',
    'majorCohortMinFraction',
    'gateMinDecisions',
    'gateMinCandidateCoverage',
    'gateMinSupport',
    'gateMinMajorCohortSupport',
    'gateMaxFloorSensitivity',
  ];
  for (const field of equalFields) {
    if (JSON.stringify(rnn.config[field]) !== JSON.stringify(transformer.config[field])) {
      errors.push(`Behavioral equal-observables config mismatch for ${field}: ${rnn.name} vs ${transformer.name}`);
    }
  }
}

function auditNoTrainingReadinessWorkflow(workflowName, workflowText) {
  const forbidden = [
    'train_behavioral.py',
    'compare_behavioral.py',
    'build_model_bundle.py',
    'train-recommendation-value-v8',
    'train-recommendation-value-v8.ts',
  ];
  for (const token of forbidden) {
    if (workflowText.includes(token)) {
      errors.push(`${workflowName}: no-training readiness workflow must not invoke ${token}`);
    }
  }
  const required = [
    'pretraining_environment_check.py',
    'verify_dataset.py',
    'config/rnn.json',
    'config/transformer.json',
    'READY_TO_START_BEHAVIORAL_TRAINING',
    'trainingPerformed',
  ];
  for (const token of required) {
    if (!workflowText.includes(token)) {
      errors.push(`${workflowName}: final readiness contract is missing ${token}`);
    }
  }
}

function auditFutureTestWorkflowContract(workflowName, workflowText) {
  const required = [
    'recommendation-future-test-evaluation-v1',
    'modelSelectionFrozen',
    'hyperparametersFrozen',
    'candidateGeneratorFrozen',
    'featureContractFrozen',
    'futureTestAccessCount',
    'response.get("status")',
    'response.get("policyManifestSha256")',
    'response.get("evaluationSnapshotSha256")',
  ];
  for (const token of required) {
    if (!workflowText.includes(token)) {
      errors.push(`${workflowName}: FUTURE_TEST workflow is missing contract token ${token}`);
    }
  }
  const forbidden = [
    'architectureFrozen',
    'targetFrozen',
    'response.get("evaluation")',
  ];
  for (const token of forbidden) {
    if (workflowText.includes(token)) {
      errors.push(`${workflowName}: FUTURE_TEST workflow contains stale contract token ${token}`);
    }
  }
}

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
