const config = loadConfig();

await runPipeline();

async function runPipeline() {
  const startedAt = new Date().toISOString();
  console.log(`Recommendation V8 diagnostic-only pipeline started at ${startedAt}.`);

  const registry = await ensureCandidateSnapshot();
  const replay = await runHistoricalReplay();
  const dataset = await runDatasetV6(replay.manifest);
  const behavioral = await runBehavioralV5(dataset.manifest);
  const diagnostic = await runValueV8Diagnostic(dataset.manifest, behavioral.manifest);

  console.log(
    JSON.stringify(
      {
        startedAt,
        completedAt: new Date().toISOString(),
        runMode: 'DIAGNOSTIC_NON_RELEASE_REPAIRED_SOURCE',
        snapshotId: config.snapshotId,
        snapshotCount: registry.snapshots.length,
        replay: summarize(replay.status),
        datasetV6: summarize(dataset.status),
        behavioralV5: summarize(behavioral.status),
        valueV8Diagnostic: summarize(diagnostic.status),
        diagnosticGatePassed: diagnostic.status.diagnosticGatePassed === true,
        fullTrainingRecommended: diagnostic.status.fullTrainingRecommended === true,
        releaseEligible: false,
        offlineReleaseGateAccepted: false,
        passiveShadowAuthorized: false,
        passiveShadowActivatedByRunner: false,
        randomizedCanaryAuthorized: false,
      },
      null,
      2,
    ),
  );
}

async function ensureCandidateSnapshot() {
  const registryPath =
    '/deadlock/analysis/recommendation-candidate-generator-snapshots/registry';
  let registry = await get(registryPath);
  assertSnapshots(registry);

  if (registry.snapshots.some((entry) => entry.snapshotId === config.snapshotId)) {
    console.log(`Candidate snapshot ${config.snapshotId} already exists.`);
    return registry;
  }

  await runStage({
    name: 'Candidate snapshot',
    startPath:
      '/deadlock/analysis/recommendation-candidate-generator-snapshots/start',
    statusPath:
      '/deadlock/analysis/recommendation-candidate-generator-snapshots/status',
    body: compact({
      snapshotId: config.snapshotId,
      generatorVersion: config.generatorVersion,
      policyVersion: config.policyVersion,
      catalogVersionId: config.catalogVersionId,
      trainingWindowStart: config.trainingWindowStart,
      trainingWindowEnd: config.trainingWindowEnd,
      expectedSourceSha256: config.expectedSnapshotSourceSha256,
    }),
  });

  registry = await get(registryPath);
  assertSnapshots(registry);
  assertTrue(
    registry.snapshots.some((entry) => entry.snapshotId === config.snapshotId),
    `Candidate snapshot ${config.snapshotId} is missing after export.`,
  );
  return registry;
}

async function runHistoricalReplay() {
  const status = await runStage({
    name: 'Historical replay',
    startPath: '/deadlock/analysis/recommendation-historical-pro-replay/start',
    statusPath: '/deadlock/analysis/recommendation-historical-pro-replay/status',
    body: compact({
      partitionCount: config.replayPartitionCount,
      snapshotStalenessS: config.replaySnapshotStalenessS,
      resume: true,
    }),
  });
  assertTrue(status.auditPassed, 'Historical replay audit failed.');

  const manifest = await get(
    '/deadlock/analysis/recommendation-historical-pro-replay/manifest',
  );
  const audit = await get(
    '/deadlock/analysis/recommendation-historical-pro-replay/audit',
  );
  assertTrue(manifest.auditPassed, 'Historical replay manifest audit flag is false.');
  assertTrue(audit.passed, 'Historical replay structural audit failed.');
  assertFalse(
    manifest.featureContract.userLiveUsedAsInput,
    'Historical replay used USER_LIVE input.',
  );
  assertFalse(
    manifest.featureContract.observedActionInjectedIntoCandidates,
    'Historical replay injected the observed action into candidates.',
  );
  return { status, manifest, audit };
}

async function runDatasetV6(replayManifest) {
  const status = await runStage({
    name: 'Dataset V6',
    startPath: '/deadlock/analysis/recommendation-pro-decision-dataset-v6/start',
    statusPath: '/deadlock/analysis/recommendation-pro-decision-dataset-v6/status',
    body: compact({
      tuningStart: config.tuningStart,
      futureTestStart: config.futureTestStart,
      expectedReplaySha256: requiredPath(
        replayManifest,
        ['artifact', 'sha256'],
        'Historical replay SHA-256',
      ),
      expectedSnapshotRegistrySha256: requiredPath(
        replayManifest,
        ['candidateGeneratorSnapshots', 'registrySha256'],
        'Snapshot registry SHA-256',
      ),
      decisionSnapshotStalenessS: config.datasetSnapshotStalenessS,
    }),
  });
  assertTrue(status.auditPassed, 'Dataset V6 audit failed.');

  const manifest = await get(
    '/deadlock/analysis/recommendation-pro-decision-dataset-v6/manifest',
  );
  const audit = await get(
    '/deadlock/analysis/recommendation-pro-decision-dataset-v6/audit',
  );
  assertTrue(manifest.auditPassed, 'Dataset V6 manifest audit flag is false.');
  assertTrue(audit.passed, 'Dataset V6 structural audit failed.');
  assertFalse(
    manifest.featureContract.userLiveUsedAsInput,
    'Dataset V6 used USER_LIVE input.',
  );
  assertFalse(
    manifest.featureContract.futureTestEligibleForSelection,
    'Dataset V6 made FUTURE_TEST eligible for selection.',
  );
  return { status, manifest, audit };
}

async function runBehavioralV5(datasetManifest) {
  const status = await runStage({
    name: 'Behavioral V5',
    startPath: '/deadlock/analysis/recommendation-behavioral-v5-training/start',
    statusPath: '/deadlock/analysis/recommendation-behavioral-v5-training/status',
    body: {
      expectedSourceSha256: datasetSha(datasetManifest),
    },
  });

  const manifest = await get(
    '/deadlock/analysis/recommendation-behavioral-v5-training/manifest',
  );
  const audit = await get(
    '/deadlock/analysis/recommendation-behavioral-v5-training/audit',
  );
  const evaluation = await get(
    '/deadlock/analysis/recommendation-behavioral-v5-training/evaluation',
  );
  assertTrue(audit.passed, 'Behavioral V5 audit failed.');
  assertTrue(
    audit.trainingArtifactEligible,
    'Behavioral V5 audit is not training-artifact eligible.',
  );
  assertTrue(
    manifest.auditPassed,
    'Behavioral V5 manifest audit flag is false.',
  );
  assertTrue(
    manifest.releaseGatePassed,
    'Behavioral V5 manifest release gate failed.',
  );
  assertTrue(
    manifest.trainingArtifactEligible,
    'Behavioral V5 manifest is not training-artifact eligible.',
  );
  assertTrue(
    evaluation?.releaseGate?.passed,
    'Behavioral V5 evaluation release gate failed.',
  );
  assertTrue(
    status.releaseGatePassed,
    'Behavioral V5 status release gate failed.',
  );
  assertTrue(
    status.trainingArtifactEligible,
    'Behavioral V5 status is not training-artifact eligible.',
  );
  return { status, manifest, audit, evaluation };
}

async function runValueV8Diagnostic(datasetManifest, behavioralManifest) {
  const status = await runStage({
    name: 'Value V8 diagnostic',
    startPath: '/deadlock/analysis/recommendation-value-v8-diagnostic/start',
    statusPath: '/deadlock/analysis/recommendation-value-v8-diagnostic/status',
    body: {
      maxRows: config.diagnosticMaxRows,
      expectedDatasetSha256: datasetSha(datasetManifest),
      expectedBehavioralPropensitySha256: artifactSha(
        behavioralManifest,
        'propensities.ndjson',
      ),
    },
  });

  const manifest = await get(
    '/deadlock/analysis/recommendation-value-v8-diagnostic/manifest',
  );
  const audit = await get(
    '/deadlock/analysis/recommendation-value-v8-diagnostic/audit',
  );
  const evaluation = await get(
    '/deadlock/analysis/recommendation-value-v8-diagnostic/evaluation',
  );
  assertTrue(audit.passed, 'Value V8 diagnostic audit failed.');
  assertTrue(
    audit.diagnosticArtifactEligible,
    'Value V8 diagnostic artifact is not eligible.',
  );
  assertFalse(
    audit.leakage.futureTestUsedForTraining,
    'Value V8 diagnostic used FUTURE_TEST for training.',
  );
  assertFalse(
    audit.leakage.futureTestUsedForSelection,
    'Value V8 diagnostic used FUTURE_TEST for selection.',
  );
  assertFalse(manifest.futureTestUsed, 'Value V8 diagnostic manifest used FUTURE_TEST.');
  assertFalse(
    evaluation.futureTest.evaluated,
    'Value V8 diagnostic evaluated FUTURE_TEST.',
  );
  return { status, manifest, audit, evaluation };
}

async function runStage({ name, startPath, statusPath, body }) {
  const deadline = Date.now() + config.pipelineTimeoutMs;
  let status = await get(statusPath);
  let previousPhase;

  if (status.state === 'COMPLETE') {
    console.log(`${name}: already COMPLETE/${status.phase}.`);
    return status;
  }

  if (status.state === 'RUNNING') {
    console.log(`${name}: resuming ${status.state}/${status.phase}.`);
  } else {
    console.log(`${name}: starting.`);
    try {
      await post(startPath, body);
    } catch (error) {
      const afterStart = await get(statusPath);
      if (!['RUNNING', 'COMPLETE'].includes(afterStart.state)) {
        throw error;
      }
      status = afterStart;
      console.warn(
        `${name}: start request failed after the server accepted the stage; ` +
          `continuing from ${status.state}/${status.phase}.`,
      );
    }
  }

  while (Date.now() < deadline) {
    status = await get(statusPath);
    if (status.phase !== previousPhase) {
      console.log(`${name}: ${status.state}/${status.phase}.`);
      previousPhase = status.phase;
    }
    if (status.state === 'COMPLETE') {
      return status;
    }
    if (status.state === 'FAILED') {
      throw new Error(`${name} failed: ${status.error || 'unknown error'}`);
    }
    await sleep(config.pollIntervalMs);
  }

  throw new Error(`${name} exceeded PIPELINE_TIMEOUT_MS.`);
}

function loadConfig() {
  return {
    apiBaseUrl: requiredString('API_BASE_URL').replace(/\/+$/, ''),
    snapshotId: requiredString('SNAPSHOT_ID'),
    generatorVersion: requiredString('CANDIDATE_GENERATOR_VERSION'),
    policyVersion: requiredString('CANDIDATE_POLICY_VERSION'),
    catalogVersionId: requiredInteger('CATALOG_VERSION_ID'),
    trainingWindowStart: requiredString('TRAINING_WINDOW_START'),
    trainingWindowEnd: requiredString('TRAINING_WINDOW_END'),
    tuningStart: requiredString('TUNING_START'),
    futureTestStart: requiredString('FUTURE_TEST_START'),
    diagnosticMaxRows: optionalIntegerInRange(
      'DIAGNOSTIC_MAX_ROWS',
      10000,
      100,
      50000,
    ),
    pollIntervalMs: optionalInteger('PIPELINE_POLL_INTERVAL_MS', 5000),
    pipelineTimeoutMs: optionalInteger(
      'PIPELINE_TIMEOUT_MS',
      24 * 60 * 60 * 1000,
    ),
    requestTimeoutMs: optionalInteger('PIPELINE_REQUEST_TIMEOUT_MS', 30000),
    requestRetryCount: optionalInteger('PIPELINE_REQUEST_RETRY_COUNT', 240),
    requestRetryDelayMs: optionalInteger(
      'PIPELINE_REQUEST_RETRY_DELAY_MS',
      5000,
    ),
    expectedSnapshotSourceSha256: optionalString(
      'EXPECTED_SNAPSHOT_SOURCE_SHA256',
    ),
    replayPartitionCount: optionalInteger('REPLAY_PARTITION_COUNT'),
    replaySnapshotStalenessS: optionalInteger('REPLAY_SNAPSHOT_STALENESS_S'),
    datasetSnapshotStalenessS: optionalInteger(
      'DATASET_DECISION_SNAPSHOT_STALENESS_S',
    ),
  };
}

async function get(path) {
  return requestWithRetry('GET', path);
}

async function post(path, body) {
  return request('POST', path, body);
}

async function requestWithRetry(method, path, body) {
  for (let attempt = 1; attempt <= config.requestRetryCount; attempt += 1) {
    try {
      return await request(method, path, body);
    } catch (error) {
      if (!isTransientRequestError(error) || attempt === config.requestRetryCount) {
        throw error;
      }
      console.warn(
        `${method} ${path} transient failure on attempt ${attempt}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      await sleep(config.requestRetryDelayMs);
    }
  }
  throw new Error(`${method} ${path} retry loop exhausted.`);
}

async function request(method, path, body) {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  const text = await response.text();
  let value;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${method} ${path} returned invalid JSON.`);
  }
  if (!response.ok) {
    const error = new Error(
      `${method} ${path} returned ${response.status}: ${JSON.stringify(value)}`,
    );
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  return value;
}

function isTransientRequestError(error) {
  if (error && typeof error === 'object' && error.retryable === true) {
    return true;
  }
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  return (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    error instanceof TypeError ||
    /timeout|fetch failed|socket|ECONNRESET|ECONNREFUSED/i.test(message)
  );
}

function datasetSha(manifest) {
  return requiredPath(manifest, ['artifact', 'sha256'], 'Dataset V6 SHA-256');
}

function artifactSha(value, fileName) {
  const descriptor = findArtifact(value, fileName);
  if (!descriptor || typeof descriptor.sha256 !== 'string') {
    throw new Error(`Artifact descriptor for ${fileName} is missing.`);
  }
  return descriptor.sha256;
}

function findArtifact(value, fileName) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  if (value.fileName === fileName) {
    return value;
  }
  for (const child of Object.values(value)) {
    const found = findArtifact(child, fileName);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function requiredPath(value, path, label) {
  let current = value;
  for (const key of path) {
    current = current?.[key];
  }
  if (typeof current !== 'string' || current.length === 0) {
    throw new Error(`${label} is missing.`);
  }
  return current;
}

function summarize(status) {
  return compact({
    state: status.state,
    phase: status.phase,
    sourceRowCount: status.sourceRowCount,
    outputRowCount: status.outputRowCount,
    predictionRowCount: status.predictionRowCount,
    trainDecisionCount: status.trainDecisionCount,
    tuningDecisionCount: status.tuningDecisionCount,
    futureTestDecisionCount: status.futureTestDecisionCount,
    diagnosticGatePassed: status.diagnosticGatePassed,
    fullTrainingRecommended: status.fullTrainingRecommended,
  });
}

function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function assertSnapshots(registry) {
  if (!Array.isArray(registry.snapshots)) {
    throw new Error('Candidate snapshot registry has no snapshots array.');
  }
}

function assertTrue(value, message) {
  if (value !== true) {
    throw new Error(message);
  }
}

function assertFalse(value, message) {
  if (value !== false) {
    throw new Error(message);
  }
}

function requiredString(name) {
  const value = optionalString(name);
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

function optionalString(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function requiredInteger(name) {
  const value = optionalInteger(name);
  if (value === undefined) {
    throw new Error(`Missing required integer environment variable ${name}.`);
  }
  return value;
}

function optionalInteger(name, fallback) {
  const raw = optionalString(name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function optionalIntegerInRange(name, fallback, minimum, maximum) {
  const value = optionalInteger(name, fallback);
  if (value === undefined || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
