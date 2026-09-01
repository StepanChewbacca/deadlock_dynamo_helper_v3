const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  GEP_CANONICAL_SCHEMA_VERSION,
  canonicalizeGepRosterPayloadV2,
} = require('../dist');

const fixturePath = path.join(__dirname, 'fixtures/gep/deadlock-roster-official-doc-v1.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
assert.equal(fixture.fixtureContract, 'deadlock-gep-official-doc-shape-v1');

const officialShape = canonicalizeGepRosterPayloadV2(fixture.raw);
assert.equal(officialShape.schemaVersion, GEP_CANONICAL_SCHEMA_VERSION);
assert.equal(officialShape.normalizerVersion, 'gep-canonical-v2');
assert.deepEqual(officialShape.canonicalPayload, fixture.expectedCanonical);
assert.deepEqual(officialShape.unknownFields, []);
assert.equal(officialShape.rawPayload.souls, 3510);

const officialFixtureCoverage = Object.keys(fixture.expectedCanonical).filter(
  (key) => Object.prototype.hasOwnProperty.call(officialShape.canonicalPayload, key),
).length / Object.keys(fixture.expectedCanonical).length;
assert.equal(officialFixtureCoverage, 1);

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