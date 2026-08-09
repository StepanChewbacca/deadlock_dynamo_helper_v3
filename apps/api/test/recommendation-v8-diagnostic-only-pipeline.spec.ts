import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';

const runnerPath = resolve(
  __dirname,
  '../../../scripts/run-recommendation-v8-diagnostic-only-pipeline.mjs',
);

const requiredEnv = {
  SNAPSHOT_ID: 'test-snapshot',
  CANDIDATE_GENERATOR_VERSION: 'TEST_GENERATOR',
  CANDIDATE_POLICY_VERSION: 'TEST_POLICY',
  CATALOG_VERSION_ID: '1',
  TRAINING_WINDOW_START: '2026-01-01T00:00:00.000Z',
  TRAINING_WINDOW_END: '2026-01-02T00:00:00.000Z',
  TUNING_START: '2026-01-03T00:00:00.000Z',
  FUTURE_TEST_START: '2026-01-04T00:00:00.000Z',
  PIPELINE_REQUEST_RETRY_COUNT: '1',
  PIPELINE_REQUEST_TIMEOUT_MS: '1000',
  PIPELINE_POLL_INTERVAL_MS: '10',
  PIPELINE_TIMEOUT_MS: '1000',
} as const;

describe('Recommendation V8 diagnostic-only pipeline orchestration', () => {
  it('rejects DIAGNOSTIC_MAX_ROWS above the API maximum before network access', async () => {
    const result = await runRunner({
      API_BASE_URL: 'http://127.0.0.1:1',
      DIAGNOSTIC_MAX_ROWS: '50001',
    });

    expect(result.code).not.toBe(0);
    expect(result.output).toContain(
      'DIAGNOSTIC_MAX_ROWS must be between 100 and 50000.',
    );
    expect(result.output).not.toContain('fetch failed');
  });

  it('rejects DIAGNOSTIC_MAX_ROWS below the API minimum before network access', async () => {
    const result = await runRunner({
      API_BASE_URL: 'http://127.0.0.1:1',
      DIAGNOSTIC_MAX_ROWS: '99',
    });

    expect(result.code).not.toBe(0);
    expect(result.output).toContain(
      'DIAGNOSTIC_MAX_ROWS must be between 100 and 50000.',
    );
    expect(result.output).not.toContain('fetch failed');
  });

  it('stops before Value V8 when Behavioral V5 is not release eligible', async () => {
    const requestedPaths: string[] = [];
    const server = createServer((request, response) => {
      const path = request.url ?? '';
      requestedPaths.push(path);
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(responseFor(path)));
    });
    await listen(server);
    const address = server.address();
    if (!address || typeof address === 'string') {
      await close(server);
      throw new Error('Test server address is unavailable.');
    }

    try {
      const result = await runRunner({
        API_BASE_URL: `http://127.0.0.1:${address.port}`,
        DIAGNOSTIC_MAX_ROWS: '50000',
      });

      expect(result.code).not.toBe(0);
      expect(result.output).toContain(
        'Behavioral V5 audit is not training-artifact eligible.',
      );
      expect(
        requestedPaths.some((path) =>
          path.includes('/recommendation-value-v8-diagnostic/'),
        ),
      ).toBe(false);
    } finally {
      await close(server);
    }
  });
});

function responseFor(path: string): Record<string, unknown> {
  if (
    path ===
    '/deadlock/analysis/recommendation-candidate-generator-snapshots/registry'
  ) {
    return { snapshots: [{ snapshotId: 'test-snapshot' }] };
  }
  if (path.endsWith('/recommendation-historical-pro-replay/status')) {
    return { state: 'COMPLETE', phase: 'COMPLETE', auditPassed: true };
  }
  if (path.endsWith('/recommendation-historical-pro-replay/manifest')) {
    return {
      auditPassed: true,
      artifact: { sha256: 'a'.repeat(64) },
      candidateGeneratorSnapshots: { registrySha256: 'b'.repeat(64) },
      featureContract: {
        userLiveUsedAsInput: false,
        observedActionInjectedIntoCandidates: false,
      },
    };
  }
  if (path.endsWith('/recommendation-historical-pro-replay/audit')) {
    return { passed: true };
  }
  if (path.endsWith('/recommendation-pro-decision-dataset-v6/status')) {
    return { state: 'COMPLETE', phase: 'COMPLETE', auditPassed: true };
  }
  if (path.endsWith('/recommendation-pro-decision-dataset-v6/manifest')) {
    return {
      auditPassed: true,
      artifact: { sha256: 'c'.repeat(64) },
      featureContract: {
        userLiveUsedAsInput: false,
        futureTestEligibleForSelection: false,
      },
    };
  }
  if (path.endsWith('/recommendation-pro-decision-dataset-v6/audit')) {
    return { passed: true };
  }
  if (path.endsWith('/recommendation-behavioral-v5-training/status')) {
    return {
      state: 'COMPLETE',
      phase: 'COMPLETE',
      releaseGatePassed: false,
      trainingArtifactEligible: false,
    };
  }
  if (path.endsWith('/recommendation-behavioral-v5-training/manifest')) {
    return {
      auditPassed: true,
      releaseGatePassed: false,
      trainingArtifactEligible: false,
    };
  }
  if (path.endsWith('/recommendation-behavioral-v5-training/audit')) {
    return { passed: true, trainingArtifactEligible: false };
  }
  if (path.endsWith('/recommendation-behavioral-v5-training/evaluation')) {
    return { releaseGate: { passed: false } };
  }
  throw new Error(`Unexpected test request path: ${path}`);
}

async function runRunner(
  env: Record<string, string>,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [runnerPath], {
      env: {
        ...process.env,
        ...requiredEnv,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('close', (code) => {
      resolvePromise({ code, output });
    });
  });
}

function listen(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise();
    });
  });
}
