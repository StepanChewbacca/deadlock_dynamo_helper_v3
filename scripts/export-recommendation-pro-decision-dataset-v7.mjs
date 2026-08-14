import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const sourcePath = required('BEHAVIORAL_V7_SOURCE_DATASET_V6_PATH');
const temporalAuditPath = required('BEHAVIORAL_V7_TEMPORAL_AUDIT_PATH');
const historicalLedgerPath = required('BEHAVIORAL_V7_HISTORICAL_LEDGER_PATH');
const outputPath = required('BEHAVIORAL_V7_OUTPUT_DATASET_PATH');
const auditPath = required('BEHAVIORAL_V7_OUTPUT_AUDIT_PATH');
const telemetryPath = process.env.BEHAVIORAL_V7_TELEMETRY_PATH?.trim();
const playerIdentityPath = process.env.BEHAVIORAL_V7_PLAYER_IDENTITY_PATH?.trim();

const temporalAudit = JSON.parse(await readFile(temporalAuditPath, 'utf8'));
if (
  temporalAudit?.schemaVersion !== 2 ||
  temporalAudit?.summary?.stageBGatePassed !== true ||
  temporalAudit?.contracts?.netWorthMayRepresentWallet !== false
) {
  throw new Error('Stage B V2 does not authorize Dataset V7 export.');
}
const historicalLedger = await loadHistoricalLedger(historicalLedgerPath);
const telemetry = telemetryPath ? await loadTelemetry(telemetryPath) : new Map();
const playerIdentity = playerIdentityPath
  ? await loadPlayerIdentity(playerIdentityPath)
  : new Map();
const previousDecisionTimeByPlayer = new Map();
const output = createWriteStream(outputPath, { encoding: 'utf8' });
const counters = {
  decisionCount: 0,
  futureTestDecisionCount: 0,
  identityMappedDecisionCount: 0,
  historicalLedgerJoinedDecisionCount: 0,
  telemetryJoinedDecisionCount: 0,
  previousDecisionTimingCount: 0,
  newObservedDecisionCount: 0,
  candidateCount: 0,
  availabilityEvaluatedCandidateCount: 0,
  behavioralObservedCoveredCount: 0,
  outOfOrderDecisionCount: 0,
};

const input = createInterface({ input: openDataset(sourcePath), crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  const base = JSON.parse(line);
  assertV6Row(base);
  counters.decisionCount += 1;
  counters.futureTestDecisionCount += base.split === 'FUTURE_TEST' ? 1 : 0;
  const datasetPlayerKey = `${base.matchId}:${base.playerId}`;
  const steamId = playerIdentity.get(datasetPlayerKey);
  const directPlayerKey = steamId === undefined
    ? undefined
    : `${base.matchId}:${steamId}`;
  if (directPlayerKey !== undefined) counters.identityMappedDecisionCount += 1;
  const decisionGameTimeS = Number(base.state.gameTimeS);
  const historicalEvent = directPlayerKey === undefined
    ? undefined
    : latestAtOrBefore(
        historicalLedger.get(directPlayerKey) ?? [],
        decisionGameTimeS,
      );
  const telemetryEvent = directPlayerKey === undefined
    ? undefined
    : latestAtOrBefore(
        telemetry.get(directPlayerKey) ?? [],
        decisionGameTimeS,
      );
  if (historicalEvent) counters.historicalLedgerJoinedDecisionCount += 1;
  if (telemetryEvent) counters.telemetryJoinedDecisionCount += 1;

  const previousDecisionTime = previousDecisionTimeByPlayer.get(datasetPlayerKey);
  let timeSincePreviousObservedPurchaseDecisionS;
  if (previousDecisionTime !== undefined) {
    if (decisionGameTimeS >= previousDecisionTime) {
      timeSincePreviousObservedPurchaseDecisionS =
        decisionGameTimeS - previousDecisionTime;
      counters.previousDecisionTimingCount += 1;
    } else {
      counters.outOfOrderDecisionCount += 1;
    }
  }
  if (previousDecisionTime === undefined || decisionGameTimeS >= previousDecisionTime) {
    previousDecisionTimeByPlayer.set(datasetPlayerKey, decisionGameTimeS);
  }

  const observability = [
    ...historicalObservations(
      base,
      historicalEvent,
      timeSincePreviousObservedPurchaseDecisionS,
      directPlayerKey !== undefined,
    ),
    ...telemetryObservations(base, telemetryEvent, directPlayerKey !== undefined),
  ];
  if (observability.some((observation) => !observation.missing)) {
    counters.newObservedDecisionCount += 1;
  }
  const candidates = base.candidates.map((candidate) => ({
    ...candidate,
    feasibility: candidateAvailability(candidate, telemetryEvent),
  }));
  counters.candidateCount += candidates.length;
  counters.availabilityEvaluatedCandidateCount += candidates.filter(
    (candidate) => candidate.feasibility.evaluated,
  ).length;
  const behavioralChoiceSetActionKeys = candidates
    .slice()
    .sort(
      (left, right) =>
        Number(left.rank) - Number(right.rank) ||
        Number(right.generatorScore) - Number(left.generatorScore) ||
        String(left.actionKey).localeCompare(String(right.actionKey)),
    )
    .filter(
      (candidate) =>
        !candidate.feasibility.evaluated ||
        candidate.feasibility.feasible === true,
    )
    .slice(0, 96)
    .map((candidate) => candidate.actionKey);
  counters.behavioralObservedCoveredCount += behavioralChoiceSetActionKeys.includes(
    base.observedActionKey,
  )
    ? 1
    : 0;
  const row = {
    ...base,
    schemaVersion: 1,
    datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V7_OBSERVABILITY_1',
    observabilityVersion: 'RECOMMENDATION_OBSERVABILITY_V7_STRICT_PREDECISION_1',
    sourceDatasetVersion: base.datasetVersion,
    sourceDecisionId: base.decisionId,
    observability,
    candidates,
    choiceSet: {
      coverageUniverseActionKeys: base.candidates.map(
        (candidate) => candidate.actionKey,
      ),
      behavioralChoiceSetActionKeys,
      behavioralChoiceSetDefinition: 'V7_OBSERVED_AVAILABILITY_TOP96_1',
      observedActionInjected: false,
      selectedAfterObservedAction: false,
      feasibilityAware: candidates.some(
        (candidate) => candidate.feasibility.evaluated,
      ),
    },
  };
  output.write(`${JSON.stringify(row)}\n`);
}
await new Promise((resolve, reject) => {
  output.on('error', reject);
  output.end(resolve);
});

const audit = {
  schemaVersion: 2,
  operation: 'RECOMMENDATION_PRO_DECISION_DATASET_V7_EXPORT',
  executorVersion: 'HISTORICAL_PREFIX_OBSERVABILITY_BACKFILL_3_EXPLICIT_IDENTITY',
  datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V7_OBSERVABILITY_1',
  observabilityVersion: 'RECOMMENDATION_OBSERVABILITY_V7_STRICT_PREDECISION_1',
  generatedAt: new Date().toISOString(),
  trainingPerformed: false,
  valueTrainingPerformed: false,
  futureTestEvaluated: false,
  sourceDatasetPath: sourcePath,
  temporalAuditPath,
  historicalLedgerPath,
  telemetryPath,
  playerIdentityPath,
  identityContracts: {
    datasetPlayerId: 'DATABASE_SURROGATE_NOT_STEAM_ID',
    historicalLedgerIdentity: 'MATCH_ID_PLUS_STEAM_ID',
    telemetryIdentity: 'MATCH_ID_PLUS_STEAM_ID',
    directJoinIdentity:
      'EXPLICIT_DATASET_PLAYER_TO_STEAM_ID_SIDECAR_ONLY',
    historicalIdentityInferencePerformed: false,
    heroIdentityInferencePerformed: false,
    teamIdentityInferencePerformed: false,
    playerPawnIdentityInferencePerformed: false,
  },
  ...counters,
  identityMappingCoverage: ratio(
    counters.identityMappedDecisionCount,
    counters.decisionCount,
  ),
  historicalLedgerJoinCoverage: ratio(
    counters.historicalLedgerJoinedDecisionCount,
    counters.decisionCount,
  ),
  telemetryJoinCoverage: ratio(
    counters.telemetryJoinedDecisionCount,
    counters.decisionCount,
  ),
  previousDecisionTimingCoverage: ratio(
    counters.previousDecisionTimingCount,
    counters.decisionCount,
  ),
  newObservedDecisionCoverage: ratio(
    counters.newObservedDecisionCount,
    counters.decisionCount,
  ),
  availabilityEvaluationCoverage: ratio(
    counters.availabilityEvaluatedCandidateCount,
    counters.candidateCount,
  ),
  behavioralObservedActionCoverage: ratio(
    counters.behavioralObservedCoveredCount,
    counters.decisionCount,
  ),
  observedActionInjectedCount: 0,
  stageCExportPassed:
    counters.decisionCount > 0 &&
    counters.newObservedDecisionCount > 0 &&
    counters.outOfOrderDecisionCount === 0,
};
await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(audit, null, 2));

async function loadHistoricalLedger(path) {
  const byPlayer = new Map();
  const input = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (
      event?.schemaVersion !== 1 ||
      event?.ledgerVersion !==
        'RECOMMENDATION_BEHAVIORAL_V7_HISTORICAL_LEDGER_1'
    ) {
      continue;
    }
    const key = `${event.matchId}:${event.steamId}`;
    const values = byPlayer.get(key) ?? [];
    values.push(event);
    byPlayer.set(key, values);
  }
  for (const values of byPlayer.values()) {
    values.sort(
      (left, right) => Number(left.gameTimeS) - Number(right.gameTimeS),
    );
  }
  return byPlayer;
}

async function loadTelemetry(path) {
  const byPlayer = new Map();
  const input = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (
      event?.schemaVersion !== 1 ||
      event?.telemetryVersion !==
        'RECOMMENDATION_OBSERVABILITY_V7_TELEMETRY_1' ||
      event?.eventType !== 'PREDECISION_OBSERVABILITY'
    ) {
      continue;
    }
    const key = `${event.matchId}:${event.steamId}`;
    const values = byPlayer.get(key) ?? [];
    values.push(event);
    byPlayer.set(key, values);
  }
  for (const values of byPlayer.values()) {
    values.sort(
      (left, right) => Number(left.gameTimeS) - Number(right.gameTimeS),
    );
  }
  return byPlayer;
}

async function loadPlayerIdentity(path) {
  const byDatasetPlayer = new Map();
  const input = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of input) {
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
    const matchId = String(row.matchId ?? '').trim();
    const datasetPlayerId = String(row.datasetPlayerId ?? '').trim();
    const steamId = String(row.steamId ?? '').trim();
    if (!matchId || !datasetPlayerId || !steamId) continue;
    const key = `${matchId}:${datasetPlayerId}`;
    const existing = byDatasetPlayer.get(key);
    if (existing !== undefined && existing !== steamId) {
      throw new Error(`Conflicting direct V7 player identity for ${key}.`);
    }
    byDatasetPlayer.set(key, steamId);
  }
  return byDatasetPlayer;
}

function latestAtOrBefore(events, decisionGameTimeS) {
  let selected;
  for (const event of events) {
    if (Number(event.gameTimeS) > decisionGameTimeS) break;
    selected = event;
  }
  return selected;
}

function historicalObservations(
  base,
  event,
  timeSincePreviousObservedPurchaseDecisionS,
  directIdentityAvailable,
) {
  const missingReason = directIdentityAvailable
    ? 'NO_HISTORICAL_EVENT_AT_OR_BEFORE_DECISION'
    : 'HISTORICAL_IDENTITY_UNAVAILABLE';
  return [
    observation({
      fieldName: 'originalAssignedLane',
      family: 'POSITION_OPPORTUNITY',
      value: event?.originalAssignedLane,
      sourceSystem: 'SELF_HOSTED_DEADLOCK_LIVE_EVENTS_SSE',
      sourceEntity: 'player_controller',
      sourceField: 'original_assigned_lane',
      sourceGameTimeS: event?.gameTimeS,
      directlyObserved: event !== undefined,
      reconstructed: false,
      missingReason,
      provenanceVersion:
        'RECOMMENDATION_BEHAVIORAL_V7_HISTORICAL_LEDGER_1',
      decisionGameTimeS: Number(base.state.gameTimeS),
    }),
    observation({
      fieldName: 'playerControllerUpgrades',
      family: 'INVENTORY_LEGALITY',
      value:
        event?.upgrades === undefined
          ? undefined
          : JSON.stringify(event.upgrades),
      sourceSystem: 'SELF_HOSTED_DEADLOCK_LIVE_EVENTS_SSE',
      sourceEntity: 'player_controller',
      sourceField: 'upgrades',
      sourceGameTimeS: event?.gameTimeS,
      directlyObserved: event !== undefined,
      reconstructed: false,
      missingReason,
      provenanceVersion:
        'RECOMMENDATION_BEHAVIORAL_V7_HISTORICAL_LEDGER_1',
      decisionGameTimeS: Number(base.state.gameTimeS),
    }),
    observation({
      fieldName: 'timeSincePreviousObservedPurchaseDecisionS',
      family: 'PURCHASE_TIMING_CONTEXT',
      value: timeSincePreviousObservedPurchaseDecisionS,
      sourceSystem: 'DATASET_V6_DECISION_PREFIX',
      sourceEntity: 'recommendation_pro_decision_dataset_v6',
      sourceField: 'state.gameTimeS',
      sourceGameTimeS:
        timeSincePreviousObservedPurchaseDecisionS === undefined
          ? undefined
          : Number(base.state.gameTimeS) -
            timeSincePreviousObservedPurchaseDecisionS,
      directlyObserved: false,
      reconstructed: true,
      reconstructionContract: 'MATCH_PLAYER_DECISION_PREFIX_ONLY',
      missingReason: 'NO_PREVIOUS_DATASET_PLAYER_DECISION',
      provenanceVersion: 'V7_DECISION_PREFIX_1',
      decisionGameTimeS: Number(base.state.gameTimeS),
    }),
  ];
}

function telemetryObservations(base, event, directIdentityAvailable) {
  const specs = [
    ['spendableSouls', 'SPENDABLE_CURRENCY'],
    ['shopAvailable', 'SHOP_OPPORTUNITY'],
    ['shopType', 'SHOP_OPPORTUNITY'],
    ['alive', 'ALIVE_COMBAT_CONTEXT'],
    ['flexSlotsUnlocked', 'INVENTORY_LEGALITY'],
    ['lastPurchaseGameTimeS', 'PURCHASE_TIMING_CONTEXT'],
    ['lastInventoryMutationGameTimeS', 'PURCHASE_TIMING_CONTEXT'],
    ['rulesetId', 'RULESET_AVAILABILITY'],
    ['itemAvailabilityVersion', 'RULESET_AVAILABILITY'],
  ];
  const missingReason = directIdentityAvailable
    ? 'NO_DIRECT_TELEMETRY_AT_OR_BEFORE_DECISION'
    : 'DIRECT_DATASET_PLAYER_TO_STEAM_ID_IDENTITY_UNAVAILABLE';
  return specs.map(([fieldName, family]) =>
    observation({
      fieldName,
      family,
      value: event?.[fieldName],
      sourceSystem: event?.source ?? 'NO_TELEMETRY_SOURCE',
      sourceEntity: 'recommendation_observability_v7',
      sourceField: fieldName,
      sourceGameTimeS: event?.gameTimeS,
      directlyObserved: event !== undefined,
      reconstructed: false,
      missingReason,
      provenanceVersion: 'RECOMMENDATION_OBSERVABILITY_V7_TELEMETRY_1',
      decisionGameTimeS: Number(base.state.gameTimeS),
    }),
  );
}

function observation({
  fieldName,
  family,
  value,
  sourceSystem,
  sourceEntity,
  sourceField,
  sourceGameTimeS,
  directlyObserved,
  reconstructed,
  reconstructionContract,
  missingReason,
  provenanceVersion,
  decisionGameTimeS,
}) {
  if (
    sourceGameTimeS !== undefined &&
    Number(sourceGameTimeS) > decisionGameTimeS
  ) {
    throw new Error(`Future V7 observation ${fieldName}.`);
  }
  const missing = value === undefined || value === null;
  return {
    fieldName,
    family,
    ...(missing ? {} : { value }),
    missing,
    ...(missing && missingReason ? { missingReason } : {}),
    sourceSystem,
    sourceEntity,
    sourceField,
    ...(sourceGameTimeS === undefined
      ? {}
      : {
          sourceGameTimeS: Number(sourceGameTimeS),
          alignmentAgeS: Math.max(
            0,
            decisionGameTimeS - Number(sourceGameTimeS),
          ),
        }),
    directlyObserved,
    reconstructed,
    ...(reconstructionContract ? { reconstructionContract } : {}),
    provenanceVersion,
  };
}

function candidateAvailability(candidate, event) {
  const reasons = [];
  const sources = [];
  let evaluated = false;
  let feasible = true;
  if (event?.spendableSouls !== undefined && candidate.cost !== undefined) {
    evaluated = true;
    sources.push('spendableSouls');
    if (Number(candidate.cost) <= Number(event.spendableSouls)) {
      reasons.push('AFFORDABLE');
    } else {
      feasible = false;
      reasons.push('INSUFFICIENT_CURRENCY');
    }
  }
  if (
    event?.shopAvailable !== undefined &&
    ['BUY', 'REBUY', 'UPGRADE'].includes(candidate.actionType)
  ) {
    evaluated = true;
    sources.push('shopAvailable');
    if (event.shopAvailable) reasons.push('SHOP_AVAILABLE');
    else {
      feasible = false;
      reasons.push('SHOP_UNAVAILABLE');
    }
  }
  return {
    evaluated,
    ...(evaluated ? { feasible } : {}),
    reasonCodes: reasons.length > 0 ? reasons : ['UNKNOWN'],
    sourceFields: sources,
    observedOnly: true,
  };
}

function openDataset(path) {
  const stream = createReadStream(path);
  return path.endsWith('.gz') ? stream.pipe(createGunzip()) : stream;
}

function assertV6Row(row) {
  if (row?.datasetVersion !== 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2') {
    throw new Error('Unsupported Dataset V6 source row.');
  }
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
