import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { DATABASE_ENTITIES } from './database-entities';

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_POOL_SIZE = 10;
const DEFAULT_KEEP_ALIVE_INITIAL_DELAY_MS = 10_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

export const databaseOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number.parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'deadlock_builds',
  entities: DATABASE_ENTITIES,
  migrations: [`${__dirname}/migrations/*{.ts,.js}`],
  migrationsTransactionMode: 'all',
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  connectTimeoutMS: readPositiveIntegerEnvironmentValue(
    'DB_CONNECT_TIMEOUT_MS',
    DEFAULT_CONNECT_TIMEOUT_MS,
  ),
  poolSize: readPositiveIntegerEnvironmentValue(
    'DB_POOL_SIZE',
    DEFAULT_POOL_SIZE,
  ),
  poolErrorHandler: (error) => {
    console.warn(`[PostgresPool] ${error.message}`);
  },
  extra: {
    keepAlive: true,
    keepAliveInitialDelayMillis: readPositiveIntegerEnvironmentValue(
      'DB_KEEP_ALIVE_INITIAL_DELAY_MS',
      DEFAULT_KEEP_ALIVE_INITIAL_DELAY_MS,
    ),
    connectionTimeoutMillis: readPositiveIntegerEnvironmentValue(
      'DB_CONNECT_TIMEOUT_MS',
      DEFAULT_CONNECT_TIMEOUT_MS,
    ),
    idleTimeoutMillis: readPositiveIntegerEnvironmentValue(
      'DB_IDLE_TIMEOUT_MS',
      DEFAULT_IDLE_TIMEOUT_MS,
    ),
  },
};

export const AppDataSource = new DataSource(databaseOptions);

export default AppDataSource;

function readPositiveIntegerEnvironmentValue(
  name: string,
  defaultValue: number,
): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : defaultValue;
}
