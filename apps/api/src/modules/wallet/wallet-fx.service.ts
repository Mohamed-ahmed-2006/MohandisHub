// ---------------------------------------------------------------------------
// Wallet FX — EGP conversion for deposits/withdrawals (settings + NOWPayments)
// ---------------------------------------------------------------------------

import { env } from '../../config/env.js';
import { estimatePrice } from '../../lib/nowpayments.client.js';
import type { SettingsService } from '../settings/settings.service.js';

export type RateSnapshot = Record<string, unknown>;

export class WalletFxService {
  constructor(private readonly settingsService: SettingsService) {}

  async getEgpPerUsd(): Promise<number> {
    const liveUsdRate = await this.fetchLiveEgpPerUsdRate();
    if (liveUsdRate != null) {
      return liveUsdRate;
    }
    return await this.getEgpPerUsdtDeposit();
  }

  async getEgpPerUsdtDeposit(): Promise<number> {
    const liveRate = await this.fetchLiveEgpPerUsdtRate();
    if (liveRate != null) {
      return liveRate;
    }

    // Fallback when live lookup fails (network/provider issue)
    const configuredRate = await this.getConfiguredDepositRate();
    if (configuredRate != null) {
      return configuredRate;
    }
    return 48.5;
  }

  async getEgpPerUsdtWithdrawal(): Promise<number> {
    const liveRate = await this.fetchLiveEgpPerUsdtRate();
    if (liveRate != null) {
      return liveRate;
    }

    // Fallback when live lookup fails (network/provider issue)
    const row = await this.settingsService.getRawRow();
    const v = row?.wallet_egp_per_usdt_withdrawal;
    const parsed = this.parseNum(v);
    if (parsed != null && parsed > 0) {
      return parsed;
    }
    return await this.getEgpPerUsdtDeposit();
  }

  /**
   * EGP credited from NOWPayments IPN after crypto settlement.
   */
  async computeDepositCreditEgp(params: {
    providerPayload: Record<string, unknown>;
    invoicePriceAmount: number;
    invoicePriceCurrency: string;
  }): Promise<{ egp: number; snapshot: RateSnapshot }> {
    const payCurrency = this.toCurrencyCode(params.providerPayload.pay_currency);
    const actuallyPaid = this.parseNum(
      params.providerPayload.actually_paid ?? params.providerPayload.pay_amount,
    );
    const priceCurrency = (params.invoicePriceCurrency || 'EGP').toUpperCase();
    const egpPerUsdt = await this.getEgpPerUsdtDeposit();

    let egp: number;
    if (priceCurrency === 'EGP') {
      egp = this.round2(params.invoicePriceAmount);
    } else if (this.isLikelyUsdtFamily(payCurrency) && actuallyPaid != null && actuallyPaid > 0) {
      egp = this.round2(actuallyPaid * egpPerUsdt);
    } else if (actuallyPaid != null && actuallyPaid > 0 && payCurrency) {
      if (!env.NOWPAYMENTS_API_KEY) {
        egp = this.round2(params.invoicePriceAmount * egpPerUsdt);
      } else {
        const est = await estimatePrice(
          env.NOWPAYMENTS_API_KEY,
          actuallyPaid,
          payCurrency,
          'USDTTRC20',
        );
        const usdtEq = Number(est.estimated_amount);
        if (Number.isFinite(usdtEq) && usdtEq > 0) {
          egp = this.round2(usdtEq * egpPerUsdt);
        } else {
          egp = this.round2(params.invoicePriceAmount * egpPerUsdt);
        }
      }
    } else {
      egp = this.round2(params.invoicePriceAmount * egpPerUsdt);
    }

    const snapshot: RateSnapshot = {
      mode: 'deposit_settlement',
      invoice_price_amount: params.invoicePriceAmount,
      invoice_price_currency: priceCurrency,
      pay_currency: payCurrency || null,
      actually_paid: actuallyPaid,
      egp_per_usdt_applied: egpPerUsdt,
      computed_egp: egp,
      computed_at: new Date().toISOString(),
    };

    return { egp, snapshot };
  }

  /**
   * Crypto amount to request from NOWPayments for a given EGP debit (floor crypto).
   */
  async quoteCryptoPayoutFromEgp(
    amountEgp: number,
    payoutCurrency: string,
  ): Promise<{ cryptoAmount: number; snapshot: RateSnapshot }> {
    const egpPerUsdt = await this.getEgpPerUsdtWithdrawal();
    const cur = payoutCurrency.toUpperCase();
    let cryptoAmount: number;

    if (this.isLikelyUsdtFamily(cur)) {
      cryptoAmount = Math.floor((amountEgp / egpPerUsdt) * 1e8) / 1e8;
    } else if (env.NOWPAYMENTS_API_KEY) {
      // NOWPayments estimate endpoint does not reliably support EGP as source currency.
      // Convert EGP -> USD first, then ask provider for USD -> payout currency estimate.
      const egpPerUsd = await this.getEgpPerUsd();
      const amountUsd = amountEgp / egpPerUsd;
      const est = await estimatePrice(env.NOWPAYMENTS_API_KEY, amountUsd, 'USD', cur);
      const v = Number(est.estimated_amount);
      cryptoAmount = Number.isFinite(v) && v > 0 ? Math.floor(v * 1e8) / 1e8 : 0;
    } else {
      cryptoAmount = 0;
    }

    const snapshot: RateSnapshot = {
      mode: 'withdrawal_quote',
      source_amount_egp: amountEgp,
      payout_currency: cur,
      egp_per_usdt_applied: egpPerUsdt,
      quoted_crypto_amount: cryptoAmount,
      quoted_at: new Date().toISOString(),
    };

    return { cryptoAmount, snapshot };
  }

  private isLikelyUsdtFamily(currency: string): boolean {
    if (!currency) return false;
    return currency.includes('USDT') || currency.includes('USDC');
  }

  private parseNum(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  private toCurrencyCode(value: unknown): string {
    if (typeof value === 'string') {
      return value.toUpperCase().trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value).toUpperCase().trim();
    }
    return '';
  }

  private async fetchLiveEgpPerUsdtRate(): Promise<number | null> {
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=egp',
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
        },
      );
      if (!res.ok) return null;
      const payload = (await res.json()) as { tether?: { egp?: unknown } };
      const rate = this.parseNum(payload?.tether?.egp);
      return rate != null && rate > 0 ? rate : null;
    } catch {
      return null;
    }
  }

  private async fetchLiveEgpPerUsdRate(): Promise<number | null> {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const payload = (await res.json()) as { rates?: { EGP?: unknown }; result?: unknown };
      if (payload.result === 'error') return null;
      const rate = this.parseNum(payload?.rates?.EGP);
      return rate != null && rate > 0 ? rate : null;
    } catch {
      return null;
    }
  }

  private async getConfiguredDepositRate(): Promise<number | null> {
    const row = await this.settingsService.getRawRow();
    const v = row?.wallet_egp_per_usdt_deposit;
    const parsed = this.parseNum(v);
    return parsed != null && parsed > 0 ? parsed : null;
  }
}
