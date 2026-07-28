#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Logical database backup.
// ---------------------------------------------------------------------------
// pg_dump is not available in this environment, so this takes a logical export
// instead: every row of every public table as JSON, plus a manifest.
//
// Restorability rests on two halves:
//   * SCHEMA  — reproduced by replaying supabase/migrations. That is not an
//               assumption: scripts/migration-replay-check.mjs proves a clean
//               replay matches the live structure.
//   * DATA    — this export.
//
// It also attempts a server-side `CREATE DATABASE ... TEMPLATE` snapshot, which
// is a far better restore path when it works. That requires no other sessions on
// the source database, so it usually fails on a pooled/shared connection; the
// JSON export is the reliable fallback.
//
//   node scripts/db-backup.mjs
//
// Output goes to .backups/<timestamp>/ which is gitignored — it contains real
// user data and must never be committed.
// ---------------------------------------------------------------------------
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(ROOT, '.backups', stamp);
fs.mkdirSync(outDir, { recursive: true });

const client = new Client({ connectionString: databaseUrl });
await client.connect();

const { rows: tables } = await client.query(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema='public' AND table_type='BASE TABLE'
   ORDER BY table_name`,
);

console.log(`Backing up ${tables.length} tables to ${outDir}\n`);

const manifest = { takenAt: new Date().toISOString(), tables: {}, totalRows: 0 };

for (const { table_name: table } of tables) {
  try {
    const { rows } = await client.query(`SELECT * FROM public."${table}"`);
    fs.writeFileSync(
      path.join(outDir, `${table}.json`),
      JSON.stringify(rows, null, 2),
      'utf8',
    );
    manifest.tables[table] = rows.length;
    manifest.totalRows += rows.length;
    if (rows.length > 0) console.log(`  ${String(rows.length).padStart(6)}  ${table}`);
  } catch (e) {
    manifest.tables[table] = `ERROR: ${e.message}`;
    console.error(`  ERROR  ${table}: ${e.message}`);
  }
}

// Structural snapshot, so a restore can be verified against what was backed up.
for (const [name, sql] of [
  [
    'columns',
    `SELECT table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema='public'
     ORDER BY table_name, ordinal_position`,
  ],
  [
    'constraints',
    `SELECT c.conrelid::regclass::text AS table_name, c.conname, pg_get_constraintdef(c.oid) AS def
     FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
     JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'
     ORDER BY 1,2`,
  ],
  ['indexes', `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2`],
  [
    'applied_migrations',
    `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version`,
  ],
]) {
  const { rows } = await client.query(sql);
  fs.writeFileSync(path.join(outDir, `_schema_${name}.json`), JSON.stringify(rows, null, 2), 'utf8');
}

// Best-effort server-side snapshot. Cheap to try, far better restore when it works.
const snapshotName = `mhc_backup_${stamp.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 24)}`;
let snapshot = null;
try {
  await client.query(`CREATE DATABASE ${snapshotName} TEMPLATE postgres`);
  snapshot = snapshotName;
  console.log(`\nServer-side snapshot database created: ${snapshotName}`);
} catch (e) {
  console.log(`\nServer-side snapshot not available (${e.message.split('\n')[0]}).`);
  console.log('JSON export is the restore path.');
}

manifest.snapshotDatabase = snapshot;
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log(`\nBacked up ${manifest.totalRows} rows across ${tables.length} tables.`);
console.log(`Location: ${outDir}`);

await client.end();
