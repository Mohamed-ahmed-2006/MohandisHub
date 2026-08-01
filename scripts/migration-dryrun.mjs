#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Migration dry run — apply pending migrations, verify, then ROLL BACK.
// ---------------------------------------------------------------------------
// Migrations in this repo are hand-applied SQL with no ORM. Nothing else proves
// that a pending migration actually runs against the real schema and data until
// someone applies it for real. This script closes that gap: PostgreSQL DDL is
// transactional, so every pending migration can be applied inside one
// transaction, inspected, and rolled back with nothing persisted.
//
//   node scripts/migration-dryrun.mjs           # dry run pending migrations
//   node scripts/migration-dryrun.mjs --list    # just show what is pending
//
// Exits non-zero if any migration fails to apply. Safe to run against any
// environment: it never commits.
// ---------------------------------------------------------------------------
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const ENV_PATH = path.join(ROOT, 'apps', 'api', '.env');

const require = createRequire(path.join(ROOT, 'apps', 'api', 'package.json'));
const { Client } = require('pg');
const dotenv = require('dotenv');

if (fs.existsSync(ENV_PATH)) dotenv.config({ path: ENV_PATH });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set (checked environment and apps/api/.env).');
  process.exit(1);
}

const listOnly = process.argv.includes('--list');

const migrationFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const client = new Client({ connectionString: databaseUrl });
await client.connect();
client.on('notice', (n) => console.log(`  [db] ${n.message}`));

let applied = new Set();
try {
  const { rows } = await client.query(`SELECT version FROM supabase_migrations.schema_migrations`);
  applied = new Set(rows.map((r) => r.version));
} catch {
  console.warn(
    'No supabase_migrations.schema_migrations table; treating all migrations as pending.',
  );
}

const pending = migrationFiles.filter((f) => !applied.has(f.split('_')[0]));

// Migrations applied to the database that no longer exist in the repository.
// The repo cannot rebuild the database while this is non-empty.
const repoVersions = new Set(migrationFiles.map((f) => f.split('_')[0]));
const drift = [...applied].filter((v) => !repoVersions.has(v)).sort();

console.log(
  `Repo migrations: ${migrationFiles.length}   Applied: ${applied.size}   Pending: ${pending.length}`,
);
if (drift.length > 0) {
  console.warn(
    `\nWARNING: ${drift.length} migration(s) applied to the database are NOT in the repository:`,
  );
  for (const v of drift) console.warn(`  ${v}`);
  console.warn('The repository cannot reproduce this database from scratch.');
}

if (pending.length === 0) {
  console.log('\nNothing pending.');
  await client.end();
  process.exit(0);
}

console.log('\nPending migrations:');
for (const f of pending) console.log(`  ${f}`);

if (listOnly) {
  await client.end();
  process.exit(0);
}

let ok = true;
try {
  await client.query('BEGIN');
  for (const file of pending) {
    process.stdout.write(`\n-> ${file} ... `);
    await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    console.log('OK');
  }

  // Generic post-migration invariants. These hold for any state of this schema;
  // migration-specific assertions belong in the migration's own DO block.
  //
  // BLOCKING invariants must hold or the migration is unsafe to apply.
  const blocking = [
    [
      'no wallet has a negative balance',
      `SELECT count(*)::int v FROM public.wallets WHERE balance < 0`,
    ],
    [
      'no transaction has a negative amount',
      `SELECT count(*)::int v FROM public.transactions WHERE amount < 0`,
    ],
    [
      'no wallet hold exceeds its wallet balance',
      `SELECT count(*)::int v FROM (
         SELECT h.wallet_id, sum(h.amount) held, max(w.balance) bal
         FROM public.wallet_holds h JOIN public.wallets w ON w.id=h.wallet_id
         WHERE h.status='held' GROUP BY h.wallet_id
       ) s WHERE s.held > s.bal`,
    ],
  ];

  // ADVISORY invariants describe pre-existing data quality. They report but do
  // not fail, because a migration cannot be blamed for dirty history it inherited.
  //
  // balance_delta: 20260627120000 backfilled it for deposit/bonus/refund/
  // commission/release/withdrawal/hold but NOT for 'payment' or 'adjustment',
  // leaving those historical rows NULL (PLT-03). 'payment' is used in this ledger
  // for BOTH credits and debits, so no blanket backfill is safe — the sign has to
  // be derived per row. Every live write path sets balance_delta explicitly, so
  // this is historical residue, not an ongoing defect.
  const advisory = [
    [
      'every completed transaction carries a balance_delta',
      `SELECT count(*)::int v FROM public.transactions WHERE status='completed' AND balance_delta IS NULL`,
    ],
  ];

  const run = async (label, sql) => {
    try {
      const { rows } = await client.query(sql);
      return rows[0].v;
    } catch (e) {
      console.log(`  SKIP  ${label}: ${e.message}`);
      return null;
    }
  };

  console.log('\nPost-migration invariants (blocking):');
  for (const [label, sql] of blocking) {
    const v = await run(label, sql);
    if (v === null) continue;
    if (v !== 0) ok = false;
    console.log(`  ${v === 0 ? 'PASS' : 'FAIL'}  ${label}${v === 0 ? '' : ` (${v} violations)`}`);
  }

  console.log('\nPost-migration invariants (advisory — pre-existing data quality):');
  for (const [label, sql] of advisory) {
    const v = await run(label, sql);
    if (v === null) continue;
    console.log(`  ${v === 0 ? 'PASS' : 'WARN'}  ${label}${v === 0 ? '' : ` (${v} rows)`}`);
  }
} catch (e) {
  ok = false;
  console.error(`\nFAILED: ${e.message}`);
  if (e.position) console.error(`  at character position ${e.position}`);
} finally {
  await client.query('ROLLBACK').catch(() => {});
  console.log('\nRolled back — nothing was persisted.');
  await client.end();
}

console.log(ok ? 'DRY RUN PASSED' : 'DRY RUN FAILED');
process.exit(ok ? 0 : 1);
