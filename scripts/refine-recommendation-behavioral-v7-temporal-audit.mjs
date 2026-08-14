import { readFile, writeFile } from 'node:fs/promises';

const inventoryPath = required('BEHAVIORAL_V7_OBSERVABILITY_INVENTORY_PATH');
const outputPath = required('BEHAVIORAL_V7_TEMPORAL_AUDIT_PATH');
const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
if (
  inventory?.schemaVersion !== 2 ||
  inventory?.operation !== 'RECOMMENDATION_BEHAVIORAL_V7_OBSERVABILITY_INVENTORY' ||
  inventory?.trainingPerformed !== false ||
  inventory?.futureTestEvaluated !== false ||
  !Array.isArray(inventory?.inventory)
) {
  throw new Error('Unsupported Stage A V7 inventory.');
}

const acceptedFields = [];
const rejectedFields = [];
for (const field of inventory.inventory) {
  const result = classify(field);
  (result.acceptedForDatasetV7 ? acceptedFields : rejectedFields).push(result);
}
acceptedFields.push(...derivedLedgerFields(inventory.inventory));

const acceptedFamilies = [...new Set(acceptedFields.map((field) => field.family))].sort();
const report = {
  schemaVersion: 2,
  operation: 'RECOMMENDATION_BEHAVIORAL_V7_TIMESTAMP_LEAKAGE_AUDIT',
  executorVersion: 'SEMANTIC_STRICT_PREDECISION_POLICY_3_EXPLICIT_IDENTITY',
  generatedAt: new Date().toISOString(),
  sourceInventory: {
    executorVersion: inventory.executorVersion,
    eventRowCountScanned: inventory.source?.eventRowCountScanned,
    matchCountScanned: inventory.source?.matchCountScanned,
  },
  contracts: {
    trainingPerformed: false,
    valueTrainingPerformed: false,
    futureTestEvaluated: false,
    observedActionMaySelectField: false,
    futureOutcomeMaySelectField: false,
    netWorthMayRepresentWallet: false,
    sourceTimestampMustNotExceedDecisionTimestamp: true,
    forwardFillAcrossFutureEventsForbidden: true,
    playerPawnIdentityAssumedWithoutProof: false,
    teamIdentityAssumedWithoutProof: false,
    datasetPlayerIdMayRepresentSteamIdWithoutDirectBridge: false,
    heroIdMayBridgeDatasetPlayerToSteamId: false,
  },
  acceptedFields,
  rejectedFields,
  summary: {
    acceptedFieldCount: acceptedFields.length,
    rejectedFieldCount: rejectedFields.length,
    acceptedFamilies,
    spendableCurrencyObserved: acceptedFields.some((field) => field.family === 'SPENDABLE_CURRENCY'),
    directPlayerControllerFieldCount: acceptedFields.filter((field) => field.sourceEntity === 'player_controller').length,
    reconstructedFieldCount: acceptedFields.filter((field) => field.reconstructed === true).length,
    stageBGatePassed: acceptedFields.length > 0,
    nextStep: acceptedFields.length > 0 ? 'BUILD_DATASET_V7' : 'IMPLEMENT_NEW_TELEMETRY_COLLECTION',
  },
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report.summary, null, 2));

function classify(field) {
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
    return reject(base, field.rejectionReason ?? 'STAGE_A_REJECTED');
  }
  if (field.alreadyRepresentedInDatasetV6 === true) {
    return reject(base, 'ALREADY_IN_DATASET_V6');
  }
  if (field.family === 'SPENDABLE_CURRENCY' && /net.?worth/i.test(field.sourceField)) {
    return reject(base, 'NET_WORTH_IS_NOT_SPENDABLE_CURRENCY');
  }
  if (field.sourceSystem === 'SELF_HOSTED_DEADLOCK_LIVE_EVENTS_SSE') {
    if (field.sourceEntity !== 'player_controller') {
      return reject(base, 'IDENTITY_JOIN_NOT_PROVEN_FOR_DIRECT_BEHAVIORAL_FEATURE');
    }
    if (['player_slot'].includes(field.sourceField)) {
      return reject(base, 'IDENTITY_FIELD_NOT_BEHAVIORAL_STATE');
    }
    if (['objective_damage'].includes(field.sourceField)) {
      return reject(base, 'CUMULATIVE_OUTCOME_PROXY_NOT_REQUIRED');
    }
    return accept(base, {
      timestampContract: 'SOURCE_EVENT_AT_OR_BEFORE_DECISION',
      alignmentContract: 'PLAYER_CONTROLLER_STEAM_ID_LAST_EVENT_NOT_AFTER_DECISION',
      identityJoinContract: 'MATCH_ID_PLUS_STEAM_ID_DIRECT',
      sourceTimestampRequired: true,
      missingnessIndicatorRequired: true,
      leakageClassification: 'SAFE_PREDECISION_PLAYER_CONTROLLER_EVENT',
    });
  }
  if (field.sourceSystem === 'TYPEORM_ENTITY_SCHEMA') {
    if (field.sourceEntity === 'match_player_items') {
      return reject(base, 'USE_PREFIX_EVENT_LEDGER_DERIVATION_NOT_DIRECT_ROW_VALUE');
    }
    if (isStaticRulesetEntity(field.sourceEntity)) {
      return accept(base, {
        timestampContract: 'MATCH_RULESET_VERSIONED_STATIC_JOIN',
        alignmentContract: 'RESOLVED_RULESET_PLUS_ITEM_ID',
        identityJoinContract: 'MATCH_RULESET_ID_AND_ITEM_ID',
        sourceTimestampRequired: false,
        missingnessIndicatorRequired: true,
        leakageClassification: 'SAFE_VERSIONED_STATIC_METADATA',
      });
    }
    return reject(base, 'NO_EXPLICIT_PREDECISION_JOIN_CONTRACT');
  }
  return reject(base, 'UNSUPPORTED_SOURCE_SYSTEM');
}

function derivedLedgerFields(fields) {
  const names = new Set(fields.map((field) => `${field.sourceEntity}.${field.sourceField}`));
  const output = [];
  if (names.has('match_player_items.purchaseTimeS')) {
    output.push(derived('derived.timeSinceLastPurchaseS', 'PURCHASE_TIMING_CONTEXT', ['match_player_items.purchaseTimeS'], 'decisionGameTimeS - max(purchaseTimeS <= decisionGameTimeS)'));
  }
  if (names.has('match_player_items.purchaseTimeS') && names.has('match_player_items.soldTimeS')) {
    output.push(derived('derived.timeSinceLastInventoryMutationS', 'PURCHASE_TIMING_CONTEXT', ['match_player_items.purchaseTimeS', 'match_player_items.soldTimeS'], 'decisionGameTimeS - max(purchase/sale event time <= decisionGameTimeS)'));
    output.push(derived('derived.activeInventoryItemCountAtDecision', 'INVENTORY_LEGALITY', ['match_player_items.purchaseTimeS', 'match_player_items.soldTimeS'], 'count items purchased and not sold at decision time'));
  }
  if (names.has('match_player_items.purchaseTimeS') && names.has('match_player_items.slotOrder')) {
    output.push(derived('derived.occupiedSlotOrdersAtDecision', 'INVENTORY_LEGALITY', ['match_player_items.purchaseTimeS', 'match_player_items.slotOrder'], 'slot orders for items active at decision time'));
  }
  return output;
}

function derived(canonicalFieldName, family, sources, formula) {
  return {
    canonicalFieldName,
    family,
    sourceSystem: 'HISTORICAL_EVENT_LEDGER_RECONSTRUCTION',
    sourceEntity: 'match_player_items',
    sourceField: sources.join('+'),
    directlyObserved: false,
    reconstructed: true,
    acceptedForDatasetV7: true,
    timestampContract: 'SOURCE_EVENT_AT_OR_BEFORE_DECISION',
    alignmentContract: 'EVENT_LEDGER_PREFIX_ONLY',
    identityJoinContract: 'MATCH_PLAYER_DATABASE_SURROGATE_ID',
    steamIdentityBridgeRequiredForLiveEventJoin: true,
    sourceTimestampRequired: true,
    missingnessIndicatorRequired: true,
    leakageClassification: 'SAFE_PREDECISION_EVENT_LEDGER_RECONSTRUCTION',
    formula,
    forbiddenImplementation: 'DO_NOT_READ_FUTURE_MUTATION_AS_A_FEATURE',
  };
}
function isStaticRulesetEntity(entity) {
  return ['game_rulesets', 'item_catalog_items', 'item_catalog_recipes', 'item_catalog_versions', 'item_components', 'items', 'raw_match_metadata'].includes(entity);
}
function accept(base, extra) {
  return { ...base, ...extra, acceptedForDatasetV7: true };
}
function reject(base, rejectionReason) {
  return { ...base, acceptedForDatasetV7: false, rejectionReason };
}
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
