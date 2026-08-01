#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Apply pending migrations and record them in the Supabase tracking table.
// ---------------------------------------------------------------------------
// The Supabase CLI is not installed in this environment, so this applies
// migrations directly. Each migration runs in its OWN transaction together with
// its tracking-table insert, so a migration can never be recorded as applied
// unless it actually succeeded, and vice versa.
//
// The full migration text is stored in schema_migrations.statements. That column
// is what made recovering this project's seven lost migrations possible, so it is
// deliberately populated rather than left empty.
//
//   CONFIRM_APPLY=yes node scripts/migrate-apply.mjs
//
// Refuses to run without the confirmation variable, and refuses outright if the
// database URL looks like production.
// ---------------------------------------------------------------------------
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const require = createRequire(path.join(ROOT, 'apps', 'api', 'package.json'));
const { Client } = require('pg');
const dotenv = require('dotenv');

const ENV_PATH = path.join(ROOT, 'apps', 'api', '.env');
if (fs.existsSync(ENV_PATH)) dotenv.config({ path: ENV_PATH });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

if (/\bprod(uction)?\b/i.test(databaseUrl)) {
  console.error('Refusing to run: DATABASE_URL looks like production.');
  process.exit(1);
}

if (process.env.CONFIRM_APPLY !== 'yes') {
  console.error('Refusing to run without CONFIRM_APPLY=yes.');
  console.error(
    'Take a backup (scripts/db-backup.mjs) and dry run first (scripts/migration-dryrun.mjs).',
  );
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
client.on('notice', (n) => console.log(`    [db] ${n.message}`));

const { rows: appliedRows } = await client.query(
  `SELECT version FROM supabase_migrations.schema_migrations`,
);
const applied = new Set(appliedRows.map((r) => r.version));

const pending = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => !applied.has(f.split('_')[0]));

if (pending.length === 0) {
  console.log('Nothing pending.');
  await client.end();
  process.exit(0);
}

console.log(`Applying ${pending.length} migration(s):\n`);

let ok = true;
for (const file of pending) {
  const version = file.split('_')[0];
  const name = file.replace(/^\d+_/, '').replace(/\.sql$/, '');
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

  process.stdout.write(`-> ${file}\n`);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
       VALUES ($1, $2, $3)
       ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name, statements = EXCLUDED.statements`,
      [version, name, [sql]],
    );
    await client.query('COMMIT');
    console.log('   APPLIED\n');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    ok = false;
    console.error(`   FAILED: ${e.message}\n`);
    console.error('Stopping. This migration was rolled back and NOT recorded.');
    break;
  }
}

await client.end();
console.log(ok ? 'ALL MIGRATIONS APPLIED' : 'MIGRATION RUN FAILED');
process.exit(ok ? 0 : 1);
