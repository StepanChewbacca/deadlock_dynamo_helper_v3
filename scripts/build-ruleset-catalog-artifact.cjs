#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const {
  canonicalizeRulesetCatalogV1,
  requireAuthoritativeRulesetCatalogV1,
} = require('../packages/deadlock-build-domain/dist');

function usage() {
  console.error(
    'Usage: node scripts/build-ruleset-catalog-artifact.cjs [--require-authoritative] <catalog.json> [artifact.json]',
  );
}

const args = process.argv.slice(2);
const requireAuthoritative = args.includes('--require-authoritative');
const positionalArgs = args.filter((arg) => arg !== '--require-authoritative');
const inputPath = positionalArgs[0];
const outputPath = positionalArgs[1];
if (!inputPath || positionalArgs.length > 2) {
  usage();
  process.exit(2);
}

const absoluteInput = path.resolve(inputPath);
const rawInput = JSON.parse(fs.readFileSync(absoluteInput, 'utf8'));
const manifest = requireAuthoritative
  ? requireAuthoritativeRulesetCatalogV1(rawInput)
  : canonicalizeRulesetCatalogV1(rawInput);
const canonicalJson = JSON.stringify(manifest);
const sha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
const artifact = {
  schemaVersion: 1,
  algorithm: 'sha256',
  sha256,
  version: `sha256:${sha256}`,
  authority: manifest.authority,
  sourceArtifactSha256: manifest.sourceArtifactSha256,
  manifest,
};
const serialized = `${JSON.stringify(artifact, null, 2)}\n`;

if (outputPath) {
  const absoluteOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(absoluteOutput, serialized);
  console.log(absoluteOutput);
} else {
  process.stdout.write(serialized);
}
