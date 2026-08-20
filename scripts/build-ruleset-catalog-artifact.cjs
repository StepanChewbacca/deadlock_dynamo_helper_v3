#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const {
  canonicalizeRulesetCatalogV1,
} = require('../packages/deadlock-build-domain/dist');

function usage() {
  console.error('Usage: node scripts/build-ruleset-catalog-artifact.cjs <catalog.json> [artifact.json]');
}

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath) {
  usage();
  process.exit(2);
}

const absoluteInput = path.resolve(inputPath);
const rawInput = JSON.parse(fs.readFileSync(absoluteInput, 'utf8'));
const manifest = canonicalizeRulesetCatalogV1(rawInput);
const canonicalJson = JSON.stringify(manifest);
const sha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
const artifact = {
  schemaVersion: 1,
  algorithm: 'sha256',
  sha256,
  version: `sha256:${sha256}`,
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
