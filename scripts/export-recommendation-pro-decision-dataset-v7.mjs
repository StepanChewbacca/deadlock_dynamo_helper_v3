import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const sourcePath = required('BEHAVIORAL_V7_SOURCE_DATASET_V6_PATH');
const temporalAuditPath = required('BEHAVIORAL_V7_TEMPORAL_AUDIT_PATH');
const outputPath = required('BEHAVIORAL_V7_OUTPUT_DATASET_PATH');
const auditPath = required('BEHAVIORAL_V7_OUTPUT_AUDIT_PATH');
const telemetryPath = process.env.BEHAVIORAL_V7_TELEMETRY_PATH?.trim();

const temporalAudit = JSON.parse(await readFile(temporalAuditPath, 'utf8'));
if (temporalAudit?.summary?.stageBGatePassed !== true) {
  throw new Error('Stage B temporal audit does not authorize Dataset V7 export.');
}
const telemetry = telemetryPath ? await loadTelemetry(telemetryPath) : new Map();
const output = createWriteStream(outputPath, { encoding: 'utf8' });
const counters = {
  decisionCount: 0,
  futureTestDecisionCount: 0,
  telemetryJoinedDecisionCount: 0,
  candidateCount: 0,
  availabilityEvaluatedCandidateCount: 0,
  behavioralObservedCoveredCount: 0,
};

const input = createInterface({ input: openDataset(sourcePath), crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  const base = JSON.parse(line);
  assertV6Row(base);
  counters.decisionCount += 1;
  counters.futureTestDecisionCount += base.split === 'FUTURE_TEST' ? 1 : 0;
  const event = latestTelemetryAtOrBefore(
    telemetry.get(`${base.matchId}:${base.playerId}`) ?? [],
    Number(base.state.gameTimeS),
  );
  if (event) counters.telemetryJoinedDecisionCount += 1;
  const observability = observationsFromEvent(base, event);
  const candidates = base.candidates.map((candidate) => ({
    ...candidate,
    feasibility: candidateAvailability(candidate, event),
  }));
  counters.candidateCount += candidates.length;
  counters.availabilityEvaluatedCandidateCount += candidates.filter(
    (candidate) => candidate.feasibility.evaluated,
  ).length;
  const behavioralChoiceSetActionKeys = candidates
    .slice()
    .sort((a, b) => Number(a.rank) - Number(b.rank) || Number(b.generatorScore) - Number(a.generatorScore))
    .filter((candidate) => !candidate.feasibility.evaluated || candidate.feasibility.feasible === true)
    .slice(0, 96)
    .map((candidate) => candidate.actionKey);
  counters.behavioralObservedCoveredCount += behavioralChoiceSetActionKeys.includes(base.observedActionKey) ? 1 : 0;
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
      coverageUniverseActionKeys: base.candidates.map((candidate) => candidate.actionKey),
      behavioralChoiceSetActionKeys,
      behavioralChoiceSetDefinition: 'V7_OBSERVED_AVAILABILITY_TOP96_1',
      observedActionInjected: false,
      selectedAfterObservedAction: false,
      feasibilityAware: candidates.some((candidate) => candidate.feasibility.evaluated),
    },
  };
  output.write(`${JSON.stringify(row)}\n`);
}
await new Promise((resolve, reject) => {
  output.end(resolve);
  output.on('error', reject);
});

const audit = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_PRO_DECISION_DATASET_V7_EXPORT',
  datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V7_OBSERVABILITY_1',
  observabilityVersion: 'RECOMMENDATION_OBSERVABILITY_V7_STRICT_PREDECISION_1',
  generatedAt: new Date().toISOString(),
  trainingPerformed: false,
  valueTrainingPerformed: false,
  futureTestEvaluated: false,
  sourceDatasetPath: sourcePath,
  temporalAuditPath,
  telemetryPath,
  ...counters,
  telemetryJoinCoverage: ratio(counters.telemetryJoinedDecisionCount, counters.decisionCount),
  availabilityEvaluationCoverage: ratio(counters.availabilityEvaluatedCandidateCount, counters.candidateCount),
  behavioralObservedActionCoverage: ratio(counters.behavioralObservedCoveredCount, counters.decisionCount),
  observedActionInjectedCount: 0,
  stageCExportPassed: counters.decisionCount > 0,
};
await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(audit, null, 2));

async function loadTelemetry(path) {
  const byPlayer = new Map();
  const input = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (
      event?.schemaVersion !== 1 ||
      event?.telemetryVersion !== 'RECOMMENDATION_OBSERVABILITY_V7_TELEMETRY_1' ||
      event?.eventType !== 'PREDECISION_OBSERVABILITY'
    ) continue;
    const key = `${event.matchId}:${event.steamId}`;
    const values = byPlayer.get(key) ?? [];
    values.push(event);
    byPlayer.set(key, values);
  }
  for (const values of byPlayer.values()) values.sort((a, b) => Number(a.gameTimeS) - Number(b.gameTimeS));
  return byPlayer;
}
function latestTelemetryAtOrBefore(events, decisionGameTimeS) {
  let selected;
  for (const event of events) {
    if (Number(event.gameTimeS) > decisionGameTimeS) break;
    selected = event;
  }
  return selected;
}
function observationsFromEvent(base, event) {
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
  return specs.map(([fieldName, family]) => {
    const value = event?.[fieldName];
    return {
      fieldName,
      family,
      ...(value === undefined ? {} : { value }),
      missing: value === undefined,
      sourceSystem: event?.source ?? 'NO_SOURCE',
      sourceEntity: 'recommendation_observability_v7',
      sourceField: fieldName,
      ...(event ? { sourceGameTimeS: Number(event.gameTimeS), alignmentAgeS: Number(base.state.gameTimeS) - Number(event.gameTimeS) } : {}),
      directlyObserved: event !== undefined,
      reconstructed: false,
      provenanceVersion: 'RECOMMENDATION_OBSERVABILITY_V7_TELEMETRY_1',
    };
  });
}
function candidateAvailability(candidate, event) {
  const reasons = [];
  const sources = [];
  let evaluated = false;
  let feasible = true;
  if (event?.spendableSouls !== undefined && candidate.cost !== undefined) {
    evaluated = true;
    sources.push('spendableSouls');
    if (Number(candidate.cost) <= Number(event.spendableSouls)) reasons.push('AFFORDABLE');
    else {
      feasible = false;
      reasons.push('INSUFFICIENT_CURRENCY');
    }
  }
  if (event?.shopAvailable !== undefined && ['BUY', 'REBUY', 'UPGRADE'].includes(candidate.actionType)) {
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
