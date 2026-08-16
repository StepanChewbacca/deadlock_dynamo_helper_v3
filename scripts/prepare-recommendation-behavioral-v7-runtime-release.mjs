import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const operation = (process.env.BEHAVIORAL_V7_RUNTIME_OPERATION ?? 'STATUS')
  .trim()
  .toUpperCase();
const runtimeRoot = resolve(required('BEHAVIORAL_V7_RUNTIME_ROOT'));
const releasesRoot = join(runtimeRoot, 'releases');
const currentLink = join(runtimeRoot, 'current');
const previousLink = join(runtimeRoot, 'previous');
const statePath = join(runtimeRoot, 'deployment-state.json');

await mkdir(releasesRoot, { recursive: true });

if (operation === 'STATUS') {
  console.log(JSON.stringify(await status(), null, 2));
} else if (operation === 'STAGE') {
  const staged = await stageRelease();
  console.log(JSON.stringify(staged, null, 2));
} else if (operation === 'ROLLBACK') {
  const rolledBack = await rollbackRelease();
  console.log(JSON.stringify(rolledBack, null, 2));
} else {
  throw new Error(
    'BEHAVIORAL_V7_RUNTIME_OPERATION must be STATUS, STAGE or ROLLBACK.',
  );
}

async function stageRelease() {
  const source = await loadVerifiedSource();
  const releaseId = source.modelArtifactSha256;
  const releaseDirectory = join(releasesRoot, releaseId);
  assertInsideRuntimeRoot(releaseDirectory);

  if (await exists(releaseDirectory)) {
    await validateInstalledRelease(releaseDirectory, releaseId);
  } else {
    const partialDirectory = join(
      releasesRoot,
      `.${releaseId}.partial-${process.pid}`,
    );
    assertInsideRuntimeRoot(partialDirectory);
    await rm(partialDirectory, { recursive: true, force: true });
    await mkdir(partialDirectory, { recursive: false });
    try {
      await copyFile(source.modelPath, join(partialDirectory, 'model.json'));
      await copyFile(
        source.verificationPath,
        join(partialDirectory, 'verification.json'),
      );
      await copyFile(
        source.releaseManifestPath,
        join(partialDirectory, 'release-manifest.json'),
      );
      await writeJson(join(partialDirectory, 'install-manifest.json'), {
        schemaVersion: 1,
        operation: 'RECOMMENDATION_BEHAVIORAL_V7_RUNTIME_RELEASE_INSTALL',
        installedAt: new Date().toISOString(),
        releaseId,
        datasetV7Sha256: source.datasetV7Sha256,
        modelArtifactSha256: source.modelArtifactSha256,
        verificationSha256: source.verificationSha256,
        releaseManifestSha256: source.releaseManifestSha256,
        releaseGatePassed: true,
        structuralAuditPassed: true,
        rawPropensityContractPassed: true,
        sourceArtifactsCopiedByteForByte: true,
        productionApiRestarted: false,
        productionRankingChanged: false,
      });
      await validateInstalledRelease(partialDirectory, releaseId);
      await rename(partialDirectory, releaseDirectory);
    } catch (error) {
      await rm(partialDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  const oldCurrent = await readManagedLink(currentLink);
  if (oldCurrent && oldCurrent !== managedTarget(releaseId)) {
    await atomicManagedLink(previousLink, oldCurrent);
  }
  await atomicManagedLink(currentLink, managedTarget(releaseId));

  const result = {
    schemaVersion: 1,
    operation: 'RECOMMENDATION_BEHAVIORAL_V7_RUNTIME_RELEASE_STAGE',
    stagedAt: new Date().toISOString(),
    releaseId,
    previousReleaseId: releaseIdFromTarget(oldCurrent),
    currentTarget: managedTarget(releaseId),
    datasetV7Sha256: source.datasetV7Sha256,
    modelArtifactSha256: source.modelArtifactSha256,
    releaseGatePassed: true,
    atomicPointerSwap: true,
    immutableVersionedDirectory: true,
    rollbackPointerRetained: oldCurrent !== undefined,
    productionApiRestarted: false,
    productionRankingChanged: false,
    passiveShadowActivated: false,
    randomizedCanaryAuthorized: false,
  };
  await writeJsonAtomic(statePath, result);
  return result;
}

async function rollbackRelease() {
  const currentTarget = await readManagedLink(currentLink);
  const previousTarget = await readManagedLink(previousLink);
  if (!currentTarget) {
    throw new Error('Behavioral V7 runtime current release is not installed.');
  }
  if (!previousTarget) {
    throw new Error('Behavioral V7 runtime previous release is unavailable.');
  }
  const previousReleaseId = releaseIdFromTarget(previousTarget);
  if (!previousReleaseId) {
    throw new Error('Behavioral V7 previous release pointer is invalid.');
  }
  await validateInstalledRelease(
    join(releasesRoot, previousReleaseId),
    previousReleaseId,
  );

  await atomicManagedLink(currentLink, previousTarget);
  await atomicManagedLink(previousLink, currentTarget);
  const result = {
    schemaVersion: 1,
    operation: 'RECOMMENDATION_BEHAVIORAL_V7_RUNTIME_RELEASE_ROLLBACK',
    rolledBackAt: new Date().toISOString(),
    fromReleaseId: releaseIdFromTarget(currentTarget),
    toReleaseId: previousReleaseId,
    atomicPointerSwap: true,
    productionApiRestarted: false,
    productionRankingChanged: false,
    passiveShadowActivated: false,
    randomizedCanaryAuthorized: false,
  };
  await writeJsonAtomic(statePath, result);
  return result;
}

async function status() {
  const currentTarget = await readManagedLink(currentLink);
  const previousTarget = await readManagedLink(previousLink);
  const currentReleaseId = releaseIdFromTarget(currentTarget);
  const previousReleaseId = releaseIdFromTarget(previousTarget);
  let currentValid = false;
  let currentError;
  if (currentReleaseId) {
    try {
      await validateInstalledRelease(
        join(releasesRoot, currentReleaseId),
        currentReleaseId,
      );
      currentValid = true;
    } catch (error) {
      currentError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    schemaVersion: 1,
    operation: 'RECOMMENDATION_BEHAVIORAL_V7_RUNTIME_RELEASE_STATUS',
    checkedAt: new Date().toISOString(),
    runtimeRoot,
    currentReleaseId,
    previousReleaseId,
    currentValid,
    ...(currentError ? { currentError } : {}),
    productionApiRestartedByThisTool: false,
    productionRankingChangedByThisTool: false,
  };
}

async function loadVerifiedSource() {
  const modelPath = resolve(required('BEHAVIORAL_V7_RUNTIME_MODEL_PATH'));
  const verificationPath = resolve(
    required('BEHAVIORAL_V7_RUNTIME_VERIFICATION_PATH'),
  );
  const releaseManifestPath = resolve(
    required('BEHAVIORAL_V7_RUNTIME_RELEASE_MANIFEST_PATH'),
  );
  const [verification, releaseManifest] = await Promise.all([
    readJson(verificationPath),
    readJson(releaseManifestPath),
  ]);
  if (
    verification?.operation !==
      'RECOMMENDATION_BEHAVIORAL_V7_FINAL_FUTURE_TEST_VERIFICATION' ||
    verification?.releaseGatePassed !== true ||
    verification?.structuralAuditPassed !== true ||
    verification?.rawPropensityAudit?.rawPropensityContractPassed !== true ||
    verification?.trainingArtifactEligible !== true ||
    verification?.productionRankingChanged !== false ||
    verification?.contracts?.modelTrainingPerformedByVerifier !== false
  ) {
    throw new Error('Behavioral V7 verification artifact is not release-eligible.');
  }
  if (
    releaseManifest?.operation !==
      'RECOMMENDATION_BEHAVIORAL_V7_RELEASE_MANIFEST' ||
    releaseManifest?.releaseGatePassed !== true ||
    releaseManifest?.structuralAuditPassed !== true ||
    releaseManifest?.rawPropensityContractPassed !== true ||
    releaseManifest?.trainingArtifactEligible !== true ||
    releaseManifest?.productionRankingChanged !== false
  ) {
    throw new Error('Behavioral V7 release manifest is not release-eligible.');
  }

  const [modelArtifactSha256, verificationSha256, releaseManifestSha256] =
    await Promise.all([
      hashFile(modelPath),
      hashFile(verificationPath),
      hashFile(releaseManifestPath),
    ]);
  if (
    releaseManifest.modelArtifactSha256 !== modelArtifactSha256 ||
    verification.source?.modelArtifactSha256 !== modelArtifactSha256
  ) {
    throw new Error('Behavioral V7 model SHA-256 does not match release evidence.');
  }
  if (
    releaseManifest.datasetV7Sha256 !== verification.source?.datasetSha256 ||
    !isSha256(releaseManifest.datasetV7Sha256)
  ) {
    throw new Error('Behavioral V7 Dataset V7 SHA lineage is inconsistent.');
  }
  return {
    modelPath,
    verificationPath,
    releaseManifestPath,
    datasetV7Sha256: releaseManifest.datasetV7Sha256,
    modelArtifactSha256,
    verificationSha256,
    releaseManifestSha256,
  };
}

async function validateInstalledRelease(directory, expectedReleaseId) {
  assertInsideRuntimeRoot(directory);
  const modelPath = join(directory, 'model.json');
  const verificationPath = join(directory, 'verification.json');
  const releaseManifestPath = join(directory, 'release-manifest.json');
  const installManifestPath = join(directory, 'install-manifest.json');
  const [verification, releaseManifest, installManifest] = await Promise.all([
    readJson(verificationPath),
    readJson(releaseManifestPath),
    readJson(installManifestPath),
  ]);
  const [modelSha256, verificationSha256, releaseManifestSha256] =
    await Promise.all([
      hashFile(modelPath),
      hashFile(verificationPath),
      hashFile(releaseManifestPath),
    ]);
  if (
    modelSha256 !== expectedReleaseId ||
    releaseManifest?.modelArtifactSha256 !== expectedReleaseId ||
    verification?.source?.modelArtifactSha256 !== expectedReleaseId ||
    installManifest?.releaseId !== expectedReleaseId ||
    installManifest?.modelArtifactSha256 !== expectedReleaseId ||
    installManifest?.verificationSha256 !== verificationSha256 ||
    installManifest?.releaseManifestSha256 !== releaseManifestSha256 ||
    installManifest?.releaseGatePassed !== true ||
    installManifest?.structuralAuditPassed !== true ||
    installManifest?.rawPropensityContractPassed !== true ||
    installManifest?.productionApiRestarted !== false ||
    installManifest?.productionRankingChanged !== false
  ) {
    throw new Error(`Installed Behavioral V7 release ${expectedReleaseId} is invalid.`);
  }
  if (
    releaseManifest?.releaseGatePassed !== true ||
    releaseManifest?.trainingArtifactEligible !== true ||
    verification?.releaseGatePassed !== true ||
    verification?.trainingArtifactEligible !== true
  ) {
    throw new Error(
      `Installed Behavioral V7 release ${expectedReleaseId} is not release-eligible.`,
    );
  }
  const modelStats = await stat(modelPath);
  if (!modelStats.isFile() || modelStats.size <= 0) {
    throw new Error(`Installed Behavioral V7 release ${expectedReleaseId} has no model.`);
  }
}

async function atomicManagedLink(path, target) {
  assertManagedTarget(target);
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  await rm(temporary, { force: true });
  await symlink(target, temporary);
  await rename(temporary, path);
}

async function readManagedLink(path) {
  try {
    const stats = await lstat(path);
    if (!stats.isSymbolicLink()) {
      throw new Error(`${path} must be a symbolic link.`);
    }
    const target = await readlink(path);
    assertManagedTarget(target);
    return target;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function managedTarget(releaseId) {
  if (!isSha256(releaseId)) {
    throw new Error('Behavioral V7 runtime release ID must be a SHA-256 value.');
  }
  return `releases/${releaseId}`;
}

function releaseIdFromTarget(target) {
  if (!target) return undefined;
  assertManagedTarget(target);
  return target.slice('releases/'.length);
}

function assertManagedTarget(target) {
  if (!/^releases\/[a-f0-9]{64}$/.test(target)) {
    throw new Error(`Unmanaged Behavioral V7 runtime pointer target: ${target}.`);
  }
}

function assertInsideRuntimeRoot(path) {
  const normalized = resolve(path);
  if (!normalized.startsWith(`${runtimeRoot}/`)) {
    throw new Error(`Path escapes Behavioral V7 runtime root: ${normalized}.`);
  }
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
    throw error;
  }
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
