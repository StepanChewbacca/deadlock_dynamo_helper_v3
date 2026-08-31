import 'reflect-metadata';
import { join } from 'path';
import { DataSource } from 'typeorm';

async function main(): Promise<void> {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'deadlock_builds',
    entities: [join(__dirname, '../**/*.entity.js')],
    synchronize: false,
  });

  await dataSource.initialize();
  try {
    const schemaLog = await dataSource.driver.createSchemaBuilder().log();
    const upQueries = schemaLog.upQueries.map((query) => query.query);
    const destructive = upQueries.filter((query) => /\b(DROP|TRUNCATE)\b/i.test(query));
    const altersLegacyCatalog = upQueries.filter((query) => /\bitem_catalog_(versions|items|recipes)\b/i.test(query));
    console.log(JSON.stringify({
      ok: true,
      pendingQueryCount: upQueries.length,
      destructiveQueryCount: destructive.length,
      legacyCatalogMutationCount: altersLegacyCatalog.length,
      pendingQueries: upQueries,
    }, null, 2));
    if (destructive.length > 0 || altersLegacyCatalog.length > 0) {
      process.exitCode = 2;
    }
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
