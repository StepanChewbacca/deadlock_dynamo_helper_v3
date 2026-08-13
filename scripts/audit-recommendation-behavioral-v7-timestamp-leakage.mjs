import { readFile, writeFile } from 'node:fs/promises';

const inventoryPath = required('BEHAVIORAL_V7_OBSERVABILITY_INVENTORY_PATH');
const outputPath = required('BEHAVIORAL_V7_TEMPORAL_AUDIT_PATH');

const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
assertInventory(inventory);

const accepted = [];
const rejected = [];
for (const field of inventory.inventory) {
  const result = auditField(field);
  (result.acceptedForDatasetV7 ? accepted : rejected).push(result);
}

const derived = deriveHistoricalLedgerFields(inventory.inventory);
accepted.push(...derived.filter((field) => field.acceptedForDatasetV7));
rejected.push(...derived.filter((field) => !field.acceptedForDatasetV7));

const familyCoverage = {};
for (const field of accepted) {
  const current = familyCoverage[field.family] ?? { acceptedFieldCount: 0, exactTimestampFieldCount: 0, reconstructedFieldCount: 0 };
  current.acceptedFieldCount += 1;
  current.exactTimestampFieldCount += field.timestampContract === 'SOURCE_EVENT_AT_OR_BEFORE_DECISION' ? 1 : 0;
  current.reconstructedFieldCount += field.reconstructed === true ? 1 : 0;
  familyCoverage[field.family] = current;
}

const report = {
  schemaVersion: 1,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_TIMESTAMP_LEAKAGE_AUDIT',
  executorVersion: 'STRICT_PREDECISION_TEMPORAL_AUDIT_1',
  sourceInventory: {
    schemaVersion: inventory.schemaVersion,
    executorVersion: inventory.executorVersion,
    eventRowCountScanned: inventory.source.eventRowCountScanned,
    matchCountScanned: inventory.source.matchCountScanned,
  },
  contracts: {
    futureTestEvaluated: false,
    trainingPerformed: false,
    valueTrainingPerformed: false,
    observedActionMaySelectField: false,
    futureOutcomeMaySelectField: false,
    netWorthMayRepresentWallet: false,
    sourceTimestampMustNotExceedDecisionTimestamp: true,
    forwardFillAcrossFutureEventsForbidden: true,
  },
  acceptedFields: accepted,
  rejectedFields: rejected,
  familyCoverage,
  summary: {
    acceptedFieldCount: accepted.length,
    rejectedFieldCount: rejected.length,
    acceptedFamilies: Object.keys(familyCoverage).sort(),
    exactTimestampFieldCount: accepted.filter((field) => field.timestampContract === 'SOURCE_EVENT_AT_OR_BEFORE_DECISION').length,
    reconstructedFieldCount: accepted.filter((field) => field.reconstructed === true).length,
    stageBGatePassed: accepted.length > 0,
    nextStep: accepted.length > 0 ? 'BUILD_DATASET_V7' : 'IMPLEMENT_NEW_TELEMETRY_COLLECTION',
  },
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report.summary, null, 2));

function auditField(field) {
  const base = {
    canonicalFieldName: field.canonicalFieldName,
    family: field.family,
    sourceSystem: field.sourceSystem,
    sourceEntity: field.sourceEntity,
    sourceField: field.sourceField,
    directlyObserved: field.directlyObserved === true,
    reconstructed: field.reconstructed === true,
  };
  if (field.acceptableForStageB !== true) {
    return { ...base, acceptedForDatasetV7: false, rejectionReason: field.rejectionReason ?? 'STAGE_A_REJECTED' };
  }
  if (field.alreadyRepresentedInDatasetV6 === true) {
    return { ...base, acceptedForDatasetV7: false, rejectionReason: 'ALREADY_IN_DATASET_V6' };
  }
  if (field.leakageClassification !== 'PRE_DECISION_EVENT_FIELD' && field.sourceSystem !== 'TYPEORM_ENTITY_SCHEMA') {
    return { ...base, acceptedForDatasetV7: false, rejectionReason: 'TIMESTAMP_OR_LEAKAGE_NOT_PROVEN' };
  }
  if (field.family === 'SPENDABLE_CURRENCY' && /net.?worth/i.test(field.sourceField)) {
    return { ...base, acceptedForDatasetV7: false, rejectionReason: 'NET_WORTH_IS_NOT_SPENDABLE_CURRENCY' };
  }
  if (field.sourceSystem === 'SELF_HOSTED_DEADLOCK_LIVE_EVENTS_SSE') {
    return {
      ...base,
      acceptedForDatasetV7: true,
      timestampContract: 'SOURCE_EVENT_AT_OR_BEFORE_DECISION',
      alignmentContract: 'LAST_EXACT_SOURCE_EVENT_NOT_AFTER_DECISION',
      maximumForwardFillS: 0,
      sourceTimestampRequired: true,
      missingnessIndicatorRequired: true,
      leakageClassification: 'SAFE_PREDECISION_DIRECT_EVENT',
    };
  }
  return { ...base, acceptedForDatasetV7: false, rejectionReason: 'DATABASE_FIELD_REQUIRES_EXPLICIT_LEDGER_RECONSTRUCTION_RULE' };
}

function deriveHistoricalLedgerFields(fields) {
  const names = new Set(fields.map((field) => `${field.sourceEntity}.${field.sourceField}`));
  const output = [];
  const hasPurchaseTime = names.has('match_player_items.purchaseTimeS');
  const hasSoldTime = names.has('match_player_items.soldTimeS');
  const hasSlotOrder = names.has('match_player_items.slotOrder');

  if (hasPurchaseTime) {
    output.push(derivedField({
      name: 'derived.timeSinceLastPurchaseS',
      family: 'PURCHASE_TIMING_CONTEXT',
      sources: ['match_player_items.purchaseTimeS'],
      formula: 'decisionGameTimeS - max(purchaseTimeS <= decisionGameTimeS)',
    }));
  }
  if (hasPurchaseTime && hasSoldTime) {
    output.push(derivedField({
      name: 'derived.timeSinceLastInventoryMutationS',
      family: 'PURCHASE_TIMING_CONTEXT',
      sources: ['match_player_items.purchaseTimeS', 'match_player_items.soldTimeS'],
      formula: 'decisionGameTimeS - max(purchase/sale event time <= decisionGameTimeS)',
    }));
    output.push(derivedField({
      name: 'derived.activeInventoryItemCountAtDecision',
      family: 'INVENTORY_LEGALITY',
      sources: ['match_player_items.purchaseTimeS', 'match_player_items.soldTimeS'],
      formula: 'count purchase events <= decision minus sale events <= decision',
    }));
  }
  if (hasPurchaseTime && hasSlotOrder) {
    output.push(derivedField({
      name: 'derived.occupiedSlotOrdersAtDecision',
      family: 'INVENTORY_LEGALITY',
      sources: ['match_player_items.purchaseTimeS', 'match_player_items.slotOrder'],
      formula: 'slotOrder for purchase rows whose purchase event is <= decision and not sold before decision',
    }));
  }
  return output;
}

function derivedField({ name, family, sources, formula }) {
  return {
    canonicalFieldName: name,
    family,
    sourceSystem: 'HISTORICAL_EVENT_LEDGER_RECONSTRUCTION',
    sourceEntity: 'match_player_items',
    sourceField: sources.join('+'),
    directlyObserved: false,
    reconstructed: true,
    acceptedForDatasetV7: true,
    timestampContract: 'SOURCE_EVENT_AT_OR_BEFORE_DECISION',
    alignmentContract: 'EVENT_LEDGER_PREFIX_ONLY',
    maximumForwardFillS: 0,
    sourceTimestampRequired: true,
    missingnessIndicatorRequired: true,
    leakageClassification: 'SAFE_PREDECISION_EVENT_LEDGER_RECONSTRUCTION',
    formula,
    forbiddenImplementation: 'DO_NOT_READ_FUTURE_MUTATION_AS_A_FEATURE',
  };
}

function assertInventory(value) {
  if (
    value?.operation !== 'RECOMMENDATION_BEHAVIORAL_V7_OBSERVABILITY_INVENTORY' ||
    !Array.isArray(value?.inventory) ||
    value?.trainingPerformed !== false ||
    value?.futureTestEvaluated !== false
  ) {
    throw new Error('Unsupported or unsafe Behavioral V7 observability inventory.');
  }
}
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
