import crypto from 'node:crypto';
import fs from 'node:fs';

const [, , manifestPath, outputPath] = process.argv;
if (!manifestPath) {
  console.error('Usage: node scripts/recommendation-model-manifest-identity.mjs <manifest.json> [output.json]');
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
  throw new Error('Model manifest must be a JSON object');
}
if (typeof manifest.modelId !== 'string' || !manifest.modelId.trim()) {
  throw new Error('Model manifest modelId is required');
}
if (typeof manifest.modelVersion !== 'string' || !manifest.modelVersion.trim()) {
  throw new Error('Model manifest modelVersion is required');
}
for (const field of ['supportedRulesetVersions', 'supportedCatalogSha256', 'files', 'gates']) {
  if (!Array.isArray(manifest[field])) throw new Error(`Model manifest ${field} must be an array`);
}

const canonical = canonicalizeModelManifest(manifest);
const identity = {
  modelId: manifest.modelId,
  modelVersion: manifest.modelVersion,
  manifestSha256: crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
};
const payload = `${JSON.stringify(identity, null, 2)}\n`;
if (outputPath) fs.writeFileSync(outputPath, payload, { encoding: 'utf8', flag: 'wx' });
else process.stdout.write(payload);

export function canonicalizeModelManifest(value) {
  return {
    ...value,
    supportedRulesetVersions: [...value.supportedRulesetVersions].sort(),
    supportedCatalogSha256: [...value.supportedCatalogSha256].sort(),
    files: [...value.files].map((file) => ({ ...file })).sort((left, right) => String(left.path).localeCompare(String(right.path))),
    gates: [...value.gates].map((gate) => ({ ...gate })).sort((left, right) => String(left.name).localeCompare(String(right.name))),
  };
}
