const assert = require('node:assert/strict');
const {
  GEP_CANONICAL_SCHEMA_VERSION,
  canonicalizeGepRosterPayloadV2,
} = require('../dist');

const officialShape = canonicalizeGepRosterPayloadV2({
  steam_id: '76561198000000001',
  player_name: 'Local',
  is_local: true,
  hero_id: 15,
  hero_name: 'Hero',
  team_id: 2,
  assigned_lane: 6,
  level: 9,
  souls: 3510,
  health: 1210,
  max_health: 1650,
  kills: 3,
  deaths: 1,
  assist: 4,
  hero_damage: 12000,
  object_damage: 2500,
  hero_healing: 800,
});

assert.equal(officialShape.schemaVersion, GEP_CANONICAL_SCHEMA_VERSION);
assert.equal(officialShape.normalizerVersion, 'gep-canonical-v2');
assert.deepEqual(officialShape.canonicalPayload, {
  steamId: '76561198000000001',
  playerName: 'Local',
  isLocal: true,
  heroId: 15,
  heroName: 'Hero',
  teamId: 2,
  laneId: 6,
  level: 9,
  soulsRaw: 3510,
  health: 1210,
  maxHealth: 1650,
  kills: 3,
  deaths: 1,
  assists: 4,
  heroDamage: 12000,
  objectDamage: 2500,
  heroHealing: 800,
});
assert.deepEqual(officialShape.unknownFields, []);
assert.equal(officialShape.rawPayload.souls, 3510);

const compatibilityShape = canonicalizeGepRosterPayloadV2({
  steamId: 's1',
  isLocal: '1',
  heroId: '35',
  team: '3',
  lane: 4,
  assists: 2,
  healing: 100,
  soulsRaw: '5700',
  future_field: 'preserved only in raw payload',
});

assert.deepEqual(compatibilityShape.canonicalPayload, {
  steamId: 's1',
  isLocal: true,
  heroId: 35,
  teamId: 3,
  laneId: 4,
  soulsRaw: 5700,
  assists: 2,
  heroHealing: 100,
});
assert.deepEqual(compatibilityShape.unknownFields, ['future_field']);
assert.equal(compatibilityShape.rawPayload.future_field, 'preserved only in raw payload');

const malformed = canonicalizeGepRosterPayloadV2('not-an-object');
assert.deepEqual(malformed.canonicalPayload, {});
assert.deepEqual(malformed.unknownFields, []);

console.log('canonical GEP v2 fixtures: PASS');
