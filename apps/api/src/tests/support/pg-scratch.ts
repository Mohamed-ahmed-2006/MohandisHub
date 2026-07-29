// ---------------------------------------------------------------------------
// Disposable PostgreSQL database for money-path integration tests.
// ---------------------------------------------------------------------------
// The unit suites model PostgreSQL well enough to prove ordering and outcome,
// but a model can only be as right as the person who wrote it. Before a real
// consumer spends real credits through `chargeAction`, the claims have to hold
// against an actual server: actual FOR UPDATE blocking, actual MVCC visibility
// at READ COMMITTED, actual unique indexes, actual CHECK constraints.
//
// This creates a brand-new database, replays every migration into it, hands back
// a pool, and drops the database afterwards. It never reads or writes any
// existing database on the server, and it is opt-in:
//
//   RUN_PG_INTEGRATION=1 npm run test -w @mohandishub/api
//
// Without that flag the integration suites skip, so the default test run needs
// no database at all.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseEnv } from 'dotenv';
import { Client, Pool } from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, '../../../../../supabase/migrations');
const API_ENV_PATH = join(HERE, '../../../.env');

/** Opt-in flag. Integration suites skip entirely unless this is set. */
export const pgIntegrationEnabled = (): boolean =>
  process.env.RUN_PG_INTEGRATION === '1' && Boolean(adminUrl());

/**
 * Admin connection string for creating and dropping the scratch database.
 *
 * `vitest.config.ts` injects a placeholder DATABASE_URL into every test process
 * so unit suites never touch a real server, which means process.env cannot be
 * the source here. PG_INTEGRATION_URL wins so a developer can point the suite at
 * a purely local server; otherwise the value is read straight out of
 * apps/api/.env. Either way it is used ONLY to CREATE and DROP a scratch
 * database beside the existing ones — never to read or write them.
 */
const adminUrl = (): string | undefined => {
  if (process.env.PG_INTEGRATION_URL) return process.env.PG_INTEGRATION_URL;
  if (!existsSync(API_ENV_PATH)) return undefined;
  return parseEnv(readFileSync(API_ENV_PATH, 'utf8')).DATABASE_URL;
};

const urlFor = (databaseName: string): string => {
  const url = new URL(adminUrl()!);
  url.pathname = `/${databaseName}`;
  return url.toString();
};

export const migrationFiles = (): string[] =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

export const readMigration = (file: string): string =>
  readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

export type ScratchDatabase = {
  name: string;
  pool: Pool;
  /** Run arbitrary SQL against the scratch database on a fresh connection. */
  exec: (sql: string) => Promise<void>;
  drop: () => Promise<void>;
};

/**
 * Create a scratch database and replay the full migration chain into it.
 *
 * Replaying rather than templating is deliberate: it proves the repository can
 * build this schema from nothing, and it guarantees the test database contains
 * no row that came from anywhere else.
 */
export const createScratchDatabase = async (label: string): Promise<ScratchDatabase> => {
  const name = `mhc_it_${label}_${Date.now().toString(36)}`;
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const setup = new Client({ connectionString: urlFor(name) });
  await setup.connect();
  setup.on('notice', () => {});
  try {
    for (const ext of ['pgcrypto', 'uuid-ossp', 'btree_gist']) {
      await setup.query(`CREATE EXTENSION IF NOT EXISTS "${ext}"`).catch(() => {});
    }
    // Supabase manages `storage` outside these migrations; two of them reference
    // it. Same minimal stub the repository's replay checker uses.
    await setup.query(`CREATE SCHEMA IF NOT EXISTS storage`);
    await setup.query(`
      CREATE TABLE IF NOT EXISTS storage.buckets (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, public BOOLEAN NOT NULL DEFAULT false,
        file_size_limit BIGINT, allowed_mime_types TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS storage.objects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT REFERENCES storage.buckets(id),
        name TEXT, owner UUID, metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    `);
    for (const file of migrationFiles()) {
      await setup.query(readMigration(file));
    }
  } finally {
    await setup.end();
  }

  const pool = new Pool({ connectionString: urlFor(name), max: 16 });

  return {
    name,
    pool,
    exec: async (sql: string) => {
      const client = new Client({ connectionString: urlFor(name) });
      await client.connect();
      client.on('notice', () => {});
      try {
        await client.query(sql);
      } finally {
        await client.end();
      }
    },
    drop: async () => {
      await pool.end().catch(() => {});
      const dropper = new Client({ connectionString: adminUrl() });
      await dropper.connect();
      try {
        await dropper.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await dropper.end();
      }
    },
  };
};

/** A provider account with a credit wallet, created from nothing. */
export const seedProvider = async (
  pool: Pool,
  params: { role?: string; mhc?: number; frozen?: boolean },
): Promise<{ userId: string; walletId: string }> => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const { rows: planRows } = await pool.query<{ id: string }>(`SELECT id FROM plans LIMIT 1`);
  const planId = planRows[0]?.id;

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, display_name, primary_role${planId ? ', plan_id' : ''})
     VALUES ($1, 'x', $2, $3${planId ? ', $4' : ''})
     RETURNING id`,
    planId
      ? [`p-${suffix}@test.local`, `Provider ${suffix}`, params.role ?? 'expert', planId]
      : [`p-${suffix}@test.local`, `Provider ${suffix}`, params.role ?? 'expert'],
  );
  const userId = rows[0]!.id;

  const { rows: walletRows } = await pool.query<{ id: string }>(
    `INSERT INTO wallets (user_id, currency, account_type, asset_code, balance, is_frozen)
     VALUES ($1, 'EGP', 'provider_credit', 'MHC', $2, $3)
     RETURNING id`,
    [userId, params.mhc ?? 0, params.frozen ?? false],
  );
  return { userId, walletId: walletRows[0]!.id };
};

export const setActionPrice = async (
  pool: Pool,
  actionKey: string,
  price: number | null,
  isActive = true,
): Promise<void> => {
  if (price === null) {
    await pool.query(`DELETE FROM mhc_action_prices WHERE action_key = $1`, [actionKey]);
    return;
  }
  await pool.query(
    `INSERT INTO mhc_action_prices (action_key, name, mhc_price, is_active)
     VALUES ($1, $1, $2, $3)
     ON CONFLICT (action_key) DO UPDATE
       SET mhc_price = EXCLUDED.mhc_price, is_active = EXCLUDED.is_active`,
    [actionKey, price, isActive],
  );
};

export const balanceOf = async (pool: Pool, userId: string): Promise<number> => {
  const { rows } = await pool.query<{ balance: string }>(
    `SELECT balance::text FROM wallets WHERE user_id = $1 AND account_type = 'provider_credit'`,
    [userId],
  );
  return parseFloat(rows[0]?.balance ?? '0');
};

export const countRows = async (pool: Pool, sql: string, values: unknown[]): Promise<number> => {
  const { rows } = await pool.query<{ c: string }>(sql, values);
  return parseInt(rows[0]!.c, 10);
};
