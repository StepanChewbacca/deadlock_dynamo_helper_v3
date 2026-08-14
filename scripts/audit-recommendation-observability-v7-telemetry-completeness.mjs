import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const inputPath = required('BEHAVIORAL_V7_TELEMETRY_PATH');
const outputPath = required('BEHAVIORAL_V7_TELEMETRY_COMPLETENESS_PATH');
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
  executorVersion: 'DIRECT_PLAYER_CONTROLLER_TELEMETRY_COMPLETENESS_2_SOURCE_EVENT_ID',
  generatedAt: new Date().toISOString(),
  trainingPerformed: false,
  valueTrainingPerformed: false,
  futureTestEvaluated: false,
  tuningUsed: false,
  contracts: {
    identityJoinContract: 'MATCH_ID_PLUS_STEAM_ID_DIRECT',
    acceptedSourceEntity: 'player_controller',
    netWorthMayRepresentWallet: false,
    observedActionMayCreateObservability: false,
    historicalIdentityInferencePerformed: false,
    heroIdentityInferencePerformed: false,
    playerPawnIdentityInferencePerformed: false,
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
    readyForDirectSteamIdJoin: eventCount > 0 && playerKeys.size > 0,
    historicalDatasetIdentityBridgeAvailable: false,
    nextStep:
      eventCount > 0
        ? 'COLLECT_DIRECT_DATASET_PLAYER_IDENTITY_BRIDGE_BEFORE_DATASET_V7_REEXPORT'
        : 'DEPLOY_AND_COLLECT_NEW_DIRECT_PLAYER_CONTROLLER_TELEMETRY',
  },
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report.summary, null, 2));

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
