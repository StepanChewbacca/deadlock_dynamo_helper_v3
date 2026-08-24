import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-model-identity-'));
try {
  const base = {
    contractVersion: 'model-bundle-v1',
    modelId: 'behavioral-v8',
    modelVersion: 'v1',
    modelKind: 'BEHAVIORAL',
    supportedRulesetVersions: ['r2', 'r1'],
    supportedCatalogSha256: ['b'.repeat(64), 'a'.repeat(64)],
    files: [
      { path: 'z.bin', sha256: 'c'.repeat(64), sizeBytes: 2 },
      { path: 'a.bin', sha256: 'd'.repeat(64), sizeBytes: 1 },
    ],
    gates: [
      { name: 'Z_GATE', status: 'PASS', value: true, threshold: true },
      { name: 'A_GATE', status: 'PASS', value: true, threshold: true },
    ],
    futureTestEvaluated: false,
  };
  const reordered = {
    ...base,
    supportedRulesetVersions: [...base.supportedRulesetVersions].reverse(),
    supportedCatalogSha256: [...base.supportedCatalogSha256].reverse(),
    files: [...base.files].reverse(),
    gates: [...base.gates].reverse(),
  };
  const changed = { ...base, modelVersion: 'v2' };

  const first = calculate(root, 'first', base);
  const second = calculate(root, 'second', reordered);
  const third = calculate(root, 'third', changed);

  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.notEqual(first.manifestSha256, third.manifestSha256);
  assert.equal(first.modelId, 'behavioral-v8');
  assert.equal(first.modelVersion, 'v1');
  console.log('recommendation model manifest identity fixtures: PASS');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function calculate(rootDir, name, manifest) {
  const manifestPath = path.join(rootDir, `${name}.json`);
  const outputPath = path.join(rootDir, `${name}-identity.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  const result = spawnSync(process.execPath, [
    'scripts/recommendation-model-manifest-identity.mjs',
    manifestPath,
    outputPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'identity helper failed');
  return JSON.parse(fs.readFileSync(outputPath, 'utf8'));
}
