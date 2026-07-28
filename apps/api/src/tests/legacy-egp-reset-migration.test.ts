import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Static invariants for the legacy EGP reset migration.
// ---------------------------------------------------------------------------
// Migrations here are hand-applied SQL with no ORM and no runner, so a bad edit
// is not caught by the compiler or by any integration test. This suite pins the
// properties that make the reset safe, so widening its blast radius later fails
// loudly instead of silently destroying data.
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

const RESET_MIGRATION = '20260729100000_legacy_egp_test_data_reset.sql';
const SCOPE_MIGRATION = '20260729090000_mhc_purchase_reference_scope.sql';

const readMigration = (name: string): string => readFileSync(join(MIGRATIONS_DIR, name), 'utf8');

/** Strip `--` line comments so prose about DELETE/DROP does not trip the scans. */
const stripComments = (sql: string): string =>
  sql
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');

/**
 * Split executable SQL into statements, ignoring semicolons inside `$$ ... $$`
 * blocks and inside single-quoted literals. Both occur in these migrations —
 * rejection_reason strings contain semicolons — so a naive split on ';' would
 * cut statements in half and make the scans below assert against fragments.
 */
const splitStatements = (sql: string): string[] => {
  const statements: string[] = [];
  let current = '';
  let inDollar = false;
  let inQuote = false;
  for (let i = 0; i < sql.length; i += 1) {
    if (!inQuote && sql.startsWith('$$', i)) {
      inDollar = !inDollar;
      current += '$$';
      i += 1;
      continue;
    }
    const ch = sql[i]!;
    if (!inDollar && ch === "'") {
      // '' inside a literal is an escaped quote, not a terminator.
      if (inQuote && sql[i + 1] === "'") {
        current += "''";
        i += 1;
        continue;
      }
      inQuote = !inQuote;
      current += ch;
      continue;
    }
    if (ch === ';' && !inDollar && !inQuote) {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
};

describe('legacy EGP reset migration — safety invariants', () => {
  const raw = readMigration(RESET_MIGRATION);
  const sql = stripComments(raw);
  const statements = splitStatements(sql);

  it('never deletes, drops, or truncates anything', () => {
    // The reset zeroes and cancels. It must not remove rows or objects: the
    // transaction history is the audit trail for what was reset.
    for (const statement of statements) {
      expect(statement).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(statement).not.toMatch(/\bTRUNCATE\b/i);
      expect(statement).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA)\b/i);
    }
  });

  it('scopes every wallet mutation to the legacy money account', () => {
    const walletUpdates = statements.filter((s) => /^UPDATE\s+public\.wallets\b/i.test(s));
    expect(walletUpdates.length).toBeGreaterThan(0);
    for (const statement of walletUpdates) {
      expect(statement).toMatch(/account_type\s*=\s*'money'/i);
    }
  });

  it('scopes every dependent-table mutation through a money wallet join', () => {
    // wallet_fund_balances and wallet_holds are keyed by wallet_id, so they can
    // only be narrowed by joining wallets and filtering on account_type.
    const dependentUpdates = statements.filter((s) =>
      /^UPDATE\s+public\.(wallet_fund_balances|wallet_holds)\b/i.test(s),
    );
    expect(dependentUpdates.length).toBe(2);
    for (const statement of dependentUpdates) {
      expect(statement).toMatch(/FROM\s+public\.wallets\s+w/i);
      expect(statement).toMatch(/w\.account_type\s*=\s*'money'/i);
    }
  });

  it('never touches MHC credit purchases', () => {
    const depositUpdates = statements.filter((s) => /^UPDATE\s+public\.deposit_requests\b/i.test(s));
    expect(depositUpdates.length).toBe(1);
    // Positively scoped to wallet_topup, which excludes credit_purchase rows.
    expect(depositUpdates[0]).toMatch(/purpose\s*=\s*'wallet_topup'/i);
    expect(depositUpdates[0]).not.toMatch(/credit_purchase/i);
  });

  it('writes an auditable ledger row for every balance it zeroes', () => {
    const inserts = statements.filter((s) => /INSERT\s+INTO\s+public\.transactions\b/i.test(s));
    expect(inserts).toHaveLength(1);
    const insert = inserts[0]!;
    expect(insert).toMatch(/'adjustment'/);
    expect(insert).toMatch(/'legacy_egp_reset'/);
    // Positive amount with the sign carried by balance_delta, matching every
    // other debit in this ledger and satisfying chk_transactions_amount_nonnegative.
    expect(insert).toMatch(/-w\.balance/);
    // Idempotent: re-running must not write a second reset row per wallet.
    expect(insert).toMatch(/NOT\s+EXISTS/i);
  });

  it('zeroes the funding-source sub-ledger, not just the wallet balance', () => {
    // Zeroing wallets.balance alone would leave wallet_fund_balances permanently
    // contradicting it — the two already disagree in the current data.
    expect(sql).toMatch(/UPDATE\s+public\.wallet_fund_balances/i);
  });

  it('asserts its own end state and fails loudly', () => {
    expect(sql).toMatch(/RAISE\s+EXCEPTION/i);
    for (const invariant of [
      /money wallet\(s\) still non-zero or unfrozen/,
      /funding-source balance\(s\) still non-zero/,
      /wallet hold\(s\) still held/,
      /legacy top-up request\(s\) still in flight/,
      /withdrawal request\(s\) still in flight/,
      /reset touched % non-money wallet\(s\)/,
    ]) {
      expect(raw).toMatch(invariant);
    }
  });

  it('refuses to run before its prerequisite migration', () => {
    expect(raw).toMatch(/wallets\.account_type is missing/);
    expect(raw).toMatch(/deposit_requests\.purpose is missing/);
  });

  it('documents why the reset is safe', () => {
    // The safety argument is entirely contextual (founder-owned test data). If
    // that context is ever lost, the next reader must still find it here.
    expect(raw).toMatch(/founder-owned test/i);
    expect(raw).toMatch(/D1/);
  });
});

describe('MHC purchase reference scope migration', () => {
  const raw = readMigration(SCOPE_MIGRATION);

  it('replaces the over-broad index with a credit-purchase-scoped one', () => {
    expect(raw).toMatch(/DROP INDEX IF EXISTS public\.uq_deposit_requests_instapay_reference/);
    expect(raw).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_deposit_requests_credit_purchase_reference/);
  });

  it('scopes the new index to credit purchases only', () => {
    // Without this predicate the index spans legacy wallet top-ups, which both
    // risks aborting the migration on duplicate historical references and blocks
    // unrelated MHC purchases that reuse a bank reference string.
    expect(raw).toMatch(/purpose\s*=\s*'credit_purchase'/);
    expect(raw).toMatch(/provider\s*=\s*'instapay_manual'/);
    expect(raw).toMatch(/transfer_reference IS NOT NULL/);
  });
});
