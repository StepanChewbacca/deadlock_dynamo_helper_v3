#!/usr/bin/env node

const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function usage() {
  console.error(
    'Usage: node scripts/extract-deadlock-authoritative-source.cjs --citadel-dir <Deadlock/game/citadel> --vrf <Source2Viewer-CLI> --output <directory>',
  );
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!['--citadel-dir', '--vrf', '--output'].includes(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}.`);
    }
    parsed[arg] = value;
    index += 1;
  }
  return parsed;
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function collectFiles(rootDirectory) {
  const rows = [];
  const visit = (currentDirectory) => {
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Symbolic links are not allowed in extracted authoritative source: ${absolutePath}`);
      }
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = path.relative(rootDirectory, absolutePath).split(path.sep).join('/');
      const stat = fs.statSync(absolutePath);
      rows.push({
        path: relativePath,
        size: stat.size,
        sha256: sha256File(absolutePath),
      });
    }
  };
  visit(rootDirectory);
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

function createBundleSha256(files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.path, 'utf8');
    hash.update('\0', 'utf8');
    hash.update(String(file.size), 'utf8');
    hash.update('\0', 'utf8');
    hash.update(file.sha256, 'utf8');
    hash.update('\n', 'utf8');
  }
  return hash.digest('hex');
}

function readClientVersion(steamInfPath) {
  const content = fs.readFileSync(steamInfPath, 'utf8');
  const match = content.match(/^ClientVersion\s*=\s*([^\r\n]+)$/im);
  if (!match) {
    throw new Error(`ClientVersion is missing from ${steamInfPath}.`);
  }
  const value = match[1].trim();
  if (!value) {
    throw new Error(`ClientVersion is empty in ${steamInfPath}.`);
  }
  return value;
}

function run() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    usage();
    process.exit(2);
  }

  const citadelDirectory = args['--citadel-dir'] && path.resolve(args['--citadel-dir']);
  const vrfPath = args['--vrf'] && path.resolve(args['--vrf']);
  const outputDirectory = args['--output'] && path.resolve(args['--output']);
  if (!citadelDirectory || !vrfPath || !outputDirectory) {
    usage();
    process.exit(2);
  }

  const vpkPath = path.join(citadelDirectory, 'pak01_dir.vpk');
  const steamInfPath = path.join(citadelDirectory, 'steam.inf');
  for (const requiredPath of [vpkPath, steamInfPath, vrfPath]) {
    if (!fs.existsSync(requiredPath) || !fs.statSync(requiredPath).isFile()) {
      throw new Error(`Required file does not exist: ${requiredPath}`);
    }
  }

  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  const extractedDirectory = path.join(outputDirectory, 'extracted');
  fs.mkdirSync(extractedDirectory, { recursive: true });

  const vrfArgs = [
    '--input',
    vpkPath,
    '--output',
    extractedDirectory,
    '--vpk_filepath',
    'scripts/',
    '--vpk_extensions',
    'vdata_c',
    '--vpk_decompile',
  ];
  const result = spawnSync(vrfPath, vrfArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    throw new Error(
      `Source2Viewer-CLI failed with exit code ${String(result.status)}${stderr ? `: ${stderr}` : ''}`,
    );
  }

  const files = collectFiles(extractedDirectory);
  if (files.length === 0) {
    throw new Error('Source2Viewer-CLI produced no scripts vdata files.');
  }
  if (!files.some((file) => file.path.toLowerCase().includes('abilities.vdata'))) {
    throw new Error('Authoritative extraction did not contain scripts/abilities.vdata output.');
  }

  const manifest = {
    schemaVersion: 1,
    authority: 'AUTHORITATIVE_INSTALLED_GAME',
    clientVersion: readClientVersion(steamInfPath),
    source: 'installed-game-vpk-extract',
    sourceVpk: {
      fileName: path.basename(vpkPath),
      sha256: sha256File(vpkPath),
    },
    extractor: {
      name: 'Source2Viewer-CLI',
      sha256: sha256File(vrfPath),
      args: vrfArgs.map((arg) =>
        arg === vpkPath
          ? '<CITADEL_DIR>/pak01_dir.vpk'
          : arg === extractedDirectory
            ? '<OUTPUT_DIR>/extracted'
            : arg,
      ),
    },
    files,
    sourceArtifactSha256: createBundleSha256(files),
  };

  const manifestPath = path.join(outputDirectory, 'source-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`${manifestPath}\n`);
}

if (require.main === module) {
  run();
}

module.exports = {
  collectFiles,
  createBundleSha256,
  parseArgs,
  readClientVersion,
  sha256File,
};
