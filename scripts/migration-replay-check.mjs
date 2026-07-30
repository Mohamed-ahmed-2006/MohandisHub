#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Clean-replay schema check.
// ---------------------------------------------------------------------------
// Proves that replaying every migration in supabase/migrations against an EMPTY
// database produces the same structure as the live database. This is the only
// real evidence that the repository can rebuild the schema — migration files can
// drift from a hand-maintained database without anything noticing.
//
//   node scripts/migration-replay-check.mjs            # replay + diff + drop
//   node scripts/migration-replay-check.mjs --keep     # leave scratch DB behind
//
// Creates a scratch database, replays into it, diffs, then drops it. The live
// database is only ever READ.
// ---------------------------------------------------------------------------
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertDroppableScratchName,
  dropScratchDatabase,
  findLeftoverScratchDatabases,
} from './lib/scratch-db.mjs';

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

const keep = process.argv.includes('--keep');
const SCRATCH_DB = `mhc_replay_${Date.now().toString(36)}`;

const urlFor = (dbName) => {
  const u = new URL(databaseUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
};

/**
 * Tables excluded from the structural comparison.
 *
 * `_migrations` and `public.schema_migrations` are dead bookkeeping tables left
 * by two custom migration runners this project used before adopting the Supabase
 * CLI (see 20260729110000_schema_reconciliation_from_live.sql). They exist in the
 * live database and are deliberately NOT recreated by any migration: they are
 * historical infrastructure, not application schema.
 */
const EXCLUDED_TABLES = ["'_migrations'", "'schema_migrations'"].join(', ');

/**
 * Structural fingerprint of a database: columns, constraints, and indexes for
 * every table in `public`. Deliberately excludes row data and anything
 * environment-specific.
 */
const SNAPSHOT_SQL = {
  columns: `
    SELECT table_name || '.' || column_name || ' :: ' || data_type
           || CASE WHEN is_nullable='NO' THEN ' NOT NULL' ELSE '' END
           || COALESCE(' DEFAULT ' || column_default, '') AS line
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name NOT IN (${EXCLUDED_TABLES})
    ORDER BY 1`,
  constraints: `
    SELECT c.conrelid::regclass::text || ' :: ' || c.conname || ' :: ' || pg_get_constraintdef(c.oid) AS line
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname='public' AND t.relname NOT IN (${EXCLUDED_TABLES})
    ORDER BY 1`,
  indexes: `
    SELECT tablename || ' :: ' || indexname || ' :: ' || indexdef AS line
    FROM pg_indexes WHERE schemaname='public' AND tablename NOT IN (${EXCLUDED_TABLES})
    ORDER BY 1`,
};

const snapshot = async (client) => {
  const out = {};
  for (const [key, sql] of Object.entries(SNAPSHOT_SQL)) {
    const { rows } = await client.query(sql);
    out[key] = rows.map((r) => r.line);
  }
  return out;
};

const diff = (label, live, replay) => {
  const liveSet = new Set(live);
  const replaySet = new Set(replay);
  const onlyLive = live.filter((x) => !replaySet.has(x));
  const onlyReplay = replay.filter((x) => !liveSet.has(x));
  if (onlyLive.length === 0 && onlyReplay.length === 0) {
    console.log(`  MATCH  ${label} (${live.length} entries)`);
    return true;
  }
  console.log(`  DIFF   ${label}: ${onlyLive.length} only-live, ${onlyReplay.length} only-replay`);
  for (const x of onlyLive.slice(0, 25)) console.log(`    - live only : ${x}`);
  for (const x of onlyReplay.slice(0, 25)) console.log(`    + replay only: ${x}`);
  if (onlyLive.length > 25 || onlyReplay.length > 25) console.log('    ... truncated');
  return false;
};

const admin = new Client({ connectionString: databaseUrl });
await admin.connect();

let scratch = null;
/** True once CREATE DATABASE succeeded, so cleanup runs even if connecting fails. */
let created = false;
let ok = true;
try {
  // Guarded before it exists, so a malformed name can never reach the DROP in
  // `finally` — and so this script can never be pointed at a real database.
  assertDroppableScratchName(SCRATCH_DB);
  console.log(`Creating scratch database ${SCRATCH_DB} ...`);
  await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
  created = true;

  scratch = new Client({ connectionString: urlFor(SCRATCH_DB) });
  await scratch.connect();
  scratch.on('notice', () => {});

  // Extensions the migrations assume are present in a Supabase project.
  for (const ext of ['pgcrypto', 'uuid-ossp', 'btree_gist']) {
    await scratch.query(`CREATE EXTENSION IF NOT EXISTS "${ext}"`).catch(() => {});
  }

  // Supabase manages `storage` outside our migrations, but two of them reference
  // storage.buckets/objects. A plain scratch database has no such schema, so we
  // stub the minimum shape those migrations touch. This is scaffolding for the
  // replay only — it is never applied to a real database.
  await scratch.query(`CREATE SCHEMA IF NOT EXISTS storage`);
  await scratch.query(`
    CREATE TABLE IF NOT EXISTS storage.buckets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      public BOOLEAN NOT NULL DEFAULT false,
      file_size_limit BIGINT,
      allowed_mime_types TEXT[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS storage.objects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id TEXT REFERENCES storage.buckets(id),
      name TEXT,
      owner UUID,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  console.log(`Replaying ${files.length} migrations into an empty database ...\n`);
  const failures = [];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await scratch.query(sql);
    } catch (e) {
      failures.push({ file, message: e.message });
      console.log(`  FAIL  ${file}\n        ${e.message}`);
    }
  }

  if (failures.length === 0) {
    console.log(`  All ${files.length} migrations replayed without error.`);
  } else {
    ok = false;
    console.log(`\n  ${failures.length} migration(s) failed to replay.`);
  }

  console.log('\nComparing structure (live vs clean replay):');
  const live = await snapshot(admin);
  const replayed = await snapshot(scratch);
  for (const key of Object.keys(SNAPSHOT_SQL)) {
    if (!diff(key, live[key], replayed[key])) ok = false;
  }
} catch (e) {
  ok = false;
  console.error(`\nERROR: ${e.message}`);
} finally {
  // Cleanup runs from `finally`, so it happens identically after a pass, a diff,
  // a failed replay and an unexpected throw.
  //
  // Order is load-bearing: every client that could hold a session on the scratch
  // database is closed BEFORE the drop, and the drop itself uses WITH (FORCE)
  // rather than terminate-then-drop, which raced a reconnecting pooler and
  // leaked the database on every retry.
  if (scratch) await scratch.end().catch(() => {});

  if (keep) {
    console.log(`\nScratch database ${SCRATCH_DB} retained (--keep).`);
  } else if (scratch || created) {
    console.log(`\nDropping scratch database ${SCRATCH_DB} ...`);
    const dropped = await dropScratchDatabase(admin, SCRATCH_DB, {
      log: (line) => console.error(line),
    });
    if (dropped) {
      console.log('  dropped.');
    } else {
      // A leaked scratch database is a failure of this script, not a warning.
      // It previously left `ok` untouched, so a run whose comparison matched
      // could exit 0 having abandoned a database on the server.
      ok = false;
      console.error(`  FAILED to drop ${SCRATCH_DB} — it is still on the server.`);
    }
  }

  // The proof, not the intention: ask the server what is actually left.
  if (!keep) {
    try {
      const leftovers = await findLeftoverScratchDatabases(admin);
      if (leftovers.length === 0) {
        console.log('  verified: no mhc_replay_* or mhc_it_* database remains.');
      } else {
        ok = false;
        console.error(`  LEAKED scratch databases still present: ${leftovers.join(', ')}`);
        // Not auto-dropped: one of these may belong to a run still using it, and
        // destroying another process's working state is worse than reporting it.
        console.error('  Drop them manually once you have confirmed nothing is using them.');
      }
    } catch (e) {
      ok = false;
      console.error(`  could not verify scratch cleanup: ${e.message}`);
    }
  }

  await admin.end().catch(() => {});
}

console.log(ok ? '\nREPLAY CHECK PASSED' : '\nREPLAY CHECK FAILED');
process.exit(ok ? 0 : 1);
