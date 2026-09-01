import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptPath = resolve(
  __dirname,
  '../../../scripts/verify-deployed-api-image.sh',
);

function runVerification(runningRevision: string, runningImageId: string) {
  const binDir = mkdtempSync(join(tmpdir(), 'deadlock-fake-docker-'));
  const dockerPath = join(binDir, 'docker');
  writeFileSync(
    dockerPath,
    `#!/usr/bin/env bash
set -eu
if [ "$1" = "image" ]; then
  printf '%s\\n' "$FAKE_CANDIDATE_IMAGE_ID"
  exit 0
fi
format=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--format" ] || [ "$1" = "-f" ]; then
    shift
    format="$1"
    break
  fi
  shift
done
case "$format" in
  *org.opencontainers.image.revision*) printf '%s\\n' "$FAKE_RUNNING_REVISION" ;;
  *Image*) printf '%s\\n' "$FAKE_RUNNING_IMAGE_ID" ;;
  *) exit 2 ;;
esac
`,
    { mode: 0o755 },
  );

  const result = spawnSync(
    'bash',
    [scriptPath, 'expected-sha', 'api-container', 'deadlock-api:expected-sha'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        FAKE_CANDIDATE_IMAGE_ID: 'sha256:candidate',
        FAKE_RUNNING_IMAGE_ID: runningImageId,
        FAKE_RUNNING_REVISION: runningRevision,
      },
    },
  );
  rmSync(binDir, { recursive: true, force: true });
  return result;
}

describe('deployed API image verification', () => {
  it('accepts the exact revision and image selected for deployment', () => {
    const result = runVerification('expected-sha', 'sha256:candidate');

    expect(result.status).toBe(0);
  });

  it('rejects another revision even when it has the selected image id', () => {
    const result = runVerification('stale-sha', 'sha256:candidate');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('revision mismatch');
  });

  it('rejects another image even when it declares the selected revision', () => {
    const result = runVerification('expected-sha', 'sha256:stale');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('image mismatch');
  });

  it('wires exact artifact verification into forced production recreation', () => {
    const workflow = readFileSync(
      resolve(__dirname, '../../../.github/workflows/deploy.yml'),
      'utf8',
    );

    expect(workflow).toContain('docker compose up -d --force-recreate --no-build --no-deps api');
    expect(workflow).toContain('sudo bash scripts/verify-deployed-api-image.sh');
    expect(workflow).toContain('"$GITHUB_SHA"');
    expect(workflow).toContain('"$container_id"');
    expect(workflow).toContain('"$ADAPTIVE_PRODUCTION_IMAGE"');
  });
});
