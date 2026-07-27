import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('wallet source ledger integration', () => {
  it('adds source balances, movements, reconciliation state, and hold allocations', () => {
    const migration = readSource(
      '../../../../supabase/migrations/20260727120000_wallet_funding_sources_and_admin_bulk_actions.sql',
    );
    expect(migration).toContain('wallet_fund_balances');
    expect(migration).toContain('wallet_fund_movements');
    expect(migration).toContain('source_reconciliation_status');
    expect(migration).toContain('funding_allocations');
    expect(migration).toContain("'review_required'");
    expect(migration).toContain("VALUES ('crypto'), ('instapay'), ('paymob'), ('card'), ('restricted')");
  });

  it('records deposits, debits, holds, releases, and inherited credits by rail', () => {
    const repository = readSource('../modules/wallet/wallet.repository.ts');
    expect(repository).toContain('railForDepositProvider');
    expect(repository).toContain('allocateFundingInTransaction');
    expect(repository).toContain('recordFundingMovementsInTransaction');
    expect(repository).toContain('creditFundingInTransaction');
    expect(repository).toContain('resolveInheritedFundingInTransaction');
    expect(repository).toContain("metadata.withdrawal_method === 'crypto'");
    expect(repository).toContain('allocation: hold.funding_allocations');
  });

  it('checks provider liquidity before submitting a crypto payout', () => {
    const client = readSource('../lib/nowpayments.client.ts');
    const service = readSource('../modules/wallet/wallet.service.ts');
    expect(client).toContain('`${NOWPAYMENTS_BASE}/balance`');
    expect(service).toContain('assertCryptoTreasuryLiquidity');
    expect(service).toContain('NOWPAYMENTS_PAYOUT_LIQUIDITY_BUFFER_PERCENT');
    expect(service.indexOf('assertCryptoTreasuryLiquidity(row)')).toBeLessThan(
      service.indexOf('createPayout(env.NOWPAYMENTS_API_KEY'),
    );
  });
});
