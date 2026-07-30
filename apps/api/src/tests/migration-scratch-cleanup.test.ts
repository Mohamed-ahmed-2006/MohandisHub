import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parse as parseEnv } from 'dotenv';
import { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { pgIntegrationEnabled } from './support/pg-scratch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(HERE, '../../../../scripts');

/** The shape `scripts/lib/scratch-db.mjs` exports. */
type ScratchDbModule = {
  SCRATCH_DB_PATTERN: RegExp;
  PROTECTED_DATABASE_NAMES: Set<string>;
  assertDroppableScratchName: (name: string) => string;
  dropScratchDatabase: (
    admin: unknown,
    name: string,
    options?: { attempts?: number; log?: (line: string) => void },
  ) => Promise<boolean>;
  findLeftoverScratchDatabases: (admin: unknown) => Promise<string[]>;
};

/**
 * Loaded at RUNTIME rather than imported.
 *
 * `scripts/` sits outside the API's `rootDir`, so a static import would pull a
 * file into the compiler's program that its emit build cannot place in `dist`.
 * A runtime specifier keeps the script exactly where it belongs — plain ESM run
 * by node — while still testing the real module rather than a copy of it.
 */
const {
  PROTECTED_DATABASE_NAMES,
  SCRATCH_DB_PATTERN,
  assertDroppableScratchName,
  dropScratchDatabase,
  findLeftoverScratchDatabases,
} = (await import(pathToFileURL(join(SCRIPTS_DIR, 'lib/scratch-db.mjs')).href)) as ScratchDbModule;

const readReplayScript = (): string =>
  readFileSync(join(SCRIPTS_DIR, 'migration-replay-check.mjs'), 'utf8');

const readApiEnvDatabaseUrl = (): string => {
  const envPath = join(HERE, '../../.env');
  if (!existsSync(envPath)) return '';
  return parseEnv(readFileSync(envPath, 'utf8')).DATABASE_URL ?? '';
};

// ---------------------------------------------------------------------------
// Scratch database cleanup.
// ---------------------------------------------------------------------------
// `migration-replay-check.mjs` leaked its scratch database twice in a row. Two
// defects, one visible and one not:
//
//   1. it ran `pg_terminate_backend` and then a plain `DROP DATABASE`. Any
//      connection appearing between the two failed the drop — and because the
//      race repeats, it failed on all five retries;
//   2. a failed drop left the script's `ok` flag untouched. A run whose schema
//      comparison MATCHED could therefore exit 0 having abandoned a database on
//      the server, which is how a leak goes unnoticed.
//
// The first is fixed by `DROP DATABASE ... WITH (FORCE)`, which terminates and
// drops in one statement. The second is fixed by failing the run. Both are
// asserted below, the first against a real server with a deliberately lingering
// connection — the exact condition that produced the leak.
// ---------------------------------------------------------------------------

vi.setConfig({ testTimeout: 180_000, hookTimeout: 600_000 });

/** Records statements instead of executing them. */
const fakeAdmin = (behaviour: (sql: string) => void = () => {}) => {
  const statements: string[] = [];
  return {
    statements,
    query: vi.fn((sql: string) => {
      statements.push(sql.trim());
      behaviour(sql);
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
  };
};

describe('only a uniquely named scratch database may be dropped', () => {
  it('refuses every protected database name', () => {
    for (const name of PROTECTED_DATABASE_NAMES) {
      expect(() => assertDroppableScratchName(name)).toThrow(/Refusing/);
    }
    // The one that matters most, stated on its own so it cannot be lost in a loop.
    expect(() => assertDroppableScratchName('postgres')).toThrow(/protected database "postgres"/);
  });

  it('refuses anything that is not a scratch name', () => {
    for (const name of [
      '',
      'mohandishub',
      'MHC_REPLAY_ABC',
      'mhc_replay',
      'replay_abc',
      'mhc_other_abc',
      ' mhc_replay_abc',
      'mhc_replay_abc ',
    ]) {
      expect(() => assertDroppableScratchName(name)).toThrow(/Refusing/);
    }
    expect(() => assertDroppableScratchName(undefined as never)).toThrow(/no name/);
  });

  it('refuses a name carrying SQL punctuation, which cannot be parameterised', () => {
    // `DROP DATABASE` takes no bind parameters, so the name is interpolated.
    // The pattern is what keeps that safe.
    for (const name of [
      'mhc_replay_a"b',
      'mhc_replay_a;DROP DATABASE postgres',
      'mhc_replay_a--',
      'mhc_replay_a b',
      'mhc_replay_a)',
    ]) {
      expect(() => assertDroppableScratchName(name)).toThrow(/Refusing/);
      expect(SCRATCH_DB_PATTERN.test(name)).toBe(false);
    }
  });

  it('accepts the names the two harnesses actually generate', () => {
    expect(assertDroppableScratchName('mhc_replay_ms7j3yy0')).toBe('mhc_replay_ms7j3yy0');
    expect(assertDroppableScratchName('mhc_it_adsweekly_ms7i8b7o')).toBe(
      'mhc_it_adsweekly_ms7i8b7o',
    );
  });

  it('issues no SQL at all for a refused name', async () => {
    const admin = fakeAdmin();
    await expect(dropScratchDatabase(admin as never, 'postgres')).rejects.toThrow(/Refusing/);
    // Not "did not drop it" — did not TALK to the server about it.
    expect(admin.statements).toEqual([]);
  });
});

describe('the drop is forced, retried, and reported', () => {
  it('drops with FORCE in a single statement', async () => {
    const admin = fakeAdmin();
    const dropped = await dropScratchDatabase(admin as never, 'mhc_replay_abc123');

    expect(dropped).toBe(true);
    expect(admin.statements).toEqual(['DROP DATABASE IF EXISTS mhc_replay_abc123 WITH (FORCE)']);
    // The retired shape: terminate first, then a plain drop, which is what raced.
    expect(admin.statements.some((s) => s.includes('pg_terminate_backend'))).toBe(false);
  });

  it('terminates by name and retries when a drop fails', async () => {
    let calls = 0;
    const admin = fakeAdmin((sql) => {
      if (sql.includes('DROP DATABASE')) {
        calls += 1;
        if (calls === 1) throw new Error('database "mhc_replay_abc123" is being accessed');
      }
    });

    const dropped = await dropScratchDatabase(admin as never, 'mhc_replay_abc123');

    expect(dropped).toBe(true);
    const terminate = admin.statements.find((s) => s.includes('pg_terminate_backend'));
    expect(terminate).toBeDefined();
    // Scoped to one database by name, and never to this session.
    expect(terminate).toContain('WHERE datname = $1');
    expect(terminate).toContain('pid <> pg_backend_pid()');
  });

  it('reports failure rather than throwing, so the caller can fail the run', async () => {
    const admin = fakeAdmin((sql) => {
      if (sql.includes('DROP DATABASE')) throw new Error('still in use');
    });

    const logged: string[] = [];
    const dropped = await dropScratchDatabase(admin as never, 'mhc_replay_abc123', {
      attempts: 2,
      log: (line: string) => logged.push(line),
    });

    expect(dropped).toBe(false);
    expect(logged.length).toBeGreaterThan(0);
  });
});

describe('the replay script fails the run when cleanup fails', () => {
  it('treats a leaked scratch database as a failure, not a warning', () => {
    // Asserted against the script's source: the previous version logged the
    // failure and left `ok` alone, so a matching comparison exited 0 with a
    // database abandoned on the server.
    const source = readReplayScript();

    const finallyBlock = source.slice(source.lastIndexOf('} finally {'));
    expect(finallyBlock).toContain('dropScratchDatabase');
    expect(finallyBlock).toContain('findLeftoverScratchDatabases');
    // Cleanup failure and leak detection both fail the run.
    expect(finallyBlock).toMatch(/if \(dropped\) \{[\s\S]*?\} else \{[\s\S]*?ok = false;/);
    expect(finallyBlock).toMatch(/leftovers\.length === 0[\s\S]*?\} else \{[\s\S]*?ok = false;/);
    // The scratch client is closed before anything is dropped.
    expect(finallyBlock.indexOf('scratch.end()')).toBeLessThan(
      finallyBlock.indexOf('dropScratchDatabase'),
    );
    // And the exit code still follows `ok`.
    expect(source).toContain('process.exit(ok ? 0 : 1)');
  });

  it('guards the scratch name before the database is created', () => {
    const source = readReplayScript();
    expect(source).toContain('assertDroppableScratchName(SCRATCH_DB)');
    // Compared against the executable statement, not the first mention of the
    // words — a comment must not be able to satisfy an ordering assertion.
    const createStatement = 'await admin.query(`CREATE DATABASE';
    expect(source).toContain(createStatement);
    expect(source.indexOf('assertDroppableScratchName(SCRATCH_DB)')).toBeLessThan(
      source.indexOf(createStatement),
    );
  });

  it('does not weaken the comparison to make the run pass', () => {
    const source = readReplayScript();
    // only-live and only-replay are both still computed and both still fail.
    expect(source).toContain('const onlyLive = live.filter');
    expect(source).toContain('const onlyReplay = replay.filter');
    expect(source).toMatch(/if \(!diff\(key, live\[key\], replayed\[key\]\)\) ok = false;/);
  });
});

// ---------------------------------------------------------------------------
// Executable verification against a real server.
// ---------------------------------------------------------------------------

describe.skipIf(!pgIntegrationEnabled())('cleanup against a real PostgreSQL server', () => {
  const adminUrl = (): string => process.env.PG_INTEGRATION_URL ?? readApiEnvDatabaseUrl();
  const urlFor = (db: string): string => {
    const url = new URL(adminUrl());
    url.pathname = `/${db}`;
    return url.toString();
  };

  it('drops a scratch database that still has a live connection to it', async () => {
    const name = `mhc_it_cleanup_${Date.now().toString(36)}`;
    const admin = new Client({ connectionString: adminUrl() });
    await admin.connect();

    let lingering: Client | null = null;
    try {
      await admin.query(`CREATE DATABASE ${name}`);

      // The exact condition that leaked the database twice: a session still
      // attached when the drop runs. The old terminate-then-drop lost this race.
      lingering = new Client({ connectionString: urlFor(name) });
      await lingering.connect();
      // FORCE terminates this session, and pg surfaces that as a client 'error'
      // event. Expected here — swallow it so it is not reported as an unhandled
      // error by a test whose whole point is that the session gets killed.
      lingering.on('error', () => {});
      await lingering.query('SELECT 1');

      const dropped = await dropScratchDatabase(admin as never, name);
      expect(dropped).toBe(true);

      const { rows } = await admin.query<{ c: string }>(
        `SELECT count(*)::text c FROM pg_database WHERE datname = $1`,
        [name],
      );
      expect(rows[0]!.c).toBe('0');
    } finally {
      // FORCE already killed it; ending a dead client must not fail the test.
      await lingering?.end().catch(() => {});
      await dropScratchDatabase(admin as never, name).catch(() => {});
      await admin.end().catch(() => {});
    }
  });

  it('detects a leaked scratch database and stops reporting it once dropped', async () => {
    // Deliberately NOT "no scratch database exists anywhere": this suite runs
    // alongside others that legitimately create mhc_it_* databases, so a global
    // emptiness assertion measures the other suites rather than the detector.
    // The end-to-end "zero temporary databases remain" check belongs to the
    // validation run, once everything has finished.
    const name = `mhc_it_leakprobe_${Date.now().toString(36)}`;
    const admin = new Client({ connectionString: adminUrl() });
    await admin.connect();

    try {
      await admin.query(`CREATE DATABASE ${name}`);

      const withLeak = await findLeftoverScratchDatabases(admin as never);
      expect(withLeak).toContain(name);
      // Every name reported is one this module would be willing to drop, which
      // is what makes the report actionable rather than merely advisory.
      for (const reported of withLeak) {
        expect(() => assertDroppableScratchName(reported)).not.toThrow();
      }

      expect(await dropScratchDatabase(admin as never, name)).toBe(true);
      expect(await findLeftoverScratchDatabases(admin as never)).not.toContain(name);
    } finally {
      await dropScratchDatabase(admin as never, name).catch(() => {});
      await admin.end().catch(() => {});
    }
  });
});
