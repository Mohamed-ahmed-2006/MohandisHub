// ---------------------------------------------------------------------------
// Scratch database lifecycle — creation guards, forced drop, leak detection.
// ---------------------------------------------------------------------------
// Shared by the migration replay checker and covered by
// apps/api/src/tests/migration-scratch-cleanup.test.ts.
//
// Two properties matter here, and they pull in opposite directions:
//
//   * cleanup must be RELENTLESS — a leaked scratch database accumulates on a
//     real server and eventually costs money or hits a quota;
//   * cleanup must be NARROW — `DROP DATABASE` is unrecoverable, and the same
//     admin connection that drops a scratch database could drop production.
//
// Everything below resolves that by making the NAME the gate: nothing is
// terminated or dropped unless its name matches a scratch pattern, and the
// check is a hard throw rather than a skip.
// ---------------------------------------------------------------------------

/**
 * The only database names this module will ever terminate or drop.
 *
 * `mhc_replay_` is the replay checker's prefix; `mhc_it_` is the integration
 * suites' (see apps/api/src/tests/support/pg-scratch.ts). Both are followed by a
 * label and a base-36 timestamp, so the name is unique per run.
 *
 * Anchored, and restricted to lowercase/digits/underscore — which also means no
 * name reaching `DROP DATABASE` can carry a quote, a semicolon or whitespace.
 */
export const SCRATCH_DB_PATTERN = /^mhc_(replay|it)_[a-z0-9_]+$/;

/** Never droppable, whatever else matches. Belt to the pattern's braces. */
export const PROTECTED_DATABASE_NAMES = new Set([
  'postgres',
  'production',
  'prod',
  'main',
  'template0',
  'template1',
  'supabase_admin',
]);

/**
 * Throw unless `name` is a scratch database this module may destroy.
 *
 * Deliberately a throw and not a boolean: a caller that forgets to check gets a
 * crash, not a silent no-op that leaves the database behind — and a caller that
 * passes the wrong name gets a crash instead of dropping production.
 */
export const assertDroppableScratchName = (name) => {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Refusing to target a database with no name.');
  }
  if (PROTECTED_DATABASE_NAMES.has(name)) {
    throw new Error(`Refusing to terminate or drop protected database "${name}".`);
  }
  if (!SCRATCH_DB_PATTERN.test(name)) {
    throw new Error(
      `Refusing to terminate or drop "${name}": not a scratch database name (${SCRATCH_DB_PATTERN}).`,
    );
  }
  return name;
};

/**
 * Drop one scratch database, forcibly.
 *
 * `WITH (FORCE)` (PostgreSQL 13+) terminates the remaining backends and drops
 * the database in ONE statement. That is the whole fix for the leak this
 * replaces: the previous code ran `pg_terminate_backend` and then a plain
 * `DROP DATABASE`, so any connection that reappeared in between — a pooler
 * reconnecting, a client still finishing its teardown — failed the drop, and it
 * failed on all five retries because the race repeats every time.
 *
 * `pg_terminate_backend` is still issued first as a courtesy on retries, scoped
 * to this database by name, so a server that rejects FORCE still gets a chance.
 *
 * Returns true when the database is gone. Never throws for an in-use database;
 * the caller decides whether that is fatal (it is).
 */
export const dropScratchDatabase = async (admin, name, { attempts = 5, log = () => {} } = {}) => {
  assertDroppableScratchName(name);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      return true;
    } catch (error) {
      log(`  drop attempt ${attempt}/${attempts} failed: ${error.message}`);
      if (attempt === attempts) return false;
      // Scoped by name, and only ever to a name that passed the guard above.
      await admin
        .query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
            WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [name],
        )
        .catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  return false;
};

/**
 * Every scratch database still on the server.
 *
 * The proof that cleanup worked. Reported rather than auto-dropped: a database
 * left by a DIFFERENT run may still be in use by it, and destroying another
 * process's working state is worse than reporting a leak.
 */
export const findLeftoverScratchDatabases = async (admin) => {
  const { rows } = await admin.query(
    `SELECT datname FROM pg_database
      WHERE datname LIKE 'mhc_replay\\_%' OR datname LIKE 'mhc\\_it\\_%'
      ORDER BY datname`,
  );
  return rows.map((row) => row.datname).filter((name) => SCRATCH_DB_PATTERN.test(name));
};
