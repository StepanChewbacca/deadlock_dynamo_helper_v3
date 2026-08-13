#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--timeline-root', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()

    root = Path(args.timeline_root)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    event_count = 0
    player_event_count = 0
    emitted_count = 0
    match_count = 0
    player_keys = set()

    with output.open('w', encoding='utf-8') as target:
        for path in sorted(root.glob('*/events.ndjson')) if root.is_dir() else []:
            match_id = path.parent.name
            match_had_rows = False
            previous = {}
            try:
                source = path.open('r', encoding='utf-8')
            except OSError:
                continue
            with source:
                for line in source:
                    event_count += 1
                    try:
                        row = json.loads(line)
                    except Exception:
                        continue
                    payload = row.get('payload') or {}
                    if payload.get('entity_type') != 'player_controller':
                        continue
                    steam_id = payload.get('steam_id')
                    game_time = payload.get('game_time')
                    if steam_id is None or not isinstance(game_time, (int, float)):
                        continue
                    player_event_count += 1
                    match_had_rows = True
                    player_key = f'{match_id}:{steam_id}'
                    player_keys.add(player_key)
                    observation = {
                        'originalAssignedLane': payload.get('original_assigned_lane'),
                        'upgrades': payload.get('upgrades'),
                    }
                    signature = canonical(observation)
                    if previous.get(player_key) == signature:
                        continue
                    previous[player_key] = signature
                    record = {
                        'schemaVersion': 1,
                        'ledgerVersion': 'RECOMMENDATION_BEHAVIORAL_V7_HISTORICAL_LEDGER_1',
                        'matchId': match_id,
                        'steamId': str(steam_id),
                        'gameTimeS': float(game_time),
                        'sourceEntity': 'player_controller',
                        'sourceTimestampContract': 'SOURCE_EVENT_AT_OR_BEFORE_DECISION',
                        'originalAssignedLane': observation['originalAssignedLane'],
                        'upgrades': observation['upgrades'],
                    }
                    target.write(json.dumps(record, sort_keys=True, separators=(',', ':')) + '\n')
                    emitted_count += 1
            if match_had_rows:
                match_count += 1

    manifest = {
        'schemaVersion': 1,
        'operation': 'RECOMMENDATION_BEHAVIORAL_V7_HISTORICAL_LEDGER_EXPORT',
        'ledgerVersion': 'RECOMMENDATION_BEHAVIORAL_V7_HISTORICAL_LEDGER_1',
        'trainingPerformed': False,
        'futureTestEvaluated': False,
        'sourceEventCountScanned': event_count,
        'playerControllerEventCount': player_event_count,
        'emittedChangeEventCount': emitted_count,
        'matchCount': match_count,
        'playerKeyCount': len(player_keys),
        'outputFile': output.name,
        'fields': ['originalAssignedLane', 'upgrades'],
        'timestampContract': 'SOURCE_EVENT_AT_OR_BEFORE_DECISION',
        'observedActionUsed': False,
    }
    output.with_suffix('.manifest.json').write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + '\n', encoding='utf-8'
    )
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
