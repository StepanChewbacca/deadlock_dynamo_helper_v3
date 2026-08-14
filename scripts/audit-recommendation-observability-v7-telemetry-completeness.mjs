import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const inputPath = required('BEHAVIORAL_V7_TELEMETRY_PATH');
const outputPath = required('BEHAVIORAL_V7_TELEMETRY_COMPLETENESS_PATH');
const identityPath = process.env.BEHAVIORAL_V7_PLAYER_IDENTITY_PATH?.trim();
const fields = [
  'spendableSouls',
  'shopAvailable',
  'shopType',
  'alive',
  'occupiedSlots',
  'flexSlotsUnlocked',
  'lastPurchaseGameTimeS',
  'lastInventoryMutationGameTimeS',
  'rulesetId',
  'itemAvailabilityVersion',
  'position',
];

let eventCount = 0;
let invalidEventCount = 0;
const telemetryEventIds = new Set();
const sourceEventIds = new Set();
let sourceEventIdentityCount = 0;
const playerKeys = new Set();
const matchIds = new Set();
const sourceCounts = new Map();
const fieldCounts = new Map(fields.map((field) => [field, 0]));

const input = createInterface({
  input: createReadStream(inputPath, { encoding: 'utf8' }),
  crlfDelay: Infinity,
});
for await (const line of input) {
  if (!line.trim()) continue;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    invalidEventCount += 1;
    continue;
  }
  if (
    event?.schemaVersion !== 1 ||
    event?.telemetryVersion !== 'RECOMMENDATION_OBSERVABILITY_V7_TELEMETRY_1' ||
    event?.eventType !== 'PREDECISION_OBSERVABILITY' ||
    !String(event?.matchId ?? '').trim() ||
    !String(event?.steamId ?? '').trim() ||
    !Number.isFinite(Number(event?.gameTimeS))
  ) {
    invalidEventCount += 1;
    continue;
  }

  eventCount += 1;
  telemetryEventIds.add(
    String(
      event.eventId ??
        `${event.matchId}:${event.steamId}:${event.gameTimeS}:${eventCount}`,
    ),
  );
  const sourceEventId = String(event.sourceEventId ?? '').trim();
  if (sourceEventId) {
    sourceEventIdentityCount += 1;
    sourceEventIds.add(sourceEventId);
  }
  matchIds.add(String(event.matchId));
  playerKeys.add(`${event.matchId}:${event.steamId}`);
  const source = String(event.source ?? 'UNKNOWN');
  sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  for (const field of fields) {
    if (event[field] !== undefined && event[field] !== null) {
      fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
    }
  }
}

const identityAudit = await auditIdentity(identityPath);
const fieldCompleteness = Object.fromEntries(
  fields.map((field) => {
    const observedCount = fieldCounts.get(field) ?? 0;
    return [
      field,
      {
        observedCount,
        eventCoverage: ratio(observedCount, eventCount),
      },
    ];
  }),
);
const report = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_OBSERVABILITY_V7_TELEMETRY_COMPLETENESS_AUDIT',
  executorVersion:
    'DIRECT_PLAYER_CONTROLLER_TELEMETRY_COMPLETENESS_3_PERSISTED_IDENTITY',
  generatedAt: new Date().toISOString(),
  trainingPerformed: false,
  valueTrainingPerformed: false,
  futureTestEvaluated: false,
  tuningUsed: false,
  contracts: {
    identityJoinContract: 'MATCH_ID_PLUS_STEAM_ACCOUNT_ID_U32_DIRECT',
    datasetIdentityContract:
      'MATCH_PLAYERS_ID_TO_ACCOUNT_ID_DIRECT_PERSISTED_SIDECAR',
    acceptedSourceEntity: 'player_controller',
    netWorthMayRepresentWallet: false,
    observedActionMayCreateObservability: false,
    historicalIdentityInferencePerformed: false,
    heroIdentityInferencePerformed: false,
    teamIdentityInferencePerformed: false,
    playerPawnIdentityInferencePerformed: false,
    steamIdConversionPerformedByThisAudit: false,
    backfillRequiredForExistingDatasetV6Players: true,
  },
  source: {
    telemetryPath: inputPath,
    eventCount,
    uniqueTelemetryEventCount: telemetryEventIds.size,
    duplicateTelemetryEventCount: Math.max(0, eventCount - telemetryEventIds.size),
    sourceEventIdentityCount,
    uniqueSourceEventCount: sourceEventIds.size,
    duplicateSourceEventCount: Math.max(
      0,
      sourceEventIdentityCount - sourceEventIds.size,
    ),
    invalidEventCount,
    matchCount: matchIds.size,
    playerKeyCount: playerKeys.size,
    sourceCounts: Object.fromEntries(
      [...sourceCounts.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
  },
  identity: identityAudit,
  fieldCompleteness,
  summary: {
    directTelemetryObserved: eventCount > 0,
    spendableCurrencyObserved: (fieldCounts.get('spendableSouls') ?? 0) > 0,
    shopOpportunityObserved:
      (fieldCounts.get('shopAvailable') ?? 0) > 0 ||
      (fieldCounts.get('shopType') ?? 0) > 0,
    inventoryLegalityObserved:
      (fieldCounts.get('occupiedSlots') ?? 0) > 0 ||
      (fieldCounts.get('flexSlotsUnlocked') ?? 0) > 0,
    rulesetObserved:
      (fieldCounts.get('rulesetId') ?? 0) > 0 ||
      (fieldCounts.get('itemAvailabilityVersion') ?? 0) > 0,
    positionObserved: (fieldCounts.get('position') ?? 0) > 0,
    sourceEventIdentityObserved: sourceEventIdentityCount > 0,
    sourceEventDuplicatesObserved:
      sourceEventIdentityCount - sourceEventIds.size > 0,
    directDatasetIdentityBridgeObserved: identityAudit.validRowCount > 0,
    historicalDatasetIdentityBridgeAvailable: identityAudit.validRowCount > 0,
    readyForDirectSteamIdJoin: eventCount > 0 && playerKeys.size > 0,
    readyForDirectDatasetTelemetryJoin:
      eventCount > 0 && identityAudit.validRowCount > 0,
    nextStep: nextStep(eventCount, identityAudit.validRowCount),
  },
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report.summary, null, 2));

async function auditIdentity(path) {
  if (!path) {
    return {
      path: undefined,
      rowCount: 0,
      validRowCount: 0,
      invalidRowCount: 0,
      duplicateDatasetPlayerKeyCount: 0,
      conflictingDatasetPlayerKeyCount: 0,
      directPersistedIdentityObserved: false,
    };
  }

  let rowCount = 0;
  let validRowCount = 0;
  let invalidRowCount = 0;
  let duplicateDatasetPlayerKeyCount = 0;
  let conflictingDatasetPlayerKeyCount = 0;
  const mapping = new Map();
  const input = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of input) {
    if (!line.trim()) continue;
    rowCount += 1;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      invalidRowCount += 1;
      continue;
    }
    const matchId = String(row?.matchId ?? '').trim();
    const datasetPlayerId = String(row?.datasetPlayerId ?? '').trim();
    const accountId = String(row?.accountId ?? '').trim();
    const steamId = String(row?.steamId ?? '').trim();
    if (
      row?.schemaVersion !== 1 ||
      row?.identityVersion !==
        'RECOMMENDATION_OBSERVABILITY_V7_DATASET_PLAYER_IDENTITY_1' ||
      row?.source !== 'DIRECT_PERSISTED_IDENTITY' ||
      row?.sourceField !== 'match_players.accountId' ||
      row?.identityDomain !== 'STEAM_ACCOUNT_ID_U32' ||
      !matchId ||
      !datasetPlayerId ||
      !isU32AccountId(accountId) ||
      accountId !== steamId
    ) {
      invalidRowCount += 1;
      continue;
    }
    const key = `${matchId}:${datasetPlayerId}`;
    const previous = mapping.get(key);
    if (previous !== undefined) {
      duplicateDatasetPlayerKeyCount += 1;
      if (previous !== accountId) conflictingDatasetPlayerKeyCount += 1;
      continue;
    }
    mapping.set(key, accountId);
    validRowCount += 1;
  }
  return {
    path,
    rowCount,
    validRowCount,
    invalidRowCount,
    duplicateDatasetPlayerKeyCount,
    conflictingDatasetPlayerKeyCount,
    directPersistedIdentityObserved: validRowCount > 0,
  };
}

function isU32AccountId(value) {
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 0xffffffff;
}

function nextStep(eventCount, identityRowCount) {
  if (identityRowCount === 0) {
    return 'DEPLOY_MIGRATION_AND_BACKFILL_DIRECT_MATCH_PLAYER_ACCOUNT_IDENTITY';
  }
  if (eventCount === 0) {
    return 'DEPLOY_AND_COLLECT_NEW_DIRECT_PLAYER_CONTROLLER_TELEMETRY';
  }
  return 'REEXPORT_DATASET_V7_WITH_DIRECT_IDENTITY_AND_TELEMETRY';
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
