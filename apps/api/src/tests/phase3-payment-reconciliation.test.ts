import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('phase 3 payment reconciliation hardening', () => {
  it('validates and caps Paymob deposit callback settlement before crediting', () => {
    const walletService = readSource('../modules/wallet/wallet.service.ts');
    const walletRepository = readSource('../modules/wallet/wallet.repository.ts');

    expect(walletService).toContain("this.readPath(transaction, 'order.merchant_order_id')");
    expect(walletService).toContain('paymob_deposit_settlement');
    expect(walletService).toContain('paidAmountEgp + 0.01 < expectedAmountEgp');
    expect(walletService).toContain('Math.min(paidAmountEgp, expectedAmountEgp)');
    expect(walletService).toContain('overpayment_egp');
    expect(walletRepository).toContain(
      'paymob_intention_id, paymob_order_id, paymob_transaction_id',
    );
    expect(walletRepository).toContain('paymob_transaction_id = COALESCE');
  });

  it('caps NOWPayments deposit credit and records over/underpayment metadata', () => {
    const walletService = readSource('../modules/wallet/wallet.service.ts');

    expect(walletService).toContain('requested_credit_egp');
    expect(walletService).toContain('computed_credit_egp');
    expect(walletService).toContain('underpayment_egp');
    expect(walletService).toContain('Math.min(egp, requestedCreditEgp)');
  });

  it('supports audited admin completion for Paymob withdrawals', () => {
    const adminRoutes = readSource('../modules/admin/admin.routes.ts');
    const adminController = readSource('../modules/admin/admin.controller.ts');
    const walletRepository = readSource('../modules/wallet/wallet.repository.ts');

    expect(adminRoutes).toContain('/wallet/paymob-withdrawals/:id/complete');
    expect(adminController).toContain('admin.wallet.paymob_withdrawal.complete');
    expect(walletRepository).toContain('completePaymobWithdrawalByAdmin');
    expect(walletRepository).toContain('Paymob withdrawal completed');
    expect(walletRepository).toContain("'paymob_payout'");
  });

  it('makes admin transaction reversal idempotent and protects wallet balances', () => {
    const adminRepository = readSource('../modules/admin/admin.repository.ts');

    expect(adminRepository).toContain("reference_type = 'reversal'");
    expect(adminRepository).toContain('orig.balance_delta == null');
    expect(adminRepository).toContain('LEGACY_TRANSACTION_DIRECTION_AMBIGUOUS');
    expect(adminRepository).toContain('TRANSACTION_HAS_NO_BALANCE_EFFECT');
    expect(adminRepository).toContain('const reverseAmount = -originalDelta');
    expect(adminRepository).toContain('balance + $2 >= 0');
  });

  it('adds database uniqueness for payment reconciliation ids', () => {
    const migration = readSource(
      '../../../../supabase/migrations/20260610124500_payment_reconciliation_uniqueness.sql',
    );
    const invariants = readSource(
      '../../../../supabase/migrations/20260610125500_wallet_money_invariants.sql',
    );

    expect(migration).toContain('uq_deposit_requests_paymob_order_id');
    expect(migration).toContain('uq_deposit_requests_paymob_transaction_id');
    expect(migration).toContain('uq_deposit_requests_provider_payment_id');
    expect(invariants).toContain('chk_wallets_balance_nonnegative');
    expect(invariants).toContain('chk_transactions_amount_nonnegative');
    expect(invariants).toContain('chk_wallet_holds_amount_positive');
  });
});
