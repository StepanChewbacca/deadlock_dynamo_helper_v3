import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const sourcePath = required('BEHAVIORAL_V7_SOURCE_DATASET_V6_PATH');
const outputPath = required('BEHAVIORAL_V7_RESOLVED_PLAYER_IDENTITY_PATH');
const auditPath = required('BEHAVIORAL_V7_RESOLVED_PLAYER_IDENTITY_AUDIT_PATH');
const externalIdentityPath =
  process.env.BEHAVIORAL_V7_EXTERNAL_PLAYER_IDENTITY_PATH?.trim();
const DIRECT_SOURCE = 'MATCH_PLAYER_ACCOUNT_ID_DIRECT';
const MAX_ACCOUNT_ID = 0xffffffff;

const embeddedByKey = new Map();
let decisionCount = 0;
let embeddedIdentityDecisionCount = 0;
const input = createInterface({ input: openDataset(sourcePath), crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  if (row?.datasetVersion !== 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2') {
    throw new Error('Unsupported Dataset V6 source row for identity resolution.');
  }
  decisionCount += 1;
  const matchId = requiredText(row.matchId, 'Dataset V6 matchId');
  const playerId = requiredText(row.playerId, 'Dataset V6 playerId');
  const accountId = embeddedAccountId(row);
  if (accountId === undefined) continue;
  embeddedIdentityDecisionCount += 1;
  mergeIdentity(embeddedByKey, `${matchId}:${playerId}`, accountId, 'embedded Dataset V6');
}

const externalByKey = externalIdentityPath
  ? await loadExternalIdentity(externalIdentityPath)
  : new Map();
const resolvedByKey = new Map(externalByKey);
let matchingEmbeddedExternalKeyCount = 0;
for (const [key, accountId] of embeddedByKey) {
  const external = externalByKey.get(key);
  if (external !== undefined && external !== accountId) {
    throw new Error(
      `Conflicting direct player identity for ${key}: embedded=${accountId}, external=${external}.`,
    );
  }
  if (external === accountId) matchingEmbeddedExternalKeyCount += 1;
  resolvedByKey.set(key, accountId);
}

const outputRows = [...resolvedByKey.entries()]
  .map(([key, accountId]) => {
    const separator = key.indexOf(':');
    const matchId = key.slice(0, separator);
    const datasetPlayerId = key.slice(separator + 1);
    return {
      schemaVersion: 1,
      identityVersion: 'RECOMMENDATION_OBSERVABILITY_V7_DATASET_PLAYER_IDENTITY_1',
      matchId,
      datasetPlayerId,
      accountId,
      steamId: accountId,
      source: 'DIRECT_PERSISTED_IDENTITY',
      sourceField: embeddedByKey.has(key)
        ? 'recommendation_pro_decision_dataset_v6.accountId'
        : 'match_players.accountId',
      identityDomain: 'STEAM_ACCOUNT_ID_U32',
    };
  })
  .sort(
    (left, right) =>
      compareNumericText(left.matchId, right.matchId) ||
      compareNumericText(left.datasetPlayerId, right.datasetPlayerId),
  );
await writeFile(
  outputPath,
  outputRows.length > 0
    ? `${outputRows.map((row) => JSON.stringify(row)).join('\n')}\n`
    : '',
  'utf8',
);

const audit = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_PLAYER_IDENTITY_RESOLUTION',
  executorVersion: 'DATASET_V6_EMBEDDED_IDENTITY_PRIMARY_1',
  generatedAt: new Date().toISOString(),
  trainingPerformed: false,
  valueTrainingPerformed: false,
  futureTestEvaluated: false,
  sourceDatasetPath: sourcePath,
  externalIdentityPath,
  outputPath,
  contracts: {
    embeddedIdentitySource: 'MATCH_PLAYER_ACCOUNT_ID_DIRECT',
    embeddedIdentityField: 'recommendation_pro_decision_dataset_v6.accountId',
    externalIdentitySource: 'DIRECT_PERSISTED_IDENTITY',
    identityDomain: 'STEAM_ACCOUNT_ID_U32',
    embeddedIdentityPreferred: true,
    externalIdentityFallbackAllowed: true,
    identityConflictAccepted: false,
    databaseSurrogateMayRepresentSteamId: false,
    heroIdentityInferencePerformed: false,
    teamIdentityInferencePerformed: false,
    playerPawnIdentityInferencePerformed: false,
  },
  decisionCount,
  embeddedIdentityDecisionCount,
  embeddedIdentityDecisionCoverage: ratio(
    embeddedIdentityDecisionCount,
    decisionCount,
  ),
  embeddedIdentityKeyCount: embeddedByKey.size,
  externalIdentityKeyCount: externalByKey.size,
  matchingEmbeddedExternalKeyCount,
  resolvedIdentityKeyCount: resolvedByKey.size,
  identityConflictCount: 0,
  passed: true,
};
await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(audit, null, 2));

async function loadExternalIdentity(path) {
  try {
    await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return new Map();
    throw error;
  }
  const byKey = new Map();
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (
      row?.schemaVersion !== 1 ||
      row?.identityVersion !==
        'RECOMMENDATION_OBSERVABILITY_V7_DATASET_PLAYER_IDENTITY_1' ||
      row?.source !== 'DIRECT_PERSISTED_IDENTITY'
    ) {
      continue;
    }
    const matchId = requiredText(row.matchId, 'external matchId');
    const datasetPlayerId = requiredText(
      row.datasetPlayerId,
      'external datasetPlayerId',
    );
    const accountId = normalizeAccountId(row.accountId ?? row.steamId);
    if (accountId === undefined) {
      throw new Error(`Invalid external direct identity for ${matchId}:${datasetPlayerId}.`);
    }
    mergeIdentity(
      byKey,
      `${matchId}:${datasetPlayerId}`,
      accountId,
      'external sidecar',
    );
  }
  return byKey;
}

function embeddedAccountId(row) {
  const accountMissing = row.accountId === undefined || row.accountId === null;
  const sourceMissing =
    row.playerIdentitySource === undefined || row.playerIdentitySource === null;
  if (accountMissing && sourceMissing) return undefined;
  if (row.playerIdentitySource !== DIRECT_SOURCE) {
    throw new Error(
      `Dataset V6 row ${row.decisionId} has unsupported playerIdentitySource.`,
    );
  }
  const accountId = normalizeAccountId(row.accountId);
  if (accountId === undefined) {
    throw new Error(`Dataset V6 row ${row.decisionId} has invalid direct accountId.`);
  }
  return accountId;
}

function normalizeAccountId(value) {
  const text = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(text)) return undefined;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed <= MAX_ACCOUNT_ID
    ? String(parsed)
    : undefined;
}

function mergeIdentity(map, key, value, source) {
  const existing = map.get(key);
  if (existing !== undefined && existing !== value) {
    throw new Error(
      `Conflicting ${source} direct player identity for ${key}: ${existing} vs ${value}.`,
    );
  }
  map.set(key, value);
}

function openDataset(path) {
  const stream = createReadStream(path);
  return path.endsWith('.gz') ? stream.pipe(createGunzip()) : stream;
}

function requiredText(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`Missing ${name}.`);
  return text;
}

function compareNumericText(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isSafeInteger(leftNumber) && Number.isSafeInteger(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
