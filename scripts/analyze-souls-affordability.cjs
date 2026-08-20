#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {
  analyzeSoulsAffordabilityV1,
} = require('../packages/shared/dist');

function usage() {
  console.error('Usage: node scripts/analyze-souls-affordability.cjs <observations.ndjson> [report.json]');
}

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath) {
  usage();
  process.exit(2);
}

const absoluteInput = path.resolve(inputPath);
const lines = fs.readFileSync(absoluteInput, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const observations = lines.map((line, index) => {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid JSON at ${absoluteInput}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
  }
});

const report = analyzeSoulsAffordabilityV1(observations);
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  const absoluteOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(absoluteOutput, serialized);
  console.log(absoluteOutput);
} else {
  process.stdout.write(serialized);
}

if (report.verdict === 'FAIL') {
  process.exitCode = 1;
} else if (report.verdict === 'INSUFFICIENT_EVIDENCE') {
  process.exitCode = 3;
}
