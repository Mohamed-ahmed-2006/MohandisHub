/**
 * Run database migrations in order.
 * Usage: from repo root: npm run migrate -w @mohandishub/api
 *        or from apps/api: npm run migrate
 * Requires: DATABASE_URL in apps/api/.env
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { Pool } from 'pg';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

loadEnv({ path: join(__dirname, '../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Create apps/api/.env from apps/api/.env.example and set DATABASE_URL.');
  process.exit(1);
}

const MIGRATIONS_DIR = join(__dirname, 'migrations');

const migrationFiles = [
  '001_auth_schema.sql',
  '002_otp_schema.sql',
  '003_users_birth_date.sql',
  '004_enhanced_profiles.sql',
  '005_plans.sql',
  '006_future_proof_fields.sql',
];

async function run(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY
      )
    `);

    const { rows: applied } = await pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations',
    );
    const appliedSet = new Set(applied.map((r) => r.version));

    for (const file of migrationFiles) {
      const version = file.replace(/\.sql$/, '');
      if (appliedSet.has(version)) {
        console.log('Skip (already applied):', file);
        continue;
      }

      const path = join(MIGRATIONS_DIR, file);
      const sql = readFileSync(path, 'utf-8');

      console.log('Running:', file);
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      console.log('Done:', file);
    }

    console.log('Migrations finished.');
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
