// ---------------------------------------------------------------------------
// Migration runner — runs SQL migrations in order
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { env } from '../config/env.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const apiRoot = join(__dirname, '..', '..');
const MIGRATIONS_DIR = join(apiRoot, 'src', 'db', 'migrations');

const MIGRATION_FILES = [
  '001_auth_schema.sql',
  '002_otp_schema.sql',
  '003_users_birth_date.sql',
  '004_enhanced_profiles.sql',
  '005_user_extended_fields.sql',
  '006_pending_email.sql',
  '007_plans_expansion.sql',
  '008_wallet_transactions.sql',
  '009_services.sql',
  '010_deposit_requests.sql',
  '011_password_reset_tokens.sql',
  '012_chat.sql',
  '013_needs_bids.sql',
  '014_is_admin_and_plans_backfill.sql',
];

function parseArgs(): { from?: string } {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg.startsWith('--from=')) {
      const val = arg.slice(7);
      return val ? { from: val } : {};
    }
  }
  const fromIdx = args.indexOf('--from');
  if (fromIdx >= 0) {
    const val = args[fromIdx + 1];
    return typeof val === 'string' && val ? { from: val } : {};
  }
  return {};
}

async function runMigrations(): Promise<void> {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const { from } = parseArgs();
  const startFrom = from ? MIGRATION_FILES.findIndex((f) => f.startsWith(from)) : 0;
  if (from && startFrom < 0) {
    throw new Error(`Unknown migration: --from=${from}`);
  }
  const filesToRun = startFrom >= 0 ? MIGRATION_FILES.slice(startFrom) : MIGRATION_FILES;

  const pool = new Pool({ connectionString: env.DATABASE_URL });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows: applied } = await pool.query<{ name: string }>(
      'SELECT name FROM _migrations ORDER BY id',
    );
    const appliedSet = new Set(applied.map((r) => r.name.replace(/\.sql$/, '')));

    for (const file of filesToRun) {
      const name = file.replace(/\.sql$/, '');
      if (appliedSet.has(name)) {
        console.log(`[skip] ${file} (already applied)`);
        continue;
      }

      const path = join(MIGRATIONS_DIR, file);
      const sql = readFileSync(path, 'utf-8');

      console.log(`[run] ${file}`);
      await pool.query('BEGIN');
      try {
        await pool.query(sql);
        await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [name]);
        await pool.query('COMMIT');
      } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
      }
    }

    console.log('Migrations completed.');
  } finally {
    await pool.end();
  }
}

runMigrations().catch((err: unknown) => {
  console.error('Migration failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
