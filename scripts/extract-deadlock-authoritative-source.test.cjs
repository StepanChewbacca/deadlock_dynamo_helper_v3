const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  collectFiles,
  createBundleSha256,
  parseArgs,
  readClientVersion,
  sha256File,
} = require('./extract-deadlock-authoritative-source.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deadlock-authoritative-source-'));
try {
  const extracted = path.join(root, 'extracted');
  fs.mkdirSync(path.join(extracted, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(extracted, 'scripts', 'abilities.vdata'), 'abilities\n', 'utf8');
  fs.writeFileSync(path.join(extracted, 'scripts', 'misc.vdata'), 'misc\n', 'utf8');

  const files = collectFiles(extracted);
  assert.deepEqual(
    files.map((file) => file.path),
    ['scripts/abilities.vdata', 'scripts/misc.vdata'],
  );
  assert.equal(files[0].sha256, sha256File(path.join(extracted, 'scripts', 'abilities.vdata')));

  const firstBundleSha = createBundleSha256(files);
  const secondBundleSha = createBundleSha256([...files].reverse().sort((a, b) => a.path.localeCompare(b.path)));
  assert.equal(firstBundleSha, secondBundleSha);
  assert.match(firstBundleSha, /^[a-f0-9]{64}$/);

  const steamInf = path.join(root, 'steam.inf');
  fs.writeFileSync(steamInf, 'ClientVersion=6101\nPatchVersion=1\n', 'utf8');
  assert.equal(readClientVersion(steamInf), '6101');

  assert.deepEqual(
    parseArgs([
      '--citadel-dir',
      '/game/citadel',
      '--vrf',
      '/tools/Source2Viewer-CLI',
      '--output',
      '/tmp/out',
    ]),
    {
      '--citadel-dir': '/game/citadel',
      '--vrf': '/tools/Source2Viewer-CLI',
      '--output': '/tmp/out',
    },
  );
  assert.throws(
    () => parseArgs(['--unknown', 'value']),
    /Unknown argument/,
  );

  console.log('authoritative source extractor helpers: PASS');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
