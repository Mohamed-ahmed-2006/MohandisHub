import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formatMhc } from '@/lib/mhc/presentation';

// ---------------------------------------------------------------------------
// P0-03 — the advertisement surfaces price campaigns in MHC, never in EGP.
// ---------------------------------------------------------------------------
// Advertising was the last provider-facing screen quoting a wallet-denominated
// figure ("120.00 EGP", "Deducted from wallet immediately"). Because the wallet
// it referred to is frozen, that copy promised something the platform could not
// do. These tests pin the replacement: a credit figure, no currency symbol, and
// a truthful statement about what happens on create.
//
// The renderer itself is shared with the credits screen and is already covered
// by mhc-presentation.test.ts; what is asserted here is that the advertisement
// screen's own strings and price maths carry no money.
// ---------------------------------------------------------------------------

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string): string => readFileSync(join(WEB_ROOT, relative), 'utf8');

const MY_ADS = 'components/app/advertisements/my-ads-screen.tsx';
const ADMIN_ADS = 'components/admin/admin-ads-tab.tsx';
const ADS_CLIENT = 'lib/advertisements/client.ts';

/** Strip comments, so prose about the legacy EGP path never trips these scans. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('advertisement pricing is presented as MHC credits', () => {
  it('renders a campaign price with no currency symbol', () => {
    const rendered = formatMhc(40, 'en');
    expect(rendered).toContain('MHC');
    expect(rendered).not.toMatch(/EGP|£|\$/);
  });

  it('renders an Arabic campaign price with no currency symbol', () => {
    const rendered = formatMhc(40, 'ar');
    expect(rendered).toContain('نقطة');
    expect(rendered).not.toMatch(/EGP|£|\$|ج\.م/);
  });

  it('prices the provider ad form through formatMhc, not a currency template', () => {
    const source = stripComments(read(MY_ADS));
    expect(source).toContain('formatMhc(campaignCost, locale)');
    // The old template was `${totalCost.toFixed(2)} EGP`.
    expect(source).not.toMatch(/toFixed\(2\)\}\s*EGP/);
    expect(source).not.toContain('pricePerDay');
  });

  it('no longer tells the provider the price is deducted from a wallet', () => {
    const source = stripComments(read(MY_ADS));
    expect(source).not.toMatch(/Deducted from wallet/i);
    expect(source).toMatch(/Charged from your credits/i);
  });

  it('states plainly when a campaign is free instead of showing 0.00', () => {
    const source = stripComments(read(MY_ADS));
    expect(source).toMatch(/No credits are charged for this campaign/);
    expect(source).toMatch(/tr\('Free', 'مجاني'\)/);
  });

  it('keeps every provider-facing ad string bilingual', () => {
    const source = stripComments(read(MY_ADS));
    for (const pair of [
      /tr\(\s*'Credits & timeline',\s*'الرصيد والجدول'\s*\)/,
      /tr\('Free', 'مجاني'\)/,
      /tr\('Paid \(legacy\)', 'المدفوع \(سابقًا\)'\)/,
    ]) {
      expect(source).toMatch(pair);
    }
  });
});

describe('admin advertisement pricing edits the MHC action price', () => {
  it('labels the control as MHC credits per campaign', () => {
    const source = stripComments(read(ADMIN_ADS));
    expect(source).toContain('Price per campaign (MHC credits)');
    expect(source).not.toContain('Price per day (EGP)');
  });

  it('binds the control to mhcPrice, not to the retired EGP field', () => {
    const source = stripComments(read(ADMIN_ADS));
    expect(source).toContain('controls.mhcPrice');
    expect(source).not.toContain('pricePerDay');
  });

  it('shows a historic EGP amount only where one genuinely exists', () => {
    const source = stripComments(read(ADMIN_ADS));
    // Never an unconditional `${ad.amount_paid} EGP`.
    expect(source).toMatch(/Number\.parseFloat\(ad\.amount_paid \?\? '0'\) > 0/);
    expect(source).toMatch(/EGP \(legacy\)/);
  });
});

describe('advertisement API client', () => {
  it('types ad controls with an MHC price and no EGP field', () => {
    const source = stripComments(read(ADS_CLIENT));
    expect(source).toMatch(/mhcPrice: number/);
    expect(source).not.toContain('pricePerDay');
  });

  it('sends an Idempotency-Key so a retried create cannot double-charge', () => {
    const source = stripComments(read(ADS_CLIENT));
    expect(source).toMatch(/'Idempotency-Key': opts\.idempotencyKey/);
    const screen = stripComments(read(MY_ADS));
    expect(screen).toContain('crypto.randomUUID()');
  });
});
