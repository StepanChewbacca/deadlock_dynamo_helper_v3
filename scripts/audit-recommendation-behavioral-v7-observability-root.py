#!/usr/bin/env python3
import argparse
import json
import os
import re
from collections import defaultdict
from pathlib import Path

EXISTING_V6 = {
    'hero_id', 'team', 'game_time', 'kills', 'deaths', 'assists', 'net_worth',
    'hero_damage', 'health', 'max_health', 'level', 'steam_id', 'tick',
    'entity_type', 'entity_index', 'event_type', 'purchase_time_s',
}
METADATA_FIELDS = {
    'entity_type', 'entity_index', 'tick', 'game_time', 'steam_id', 'hero_id',
    'team', 'event_type',
}
LEAKAGE = re.compile(
    r'(winner|won|final.?outcome|match.?outcome|next.?action|future|three.?minute|five.?minute|ten.?minute)',
    re.I,
)
FAMILIES = [
    ('SPENDABLE_CURRENCY', re.compile(r'(spendable.*soul|current.*soul|wallet|currency|gold|cash|credit)', re.I)),
    ('SHOP_OPPORTUNITY', re.compile(r'(shop|store|merchant|purchase.?zone|buy.?zone)', re.I)),
    ('INVENTORY_LEGALITY', re.compile(r'(inventory|slot|flex|item|component|recipe|upgrade|stack|sold)', re.I)),
    ('RULESET_AVAILABILITY', re.compile(r'(patch|ruleset|build.?version|enabled|disabled|unlock|prerequisite)', re.I)),
    ('POSITION_OPPORTUNITY', re.compile(r'(position|origin|location|coord|pos_[xyz]|velocity|movement)', re.I)),
    ('ALIVE_COMBAT_CONTEXT', re.compile(r'(alive|life.?state|respawn|death.?time|health|combat|damage|stun)', re.I)),
    ('PURCHASE_TIMING_CONTEXT', re.compile(r'(purchase|buy|last.?purchase|inventory.?change|sold.?time)', re.I)),
]


def family_for(name):
    for family, pattern in FAMILIES:
        if pattern.search(name):
            return family
    return None


def value_type(value):
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'boolean'
    if isinstance(value, int):
        return 'integer'
    if isinstance(value, float):
        return 'number'
    if isinstance(value, str):
        return 'string'
    if isinstance(value, list):
        return 'array'
    if isinstance(value, dict):
        return 'object'
    return type(value).__name__


def preview(value):
    if isinstance(value, str):
        return value[:240]
    try:
        return json.dumps(value, sort_keys=True)[:240]
    except Exception:
        return str(value)[:240]


def timeline_inventory(root, max_rows):
    paths = sorted(root.glob('*/events.ndjson')) if root.is_dir() else []
    entity_counts = defaultdict(int)
    stats = {}
    matches = set()
    rows = 0
    for path in paths:
        match_id = path.parent.name
        try:
            source = path.open('r', encoding='utf-8')
        except OSError:
            continue
        with source:
            for line in source:
                if rows >= max_rows:
                    break
                try:
                    payload = (json.loads(line).get('payload') or {})
                except Exception:
                    continue
                if not isinstance(payload, dict):
                    continue
                rows += 1
                matches.add(match_id)
                entity = str(payload.get('entity_type') or 'UNKNOWN')
                entity_counts[entity] += 1
                for field, value in payload.items():
                    key = (entity, field)
                    entry = stats.setdefault(key, {
                        'count': 0,
                        'nonnull': 0,
                        'matches': set(),
                        'types': set(),
                        'samples': [],
                    })
                    entry['count'] += 1
                    if value is not None:
                        entry['nonnull'] += 1
                    entry['matches'].add(match_id)
                    entry['types'].add(value_type(value))
                    sample = preview(value)
                    if len(entry['samples']) < 8 and sample not in entry['samples']:
                        entry['samples'].append(sample)
            if rows >= max_rows:
                break

    inventory = []
    for (entity, field), entry in sorted(stats.items()):
        family = family_for(field)
        if not family:
            continue
        existing = field.lower() in EXISTING_V6
        leakage = 'REJECT_FUTURE_OR_OUTCOME' if LEAKAGE.search(field) else 'PRE_DECISION_EVENT_FIELD'
        availability = entry['nonnull'] / max(1, entity_counts[entity])
        match_coverage = len(entry['matches']) / max(1, len(matches))
        accepted = (
            not existing
            and field.lower() not in METADATA_FIELDS
            and leakage == 'PRE_DECISION_EVENT_FIELD'
            and availability >= 0.05
            and match_coverage >= 0.10
        )
        inventory.append({
            'canonicalFieldName': f'timeline.{entity}.{field}',
            'family': family,
            'sourceSystem': 'SELF_HOSTED_DEADLOCK_LIVE_EVENTS_SSE',
            'sourceEntity': entity,
            'sourceField': field,
            'dataTypes': sorted(entry['types']),
            'semanticMeaning': 'SOURCE_FIELD_NAME_ONLY_REQUIRES_STAGE_B_SEMANTIC_VALIDATION',
            'timestampSemantics': 'EVENT_GAME_TIME_AND_TICK',
            'directlyObserved': True,
            'reconstructed': False,
            'availabilityRateWithinEntityEvents': availability,
            'matchCoverageWithinScannedTimeline': match_coverage,
            'matchCount': len(entry['matches']),
            'sampleValues': entry['samples'],
            'alreadyRepresentedInDatasetV6': existing,
            'leakageClassification': leakage,
            'acceptableForStageB': accepted,
            'rejectionReason': None if accepted else (
                'ALREADY_IN_V6' if existing else
                'FUTURE_OR_OUTCOME_NAME' if leakage != 'PRE_DECISION_EVENT_FIELD' else
                'INSUFFICIENT_SOURCE_COVERAGE'
            ),
        })
    return paths, rows, matches, entity_counts, inventory


def entity_inventory(root):
    inventory = []
    entity_pattern = re.compile(r"@Entity\(['\"]([^'\"]+)['\"]\)")
    property_pattern = re.compile(
        r"@Column\([^)]*\)[\s\S]{0,220}?\n\s*([A-Za-z0-9_]+)!:\s*([^;\n]+);"
    )
    for path in sorted(root.glob('*.entity.ts')) if root.is_dir() else []:
        try:
            text = path.read_text(encoding='utf-8')
        except OSError:
            continue
        entity_match = entity_pattern.search(text)
        table = entity_match.group(1) if entity_match else path.stem
        for match in property_pattern.finditer(text):
            prop = match.group(1)
            data_type = match.group(2).strip()
            family = family_for(prop)
            if not family:
                continue
            leakage = 'REJECT_FUTURE_OR_OUTCOME' if LEAKAGE.search(prop) else 'UNKNOWN_ROW_TIMESTAMP'
            existing = prop in {'netWorth', 'kills', 'deaths', 'assists', 'heroId', 'team', 'purchaseTimeS'}
            inventory.append({
                'canonicalFieldName': f'database-schema.{table}.{prop}',
                'family': family,
                'sourceSystem': 'TYPEORM_ENTITY_SCHEMA',
                'sourceEntity': table,
                'sourceField': prop,
                'dataTypes': [data_type],
                'semanticMeaning': 'DATABASE_SCHEMA_FIELD_REQUIRES_STAGE_B_ROW_TIMESTAMP_AND_RUNTIME_COVERAGE_AUDIT',
                'timestampSemantics': 'UNKNOWN_UNTIL_ROW_TIMESTAMP_AUDIT',
                'directlyObserved': True,
                'reconstructed': False,
                'alreadyRepresentedInDatasetV6': existing,
                'leakageClassification': leakage,
                'acceptableForStageB': (not existing and leakage != 'REJECT_FUTURE_OR_OUTCOME'),
                'rejectionReason': (
                    'ALREADY_IN_V6' if existing else
                    'FUTURE_OR_OUTCOME_NAME' if leakage == 'REJECT_FUTURE_OR_OUTCOME' else
                    None
                ),
            })
    return inventory


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--timeline-root', required=True)
    parser.add_argument('--entity-root', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--max-event-rows', type=int, default=250000)
    args = parser.parse_args()

    paths, row_count, matches, entity_counts, timeline_fields = timeline_inventory(
        Path(args.timeline_root), args.max_event_rows
    )
    entity_fields = entity_inventory(Path(args.entity_root))
    inventory = sorted(
        timeline_fields + entity_fields,
        key=lambda row: row['canonicalFieldName'],
    )
    accepted = [row for row in inventory if row['acceptableForStageB']]
    report = {
        'schemaVersion': 2,
        'operation': 'RECOMMENDATION_BEHAVIORAL_V7_OBSERVABILITY_INVENTORY',
        'executorVersion': 'TIMELINE_AND_TYPEORM_SCHEMA_INVENTORY_2',
        'trainingPerformed': False,
        'valueTrainingPerformed': False,
        'futureTestEvaluated': False,
        'productionChangesPerformed': False,
        'source': {
            'timelineRoot': args.timeline_root,
            'entitySchemaRoot': args.entity_root,
            'eventFileCountDiscovered': len(paths),
            'eventRowCountScanned': row_count,
            'matchCountScanned': len(matches),
            'entityTypeCounts': dict(sorted(entity_counts.items())),
            'runtimeDatabaseCurrencyAuditInheritedFromV6': True,
        },
        'inventory': inventory,
        'summary': {
            'candidateFieldCount': len(inventory),
            'stageBCandidateFieldCount': len(accepted),
            'stageBCandidateFamilies': sorted(set(row['family'] for row in accepted)),
            'stageAGatePassed': len(accepted) > 0,
            'nextStep': 'RUN_TIMESTAMP_LEAKAGE_AUDIT' if accepted else 'IMPLEMENT_NEW_TELEMETRY_COLLECTION',
        },
    }
    Path(args.output).write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print(json.dumps(report['summary'], indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
