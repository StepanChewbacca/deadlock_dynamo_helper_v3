import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const timelineRoot = required('BEHAVIORAL_V7_TIMELINE_ROOT');
const postgresColumnsPath = required('BEHAVIORAL_V7_POSTGRES_COLUMNS_PATH');
const outputPath = required('BEHAVIORAL_V7_OBSERVABILITY_REPORT_PATH');
const maxRows = Number(process.env.BEHAVIORAL_V7_MAX_EVENT_ROWS ?? 250000);

const existingV6 = new Set([
  'hero_id', 'team', 'game_time', 'kills', 'deaths', 'assists', 'net_worth',
  'hero_damage', 'health', 'max_health', 'level', 'steam_id', 'tick',
  'entity_type', 'entity_index', 'event_type',
]);
const metadataFields = new Set([
  'entity_type', 'entity_index', 'tick', 'game_time', 'steam_id', 'hero_id', 'team', 'event_type',
]);
const leakagePattern = /(winner|final.?outcome|match.?outcome|next.?action|future|three.?minute|five.?minute|ten.?minute)/i;
const families = [
  ['SPENDABLE_CURRENCY', /(spendable.*soul|current.*soul|wallet|currency|gold|cash|credit)/i],
  ['SHOP_OPPORTUNITY', /(shop|store|merchant|purchase.?zone|buy.?zone)/i],
  ['INVENTORY_LEGALITY', /(inventory|slot|flex|item|component|recipe|upgrade|stack)/i],
  ['RULESET_AVAILABILITY', /(patch|ruleset|build.?version|enabled|disabled|unlock|prerequisite)/i],
  ['POSITION_OPPORTUNITY', /(position|origin|location|coord|pos_[xyz]|velocity|movement)/i],
  ['ALIVE_COMBAT_CONTEXT', /(alive|life.?state|respawn|death.?time|health|combat|damage|stun)/i],
  ['PURCHASE_TIMING_CONTEXT', /(purchase|buy|last.?purchase|inventory.?change)/i],
];

const files = [];
for (const entry of await readdir(timelineRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const path = join(timelineRoot, entry.name, 'events.ndjson');
  try {
    if ((await stat(path)).size > 0) files.push({ matchId: entry.name, path });
  } catch {}
}
files.sort((a, b) => a.matchId.localeCompare(b.matchId, undefined, { numeric: true }));

const entityCounts = new Map();
const fieldStats = new Map();
const matches = new Set();
let eventRowCount = 0;
for (const file of files) {
  const input = createInterface({ input: createReadStream(file.path), crlfDelay: Infinity });
  for await (const line of input) {
    if (eventRowCount >= maxRows) break;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const payload = row?.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    eventRowCount += 1;
    matches.add(file.matchId);
    const entity = String(payload.entity_type ?? 'UNKNOWN');
    entityCounts.set(entity, (entityCounts.get(entity) ?? 0) + 1);
    for (const [field, value] of Object.entries(payload)) {
      const key = `${entity}\u0000${field}`;
      const current = fieldStats.get(key) ?? {
        entity, field, count: 0, nonnull: 0, matches: new Set(), types: new Set(), samples: [],
      };
      current.count += 1;
      if (value !== null && value !== undefined) current.nonnull += 1;
      current.matches.add(file.matchId);
      current.types.add(valueType(value));
      if (current.samples.length < 8) {
        const sample = preview(value);
        if (!current.samples.includes(sample)) current.samples.push(sample);
      }
      fieldStats.set(key, current);
    }
    if (eventRowCount >= maxRows) break;
  }
  if (eventRowCount >= maxRows) break;
}

const timelineFields = [];
for (const current of fieldStats.values()) {
  const family = fieldFamily(current.field);
  if (!family) continue;
  const existing = existingV6.has(current.field.toLowerCase());
  const leakage = leakagePattern.test(current.field) ? 'REJECT_FUTURE_OR_OUTCOME' : 'PRE_DECISION_EVENT_FIELD';
  const availability = current.nonnull / Math.max(1, entityCounts.get(current.entity) ?? 0);
  const matchCoverage = current.matches.size / Math.max(1, matches.size);
  const acceptable = !existing && !metadataFields.has(current.field.toLowerCase()) && leakage === 'PRE_DECISION_EVENT_FIELD' && availability >= 0.05 && matchCoverage >= 0.10;
  timelineFields.push({
    canonicalFieldName: `timeline.${current.entity}.${current.field}`,
    family,
    sourceSystem: 'SELF_HOSTED_DEADLOCK_LIVE_EVENTS_SSE',
    sourceEntity: current.entity,
    sourceField: current.field,
    dataTypes: [...current.types].sort(),
    semanticMeaning: 'SOURCE_FIELD_NAME_ONLY_REQUIRES_STAGE_B_SEMANTIC_VALIDATION',
    timestampSemantics: 'EVENT_GAME_TIME_AND_TICK',
    directlyObserved: true,
    reconstructed: false,
    availabilityRateWithinEntityEvents: availability,
    matchCoverageWithinScannedTimeline: matchCoverage,
    matchCount: current.matches.size,
    sampleValues: current.samples,
    alreadyRepresentedInDatasetV6: existing,
    leakageClassification: leakage,
    acceptableForStageB: acceptable,
    rejectionReason: acceptable ? undefined : existing ? 'ALREADY_IN_V6' : leakage !== 'PRE_DECISION_EVENT_FIELD' ? 'FUTURE_OR_OUTCOME_NAME' : 'INSUFFICIENT_SOURCE_COVERAGE',
  });
}

const postgresFields = [];
const postgresText = await readFile(postgresColumnsPath, 'utf8');
for (const line of postgresText.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const [schema, table, column, dataType] = line.split('\t');
  if (!schema || !table || !column || !dataType) continue;
  const family = fieldFamily(column);
  if (!family) continue;
  postgresFields.push({
    canonicalFieldName: `postgres.${schema}.${table}.${column}`,
    family,
    sourceSystem: 'POSTGRESQL',
    sourceEntity: `${schema}.${table}`,
    sourceField: column,
    dataTypes: [dataType],
    semanticMeaning: 'DATABASE_COLUMN_REQUIRES_STAGE_B_ROW_TIMESTAMP_AND_COVERAGE_AUDIT',
    timestampSemantics: 'UNKNOWN_UNTIL_TABLE_TIMESTAMP_AUDIT',
    directlyObserved: true,
    reconstructed: false,
    availabilityRateWithinEntityEvents: undefined,
    matchCoverageWithinScannedTimeline: undefined,
    matchCount: undefined,
    sampleValues: [],
    alreadyRepresentedInDatasetV6: false,
    leakageClassification: leakagePattern.test(column) ? 'REJECT_FUTURE_OR_OUTCOME' : 'UNKNOWN_ROW_TIMESTAMP',
    acceptableForStageB: false,
    rejectionReason: 'REQUIRES_ROW_TIMESTAMP_AND_COVERAGE_AUDIT',
  });
}

const inventory = [...timelineFields, ...postgresFields].sort((a, b) => a.canonicalFieldName.localeCompare(b.canonicalFieldName));
const accepted = inventory.filter((row) => row.acceptableForStageB);
const report = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_OBSERVABILITY_INVENTORY',
  trainingPerformed: false,
  valueTrainingPerformed: false,
  futureTestEvaluated: false,
  productionChangesPerformed: false,
  source: {
    timelineRoot,
    eventFileCountDiscovered: files.length,
    eventRowCountScanned,
    matchCountScanned: matches.size,
    entityTypeCounts: Object.fromEntries([...entityCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    postgresColumnsPath,
  },
  inventory,
  summary: {
    candidateFieldCount: inventory.length,
    stageBCandidateFieldCount: accepted.length,
    stageBCandidateFamilies: [...new Set(accepted.map((row) => row.family))].sort(),
    stageAGatePassed: accepted.length > 0,
    nextStep: accepted.length > 0 ? 'RUN_TIMESTAMP_LEAKAGE_AUDIT' : 'IMPLEMENT_NEW_TELEMETRY_COLLECTION',
  },
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report.summary, null, 2));

function fieldFamily(name) {
  for (const [family, pattern] of families) if (pattern.test(name)) return family;
  return undefined;
}
function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}
function preview(value) {
  if (typeof value === 'string') return value.slice(0, 240);
  const text = JSON.stringify(value);
  return text === undefined ? String(value) : text.slice(0, 240);
}
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
