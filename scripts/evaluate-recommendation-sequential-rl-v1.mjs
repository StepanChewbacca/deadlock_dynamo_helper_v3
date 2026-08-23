import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  RECOMMENDATION_SEQUENTIAL_RL_EVIDENCE_V1,
  RECOMMENDATION_SEQUENTIAL_RL_EVALUATOR_V1,
  evaluateRecommendationSequentialDatasetV1,
} = require('../packages/shared/dist');

const args = parseArgs(process.argv.slice(2));
const transitionsPath = path.resolve(required(args, 'transitions'));
const outputPath = path.resolve(required(args, 'output'));
const policyModelId = required(args, 'policy-model-id');
const policyModelVersion = required(args, 'policy-model-version');
const policyManifestSha256 = sha256(required(args, 'policy-manifest-sha256'), 'policy-manifest-sha256');
const transitionArtifactRef = required(args, 'transition-artifact-ref');

const raw = fs.readFileSync(transitionsPath);
const transitions = raw.toString('utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid transition JSON at line ${index + 1}`);
    }
  });
const report = evaluateRecommendationSequentialDatasetV1(transitions);
const transitionArtifactSha256 = crypto.createHash('sha256').update(raw).digest('hex');
const transitionReportSha256 = crypto.createHash('sha256').update(canonicalJson(report)).digest('hex');
const attestation = {
  contractVersion: RECOMMENDATION_SEQUENTIAL_RL_EVIDENCE_V1,
  evaluator: RECOMMENDATION_SEQUENTIAL_RL_EVALUATOR_V1,
  policyModelId,
  policyModelVersion,
  policyManifestSha256,
  transitionArtifactSha256,
  transitionArtifactRef,
  transitionReportSha256,
  evaluatedAt: new Date().toISOString(),
  researchOnly: true,
  futureTestUsedForModelSelection: false,
  report,
};

fs.writeFileSync(outputPath, JSON.stringify(attestation, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify(attestation) + '\n');

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument near ${key ?? '<end>'}`);
    result[key.slice(2)] = value;
  }
  return result;
}

function required(args, name) {
  const value = args[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`--${name} is required`);
  return value;
}

function sha256(value, name) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`--${name} must be SHA256`);
  return value.toLowerCase();
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
