import { getPool } from '../../db/pool.js';

export type ProviderPaymentMethodRow = {
  id: string;
  user_id: string;
  method_type: string;
  label: string | null;
  details: Record<string, unknown>;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

/** What a customer sees before activation: enough to recognise, nothing payable. */
export type MaskedPaymentMethod = {
  id: string;
  methodType: string;
  label: string | null;
};

export class ProviderPaymentsRepository {
  private get db() {
    return getPool();
  }

  private columns = `id, user_id, method_type, label, details, is_active, sort_order,
                     created_at, updated_at`;

  async listForProvider(
    userId: string,
    activeOnly = false,
  ): Promise<ProviderPaymentMethodRow[]> {
    const { rows } = await this.db.query<ProviderPaymentMethodRow>(
      `SELECT ${this.columns} FROM provider_payment_methods
       WHERE user_id = $1 ${activeOnly ? 'AND is_active = true' : ''}
       ORDER BY sort_order, created_at`,
      [userId],
    );
    return rows;
  }

  async findById(id: string): Promise<ProviderPaymentMethodRow | null> {
    const { rows } = await this.db.query<ProviderPaymentMethodRow>(
      `SELECT ${this.columns} FROM provider_payment_methods WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async countActive(userId: string): Promise<number> {
    const { rows } = await this.db.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM provider_payment_methods
       WHERE user_id = $1 AND is_active = true`,
      [userId],
    );
    return parseInt(rows[0]?.c ?? '0', 10);
  }

  async create(params: {
    userId: string;
    methodType: string;
    label: string | null;
    details: Record<string, unknown>;
    isActive: boolean;
    sortOrder: number;
  }): Promise<ProviderPaymentMethodRow> {
    const { rows } = await this.db.query<ProviderPaymentMethodRow>(
      `INSERT INTO provider_payment_methods
         (user_id, method_type, label, details, is_active, sort_order)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING ${this.columns}`,
      [
        params.userId,
        params.methodType,
        params.label,
        JSON.stringify(params.details),
        params.isActive,
        params.sortOrder,
      ],
    );
    return rows[0]!;
  }

  /** Ownership is part of the predicate so a wrong id can never update another provider's row. */
  async update(params: {
    id: string;
    userId: string;
    label: string | null;
    details: Record<string, unknown>;
    isActive: boolean;
    sortOrder: number;
  }): Promise<ProviderPaymentMethodRow | null> {
    const { rows } = await this.db.query<ProviderPaymentMethodRow>(
      `UPDATE provider_payment_methods
       SET label = $3, details = $4::jsonb, is_active = $5, sort_order = $6, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING ${this.columns}`,
      [
        params.id,
        params.userId,
        params.label,
        JSON.stringify(params.details),
        params.isActive,
        params.sortOrder,
      ],
    );
    return rows[0] ?? null;
  }

  async remove(id: string, userId: string): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM provider_payment_methods WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Record that a customer was shown a provider's payment details, and return
   * the methods — in ONE transaction.
   *
   * The audit row is written BEFORE the details are returned, so a failed write
   * can never produce an unaudited disclosure. `uq_provider_payment_disclosure_
   * activation_customer` makes repeat disclosure idempotent: the second call
   * updates nothing and still returns the details.
   */
  async discloseForActivation(params: {
    activationId: string;
    providerUserId: string;
    customerUserId: string;
  }): Promise<{ methods: ProviderPaymentMethodRow[]; firstDisclosure: boolean }> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const inserted = await client.query(
        `INSERT INTO provider_payment_disclosures
           (activation_id, provider_user_id, customer_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (activation_id, customer_user_id) DO NOTHING`,
        [params.activationId, params.providerUserId, params.customerUserId],
      );

      const { rows: methods } = await client.query<ProviderPaymentMethodRow>(
        `SELECT ${this.columns} FROM provider_payment_methods
         WHERE user_id = $1 AND is_active = true
         ORDER BY sort_order, created_at`,
        [params.providerUserId],
      );

      await client.query('COMMIT');
      return { methods, firstDisclosure: (inserted.rowCount ?? 0) > 0 };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  /** The activation row that authorises disclosure for a bid. */
  async findAwardActivation(
    bidId: string,
  ): Promise<{ id: string; provider_user_id: string; need_id: string | null } | null> {
    const { rows } = await this.db.query<{
      id: string;
      provider_user_id: string;
      need_id: string | null;
    }>(
      `SELECT id, provider_user_id, need_id FROM mhc_job_activations
       WHERE activation_type = 'award' AND bid_id = $1 LIMIT 1`,
      [bidId],
    );
    return rows[0] ?? null;
  }

  async listDisclosuresForProvider(userId: string): Promise<
    Array<{
      id: string;
      customer_user_id: string;
      customer_name: string | null;
      disclosed_at: string;
      need_id: string | null;
    }>
  > {
    const { rows } = await this.db.query<{
      id: string;
      customer_user_id: string;
      customer_name: string | null;
      disclosed_at: string;
      need_id: string | null;
    }>(
      `SELECT d.id, d.customer_user_id, u.display_name AS customer_name,
              d.disclosed_at::text, a.need_id
       FROM provider_payment_disclosures d
       JOIN users u ON u.id = d.customer_user_id
       LEFT JOIN mhc_job_activations a ON a.id = d.activation_id
       WHERE d.provider_user_id = $1
       ORDER BY d.disclosed_at DESC`,
      [userId],
    );
    return rows;
  }
}
