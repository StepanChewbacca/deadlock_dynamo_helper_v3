import { computeCatalogPayloadSha256 } from '../src/deadlock-live/catalog-content.service';

describe('catalog content hashing', () => {
  it('is deterministic across top-level item order and object key order', () => {
    const a = [
      { id: 2, name: 'B', nested: { z: 1, a: 2 } },
      { id: 1, name: 'A', component_items: ['x', 'y'] },
    ];
    const b = [
      { component_items: ['x', 'y'], name: 'A', id: 1 },
      { nested: { a: 2, z: 1 }, name: 'B', id: 2 },
    ];

    expect(computeCatalogPayloadSha256(a)).toBe(computeCatalogPayloadSha256(b));
  });

  it('changes when catalog semantics change', () => {
    const before = [{ id: 1, name: 'A', cost: 800, shopable: true }];
    const after = [{ id: 1, name: 'A', cost: 1600, shopable: true }];

    expect(computeCatalogPayloadSha256(before)).not.toBe(computeCatalogPayloadSha256(after));
  });
});
