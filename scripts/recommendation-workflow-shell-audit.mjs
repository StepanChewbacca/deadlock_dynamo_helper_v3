import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const targets = [
  '.github/workflows/recommendation-behavioral-training.yml',
  '.github/workflows/recommendation-dataset-export.yml',
  '.github/workflows/recommendation-dataset-register-verify.yml',
  '.github/workflows/recommendation-future-test-evaluation.yml',
  '.github/workflows/recommendation-model-activation.yml',
  '.github/workflows/recommendation-model-register-verify.yml',
  '.github/workflows/recommendation-policy-bundle-build.yml',
  '.github/workflows/recommendation-pretraining-readiness.yml',
  '.github/workflows/recommendation-roadmap-materialization.yml',
  '.github/workflows/recommendation-sequential-rl-readiness.yml',
  '.github/workflows/recommendation-value-dataset-export.yml',
  '.github/workflows/recommendation-value-training.yml',
];
const errors = [];

for (const relativePath of targets) {
  const absolutePath = path.resolve(relativePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`${relativePath}: workflow is missing`);
    continue;
  }
  const workflowText = fs.readFileSync(absolutePath, 'utf8').replace(/\r\n/g, '\n');
  const blocks = extractBashRunBlocks(workflowText);
  if (blocks.length === 0) {
    errors.push(`${relativePath}: no shell run blocks found`);
    continue;
  }
  for (const block of blocks) {
    const result = spawnSync('bash', ['-n'], {
      input: block.body,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || 'bash -n failed').trim().replace(/\s+/g, ' ');
      errors.push(`${relativePath}: run block starting near line ${block.line} has invalid bash syntax: ${detail}`);
    }
  }
}

if (errors.length > 0) {
  console.error('recommendation workflow shell audit: FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('recommendation workflow shell audit: PASS');

function extractBashRunBlocks(workflowText) {
  const lines = workflowText.split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)run:\s*\|[-+]?\s*$/);
    if (!match) continue;
    const runIndent = match[1].length;
    const collected = [];
    for (let inner = index + 1; inner < lines.length; inner += 1) {
      const line = lines[inner];
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (line.trim() !== '' && indent <= runIndent) break;
      collected.push(line);
    }
    const nonEmptyIndents = collected
      .filter((line) => line.trim() !== '')
      .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
    if (nonEmptyIndents.length === 0) continue;
    const contentIndent = Math.min(...nonEmptyIndents);
    const body = `${collected.map((line) => line.slice(Math.min(contentIndent, line.length))).join('\n')}\n`;
    blocks.push({ line: index + 1, body });
  }
  return blocks;
}
