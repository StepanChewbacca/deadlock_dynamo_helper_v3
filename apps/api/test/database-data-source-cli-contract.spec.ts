import { InstanceChecker } from 'typeorm/util/InstanceChecker';

describe('database data-source CLI contract', () => {
  it('exports exactly one DataSource instance for TypeORM CLI discovery', async () => {
    const dataSourceModule = await import('../src/database/data-source');
    const dataSourceExports = Object.values(dataSourceModule)
      .filter((value) => InstanceChecker.isDataSource(value));

    expect(dataSourceExports).toHaveLength(1);
    expect(dataSourceExports[0]).toBe(dataSourceModule.AppDataSource);
  });
});
