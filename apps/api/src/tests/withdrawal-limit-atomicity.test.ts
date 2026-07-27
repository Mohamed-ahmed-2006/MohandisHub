import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('daily withdrawal limit atomicity', () => {
  it('checks the daily aggregate inside the wallet-locked creation transaction', () => {
    const service = readSource('../modules/wallet/wallet.service.ts');
    const repository = readSource('../modules/wallet/wallet.repository.ts');

    const methodStart = repository.indexOf('async createWithdrawalRequestWithHold');
    const begin = repository.indexOf("client.query('BEGIN')", methodStart);
    const walletLock = repository.indexOf('createHoldInTransaction', begin);
    const dailyCheck = repository.indexOf('dailyMaxAmountEgp', walletLock);
    const insert = repository.indexOf('INSERT INTO withdrawal_requests', dailyCheck);

    expect(begin).toBeGreaterThan(methodStart);
    expect(walletLock).toBeGreaterThan(begin);
    expect(dailyCheck).toBeGreaterThan(walletLock);
    expect(insert).toBeGreaterThan(dailyCheck);
    expect(repository).toContain("throw new Error('DAILY_WITHDRAWAL_LIMIT_EXCEEDED')");
    expect(repository).toContain("now() AT TIME ZONE 'Africa/Cairo'");
    expect(repository).not.toContain('dailyLimitSince');
    expect(service).not.toContain('setUTCHours(0, 0, 0, 0)');
    expect(service).toContain("message === 'DAILY_WITHDRAWAL_LIMIT_EXCEEDED'");
    expect(service).not.toContain('getWithdrawalTotalForUserSince({');
  });
});
