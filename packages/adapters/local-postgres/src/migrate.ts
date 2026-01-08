import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Client } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface MigrateConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * Run database migrations
 */
export async function migrate(config: MigrateConfig): Promise<void> {
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
  });

  try {
    await client.connect();

    // Read migration file
    const migrationPath = join(__dirname, '../../../../db/migrations/001_initial_schema.sql');
    const migration = readFileSync(migrationPath, 'utf-8');

    console.log('Running migration: 001_initial_schema.sql');
    await client.query(migration);
    console.log('Migration completed successfully');
  } finally {
    await client.end();
  }
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config: MigrateConfig = {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'mediasearch',
    user: process.env.POSTGRES_USER || 'mediasearch',
    password: process.env.POSTGRES_PASSWORD || 'mediasearch',
  };

  migrate(config)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
