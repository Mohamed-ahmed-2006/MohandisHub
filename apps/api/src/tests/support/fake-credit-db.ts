// ---------------------------------------------------------------------------
// A small, deliberately faithful stand-in for the credit tables in PostgreSQL.
// ---------------------------------------------------------------------------
// The api test suite has no live database, and the existing money tests assert
// on the SQL a repository emitted. That is enough to prove ORDER of operations,
// but it cannot prove OUTCOME: "ten concurrent charges produce exactly one
// debit" and "a caller rollback leaves the balance untouched" are statements
// about resulting rows, not about statements issued.
//
// So this models the parts of PostgreSQL those claims depend on:
//
//   * transaction visibility at READ COMMITTED — each statement sees committed
//     data plus its own uncommitted writes, so a statement issued after a lock
//     is granted sees whatever the previous holder committed;
//   * SAVEPOINT / ROLLBACK TO SAVEPOINT / RELEASE, including SQLSTATE 25P01 when
//     a SAVEPOINT is attempted outside a transaction block;
//   * SELECT ... FOR UPDATE row locks that block a second connection until the
//     holder commits or rolls back;
//   * unique indexes, raising SQLSTATE 23505 on collision;
//   * NUMERIC(14,2) arithmetic, in integer cents, so no float drift can hide a
//     rounding bug;
//   * the CHECK that a wallet balance is never negative.
//
// It is not a database. It answers exactly the questions the charge primitive
// asks, and throws on any SQL it was not taught, so a change to the repository
// that this harness cannot model fails loudly instead of silently passing.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

type SqlParam = string | number | boolean | null | undefined;

export type WalletRecord = {
  id: string;
  user_id: string;
  account_type: string;
  /** Integer cents. NUMERIC(14,2) has no float behaviour and neither does this. */
  cents: number;
  is_frozen: boolean;
};

export type TransactionRecord = {
  id: string;
  wallet_id: string;
  user_id: string;
  type: string;
  amount_cents: number;
  balance_delta_cents: number;
  balance_after_cents: number;
  status: string;
  description: string;
  reference_type: string;
  reference_id: string;
  metadata: Record<string, unknown>;
  created_by: string | null;
};

export type ChargeRecord = {
  id: string;
  user_id: string;
  action_key: string;
  reference_type: string;
  reference_id: string;
  charged_cents: number;
  transaction_id: string | null;
  idempotency_key: string | null;
  refunded_at: string | null;
  refund_transaction_id: string | null;
  created_at: string;
  seq: number;
};

type Committed = {
  wallets: Map<string, WalletRecord>;
  transactions: TransactionRecord[];
  charges: ChargeRecord[];
};

/** Uncommitted work belonging to one connection. */
type Pending = {
  walletCents: Map<string, number>;
  newWallets: Map<string, WalletRecord>;
  transactions: TransactionRecord[];
  charges: ChargeRecord[];
  chargePatches: Map<string, Partial<ChargeRecord>>;
};

const toCents = (value: string | number): number =>
  Math.round((typeof value === 'number' ? value : parseFloat(value)) * 100);
const toText = (cents: number): string => (cents / 100).toFixed(2);

const clonePending = (p: Pending): Pending => ({
  walletCents: new Map(p.walletCents),
  newWallets: new Map(p.newWallets),
  transactions: [...p.transactions],
  charges: [...p.charges],
  chargePatches: new Map([...p.chargePatches].map(([k, v]) => [k, { ...v }])),
});

const emptyPending = (): Pending => ({
  walletCents: new Map(),
  newWallets: new Map(),
  transactions: [],
  charges: [],
  chargePatches: new Map(),
});

const pgError = (code: string, message: string): Error =>
  Object.assign(new Error(message), { code });

/** Row-level locks, keyed `table:id`, held until the holder ends its transaction. */
class LockTable {
  private holder = new Map<string, string>();
  private queue = new Map<string, Array<() => void>>();

  async acquire(key: string, connectionId: string): Promise<void> {
    if (this.holder.get(key) === connectionId) return;
    if (!this.holder.has(key)) {
      this.holder.set(key, connectionId);
      return;
    }
    await new Promise<void>((resolve) => {
      const waiters = this.queue.get(key) ?? [];
      waiters.push(resolve);
      this.queue.set(key, waiters);
    });
    this.holder.set(key, connectionId);
  }

  releaseAll(connectionId: string): void {
    for (const [key, owner] of [...this.holder]) {
      if (owner !== connectionId) continue;
      this.holder.delete(key);
      const waiters = this.queue.get(key);
      const next = waiters?.shift();
      if (next) next();
    }
  }
}

export class FakeCreditDb {
  private committed: Committed = { wallets: new Map(), transactions: [], charges: [] };
  private prices = new Map<string, { price: string; isActive: boolean }>();
  private users = new Map<string, string>();
  private locks = new LockTable();
  private chargeSeq = 0;

  /** Every statement any connection executed, for order-of-operations assertions. */
  readonly statements: string[] = [];

  seedUser(userId: string, primaryRole = 'expert'): void {
    this.users.set(userId, primaryRole);
  }

  seedWallet(params: {
    userId: string;
    mhc: number;
    isFrozen?: boolean;
    walletId?: string;
  }): WalletRecord {
    const wallet: WalletRecord = {
      id: params.walletId ?? `wallet-${params.userId}`,
      user_id: params.userId,
      account_type: 'provider_credit',
      cents: toCents(params.mhc),
      is_frozen: params.isFrozen ?? false,
    };
    this.committed.wallets.set(wallet.id, wallet);
    return wallet;
  }

  seedPrice(actionKey: string, price: number, isActive = true): void {
    this.prices.set(actionKey, { price: price.toFixed(2), isActive });
  }

  /**
   * Inject a committed charge row directly. Used to build states the charging
   * primitive cannot produce on its own — notably a zero-value charge, which
   * exists only if some future consumer writes one by hand.
   */
  seedCharge(params: {
    userId: string;
    actionKey: string;
    referenceType: string;
    referenceId: string;
    mhc: number;
    id?: string;
    transactionId?: string | null;
    refundedAt?: string | null;
  }): ChargeRecord {
    const row: ChargeRecord = {
      id: params.id ?? randomUUID(),
      user_id: params.userId,
      action_key: params.actionKey,
      reference_type: params.referenceType,
      reference_id: params.referenceId,
      charged_cents: toCents(params.mhc),
      transaction_id: params.transactionId ?? null,
      idempotency_key: null,
      refunded_at: params.refundedAt ?? null,
      refund_transaction_id: null,
      created_at: new Date().toISOString(),
      seq: this.nextChargeSeq(),
    };
    this.committed.charges.push(row);
    return row;
  }

  /**
   * Runs immediately before any INSERT into mhc_action_charges. Lets a test
   * commit a competing charge at exactly the moment that loses the race, which
   * is the only way to exercise the unique-violation recovery deterministically.
   */
  beforeChargeInsert: (() => Promise<void> | void) | null = null;

  removePrice(actionKey: string): void {
    this.prices.delete(actionKey);
  }

  // -- committed-state assertions -------------------------------------------
  balanceOf(userId: string): number {
    for (const wallet of this.committed.wallets.values()) {
      if (wallet.user_id === userId && wallet.account_type === 'provider_credit') {
        return wallet.cents / 100;
      }
    }
    return 0;
  }

  ledger(): TransactionRecord[] {
    return [...this.committed.transactions];
  }

  ledgerFor(referenceType: string): TransactionRecord[] {
    return this.committed.transactions.filter((t) => t.reference_type === referenceType);
  }

  charges(): ChargeRecord[] {
    return [...this.committed.charges];
  }

  chargeById(id: string): ChargeRecord | undefined {
    return this.committed.charges.find((c) => c.id === id);
  }

  /** Sum of every ledger delta, which must always equal the wallet balance. */
  ledgerSumFor(userId: string): number {
    const cents = this.committed.transactions
      .filter((t) => t.user_id === userId)
      .reduce((sum, t) => sum + t.balance_delta_cents, 0);
    return cents / 100;
  }

  connect(): FakeConnection {
    return new FakeConnection(this, this.locks);
  }

  // -- internals used by FakeConnection --------------------------------------
  /** @internal */ get state(): Committed {
    return this.committed;
  }
  /** @internal */ priceFor(key: string): { price: string; isActive: boolean } | undefined {
    return this.prices.get(key);
  }
  /** @internal */ roleFor(userId: string): string | undefined {
    return this.users.get(userId);
  }
  /** @internal */ nextChargeSeq(): number {
    this.chargeSeq += 1;
    return this.chargeSeq;
  }
  /** @internal */ record(sql: string): void {
    this.statements.push(sql);
  }
}

export class FakeConnection {
  private readonly id = randomUUID();
  private inTransaction = false;
  private pending: Pending = emptyPending();
  private savepoints: Array<{ name: string; snapshot: Pending }> = [];
  /** Statements this connection issued, in order. */
  readonly statements: string[] = [];

  constructor(
    private readonly db: FakeCreditDb,
    private readonly locks: LockTable,
  ) {}

  /** Hand to production code that expects a `pg` PoolClient. */
  asPoolClient(): PoolClient {
    return this as unknown as PoolClient;
  }

  release(): void {
    this.rollback();
  }

  async query<R>(sql: string, values: SqlParam[] = []): Promise<{ rows: R[]; rowCount: number }> {
    const text = sql.trim().replace(/\s+/g, ' ');
    this.statements.push(text);
    this.db.record(text);
    const rows = await this.execute(text, values);
    return { rows: rows as R[], rowCount: rows.length };
  }

  // -- visibility -----------------------------------------------------------
  private walletById(id: string): WalletRecord | undefined {
    const base = this.pending.newWallets.get(id) ?? this.db.state.wallets.get(id);
    if (!base) return undefined;
    const overridden = this.pending.walletCents.get(id);
    return overridden === undefined ? base : { ...base, cents: overridden };
  }

  private walletByUser(userId: string): WalletRecord | undefined {
    for (const id of [...this.db.state.wallets.keys(), ...this.pending.newWallets.keys()]) {
      const wallet = this.walletById(id);
      if (wallet && wallet.user_id === userId && wallet.account_type === 'provider_credit') {
        return wallet;
      }
    }
    return undefined;
  }

  private visibleCharges(): ChargeRecord[] {
    const merged = [...this.db.state.charges, ...this.pending.charges].map((c) => {
      const patch = this.pending.chargePatches.get(c.id);
      return patch ? { ...c, ...patch } : { ...c };
    });
    return merged.sort((a, b) => a.seq - b.seq);
  }

  private chargeRowShape(c: ChargeRecord): Record<string, unknown> {
    return {
      id: c.id,
      user_id: c.user_id,
      action_key: c.action_key,
      reference_type: c.reference_type,
      reference_id: c.reference_id,
      mhc_charged: toText(c.charged_cents),
      transaction_id: c.transaction_id,
      idempotency_key: c.idempotency_key,
      refunded_at: c.refunded_at,
      refund_transaction_id: c.refund_transaction_id,
      created_at: c.created_at,
    };
  }

  // -- transaction control --------------------------------------------------
  private commit(): void {
    const state = this.db.state;
    for (const [id, wallet] of this.pending.newWallets) {
      if (!state.wallets.has(id)) state.wallets.set(id, { ...wallet });
    }
    for (const [id, cents] of this.pending.walletCents) {
      const wallet = state.wallets.get(id);
      if (wallet) wallet.cents = cents;
    }
    state.transactions.push(...this.pending.transactions);
    state.charges.push(...this.pending.charges);
    for (const [id, patch] of this.pending.chargePatches) {
      const row = state.charges.find((c) => c.id === id);
      if (row) Object.assign(row, patch);
    }
    this.reset();
  }

  private rollback(): void {
    this.reset();
  }

  private reset(): void {
    this.pending = emptyPending();
    this.savepoints = [];
    this.inTransaction = false;
    this.locks.releaseAll(this.id);
  }

  // -- statement dispatch ---------------------------------------------------
  private async execute(sql: string, values: SqlParam[]): Promise<Array<Record<string, unknown>>> {
    if (/^BEGIN$/i.test(sql)) {
      this.inTransaction = true;
      return [];
    }
    if (/^COMMIT$/i.test(sql)) {
      this.commit();
      return [];
    }
    if (/^ROLLBACK$/i.test(sql)) {
      this.rollback();
      return [];
    }
    if (/^SAVEPOINT /i.test(sql)) {
      if (!this.inTransaction) {
        throw pgError('25P01', 'SAVEPOINT can only be used in transaction blocks');
      }
      this.savepoints.push({ name: sql.split(/\s+/)[1]!, snapshot: clonePending(this.pending) });
      return [];
    }
    if (/^ROLLBACK TO SAVEPOINT /i.test(sql)) {
      const name = sql.split(/\s+/)[3]!;
      const idx = this.savepoints.findIndex((s) => s.name === name);
      if (idx === -1) throw pgError('3B001', `no such savepoint: ${name}`);
      this.pending = clonePending(this.savepoints[idx]!.snapshot);
      this.savepoints = this.savepoints.slice(0, idx + 1);
      return [];
    }
    if (/^RELEASE SAVEPOINT /i.test(sql)) {
      const name = sql.split(/\s+/)[2]!;
      const idx = this.savepoints.findIndex((s) => s.name === name);
      if (idx === -1) throw pgError('3B001', `no such savepoint: ${name}`);
      this.savepoints = this.savepoints.slice(0, idx);
      return [];
    }

    if (/^SELECT primary_role FROM users/i.test(sql)) {
      const role = this.db.roleFor(String(values[0]));
      return role ? [{ primary_role: role }] : [];
    }

    if (/FROM mhc_action_prices WHERE action_key/i.test(sql)) {
      const row = this.db.priceFor(String(values[0]));
      return row ? [{ mhc_price: row.price, is_active: row.isActive }] : [];
    }

    if (/^INSERT INTO wallets/i.test(sql)) {
      const userId = String(values[0]);
      const existing = this.walletByUser(userId);
      if (existing) return [this.walletRow(existing)];
      const wallet: WalletRecord = {
        id: `wallet-${randomUUID()}`,
        user_id: userId,
        account_type: 'provider_credit',
        cents: 0,
        is_frozen: false,
      };
      this.pending.newWallets.set(wallet.id, wallet);
      return [this.walletRow(wallet)];
    }

    if (/^SELECT balance::text, is_frozen FROM wallets WHERE id = \$1 FOR UPDATE$/i.test(sql)) {
      const walletId = String(values[0]);
      await this.locks.acquire(`wallets:${walletId}`, this.id);
      const wallet = this.walletById(walletId);
      if (!wallet) return [];
      return [{ balance: toText(wallet.cents), is_frozen: wallet.is_frozen }];
    }

    if (/^SELECT balance::text FROM wallets WHERE user_id = \$1/i.test(sql)) {
      const wallet = this.walletByUser(String(values[0]));
      return wallet ? [{ balance: toText(wallet.cents) }] : [];
    }

    if (/^UPDATE wallets SET balance = balance - /i.test(sql)) {
      const walletId = String(values[0]);
      const amount = toCents(values[1] as number);
      const wallet = this.walletById(walletId);
      if (!wallet || wallet.cents < amount) return [];
      const next = wallet.cents - amount;
      if (next < 0) throw pgError('23514', 'chk_wallets_balance_nonnegative');
      this.pending.walletCents.set(walletId, next);
      return [{ balance: toText(next) }];
    }

    if (/^UPDATE wallets SET balance = balance \+ /i.test(sql)) {
      const walletId = String(values[0]);
      const wallet = this.walletById(walletId);
      if (!wallet) return [];
      const next = wallet.cents + toCents(values[1] as number);
      this.pending.walletCents.set(walletId, next);
      return [{ balance: toText(next) }];
    }

    if (/^SELECT .* FROM mhc_action_charges WHERE id = \$1 FOR UPDATE$/i.test(sql)) {
      const chargeId = String(values[0]);
      await this.locks.acquire(`charges:${chargeId}`, this.id);
      const row = this.visibleCharges().find((c) => c.id === chargeId);
      return row ? [this.chargeRowShape(row)] : [];
    }

    if (/^SELECT .* FROM mhc_action_charges WHERE \(action_key/i.test(sql)) {
      const [actionKey, referenceType, referenceId, idempotencyKey, userId] = values.map((v) =>
        v == null ? null : String(v),
      );
      const row = this.visibleCharges().find(
        (c) =>
          (c.action_key === actionKey &&
            c.reference_type === referenceType &&
            c.reference_id === referenceId) ||
          (idempotencyKey !== null &&
            c.user_id === userId &&
            c.action_key === actionKey &&
            c.idempotency_key === idempotencyKey),
      );
      return row ? [this.chargeRowShape(row)] : [];
    }

    if (/^INSERT INTO mhc_action_charges/i.test(sql)) {
      const hook = this.db.beforeChargeInsert;
      if (hook) await hook();
      const [userId, actionKey, referenceType, referenceId, price, idempotencyKey] = values;
      const chargedCents = toCents(price as number);
      if (chargedCents < 0) throw pgError('23514', 'mhc_action_charges_mhc_charged_check');
      const existing = this.visibleCharges();
      const naturalClash = existing.some(
        (c) =>
          c.action_key === actionKey &&
          c.reference_type === referenceType &&
          c.reference_id === referenceId,
      );
      if (naturalClash) {
        throw pgError(
          '23505',
          'duplicate key value violates unique constraint "uq_mhc_action_charge_reference"',
        );
      }
      if (idempotencyKey != null) {
        const keyClash = existing.some(
          (c) =>
            c.user_id === userId &&
            c.action_key === actionKey &&
            c.idempotency_key === idempotencyKey,
        );
        if (keyClash) {
          throw pgError(
            '23505',
            'duplicate key value violates unique constraint "uq_mhc_action_charge_idempotency"',
          );
        }
      }
      const row: ChargeRecord = {
        id: randomUUID(),
        user_id: String(userId),
        action_key: String(actionKey),
        reference_type: String(referenceType),
        reference_id: String(referenceId),
        charged_cents: chargedCents,
        transaction_id: null,
        idempotency_key: idempotencyKey == null ? null : String(idempotencyKey),
        refunded_at: null,
        refund_transaction_id: null,
        created_at: new Date().toISOString(),
        seq: this.db.nextChargeSeq(),
      };
      this.pending.charges.push(row);
      return [{ id: row.id }];
    }

    if (/^UPDATE mhc_action_charges SET transaction_id/i.test(sql)) {
      this.patchCharge(String(values[0]), { transaction_id: String(values[1]) });
      return [{ id: String(values[0]) }];
    }

    if (/^UPDATE mhc_action_charges SET refunded_at = now\(\)/i.test(sql)) {
      const chargeId = String(values[0]);
      const row = this.visibleCharges().find((c) => c.id === chargeId);
      if (!row || row.refunded_at != null) return [];
      this.patchCharge(chargeId, {
        refunded_at: new Date().toISOString(),
        refund_transaction_id: String(values[1]),
      });
      return [{ id: chargeId }];
    }

    if (/^INSERT INTO transactions/i.test(sql)) {
      const row: TransactionRecord = {
        id: `tx-${randomUUID()}`,
        wallet_id: String(values[0]),
        user_id: String(values[1]),
        type: String(values[2]),
        amount_cents: toCents(values[3] as number),
        balance_delta_cents: toCents(values[4] as number),
        balance_after_cents: toCents(values[5] as number),
        status: 'completed',
        description: String(values[6]),
        reference_type: String(values[7]),
        reference_id: String(values[8]),
        metadata: JSON.parse(String(values[9])) as Record<string, unknown>,
        created_by: values[10] == null ? null : String(values[10]),
      };
      if (row.amount_cents < 0) throw pgError('23514', 'chk_transactions_amount_nonnegative');
      if (row.reference_type.length > 30) {
        throw pgError('22001', 'value too long for type character varying(30)');
      }
      this.pending.transactions.push(row);
      return [{ id: row.id }];
    }

    throw new Error(`FakeCreditDb has no rule for: ${sql}`);
  }

  private patchCharge(id: string, patch: Partial<ChargeRecord>): void {
    const own = this.pending.charges.find((c) => c.id === id);
    if (own) {
      Object.assign(own, patch);
      return;
    }
    this.pending.chargePatches.set(id, { ...this.pending.chargePatches.get(id), ...patch });
  }

  private walletRow(wallet: WalletRecord): Record<string, unknown> {
    return {
      id: wallet.id,
      user_id: wallet.user_id,
      balance: toText(wallet.cents),
      is_frozen: wallet.is_frozen,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
}
