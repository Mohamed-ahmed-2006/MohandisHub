import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { arDictionary } from '@/lib/i18n/dictionaries/ar';
import { enDictionary } from '@/lib/i18n/dictionaries/en';

// ---------------------------------------------------------------------------
// Per-plan MHC pricing on the plans and admin surfaces.
// ---------------------------------------------------------------------------
// Every paid plan carries its own admin-configured MHC price. What has to hold
// on screen:
//
//   * the price shown is the plan's MHC price, rendered by the shared
//     credit formatter so no currency symbol can appear;
//   * the legacy EGP `plan.price` is never presented as what a plan costs;
//   * Subscribe appears only when the plan is genuinely buyable — switched on,
//     priced, and not globally paused — and a paid plan that is not reads
//     "Coming soon" without a price;
//   * running out of credits offers the way out, not just an error.
//
// Asserted against component source and the real dictionaries, matching the
// existing UI suites (mhc-presentation, advertisement-mhc-presentation).
// ---------------------------------------------------------------------------

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string): string => readFileSync(join(WEB_ROOT, relative), 'utf8');

const PLAN_SCREEN = 'components/app/my-plan-screen.tsx';
const ADMIN_PLANS = 'components/admin/admin-plans-tab.tsx';
const PLANS_CLIENT = 'lib/plans/client.ts';

/** Strip comments so prose about the retired EGP path never trips a scan. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const planScreen = (): string => stripComments(read(PLAN_SCREEN));
const adminPlans = (): string => stripComments(read(ADMIN_PLANS));

describe('the plans screen prices plans in MHC', () => {
  it('renders each plan MHC price through formatMhc', () => {
    const source = planScreen();
    expect(source).toContain('formatMhc(plan.mhcPrice ?? 0, locale)');
  });

  it('decides paid-ness from the MHC price, not the legacy EGP column', () => {
    const source = planScreen();
    expect(source).toMatch(/isPaidPlan = \(plan: Plan\): boolean => \(plan\.mhcPrice \?\? 0\) > 0/);
    // The EGP price is never read for display or for the paid/free decision.
    expect(source).not.toMatch(/Number\(plan\.price\)/);
    expect(source).not.toMatch(/\{plan\.price\}/);
  });

  it('renders no currency literal or symbol anywhere', () => {
    const source = planScreen();
    expect(source).not.toMatch(/'EGP'/);
    expect(source).not.toMatch(/plan\.currency/);
    expect(source).not.toMatch(/£/);
    // A currency-style `$` next to a figure. A bare `$` is excluded because
    // every template literal contains one.
    expect(source).not.toMatch(/\$\s?\d/);
    expect(source).not.toMatch(/ج\.م/);
  });

  it('shows the plan duration alongside the price', () => {
    expect(planScreen()).toContain('plan-card-duration');
  });

  it('shows the MHC balance, never a wallet balance', () => {
    const source = planScreen();
    expect(source).toContain('formatMhc(mhcBalance, locale)');
    expect(source).not.toContain('walletApiClient');
    expect(source).not.toMatch(/wallet\.balance/);
  });
});

describe('Subscribe appears only for a genuinely buyable plan', () => {
  it('requires purchasable, priced and not paused, all three', () => {
    const source = planScreen();
    expect(source).toMatch(
      /isBuyable = \(plan: Plan\): boolean =>\s*plan\.isPurchasable && plan\.mhcPrice !== null && !subscriptionsPaused/,
    );
    expect(source).toMatch(/const showSubscribeButton = !isCurrent && isBuyable\(plan\)/);
    // Exactly one CTA, gated on that condition.
    expect(source.match(/plan-card-cta/g) ?? []).toHaveLength(1);
  });

  it('fails closed when the app status is unknown', () => {
    // `!== false`, not `=== true`: an absent status must not read as "open".
    expect(planScreen()).toContain('status?.pausePlanSubscriptions !== false');
  });

  it('shows Coming soon with no price for a paid plan that is not buyable', () => {
    const source = planScreen();
    expect(source).toMatch(/const notYetAvailable = paid && !isBuyable\(plan\)/);
    expect(source).toContain('plan-card-price--coming-soon');
    expect(source).toContain('dictionary.common.comingSoon');
  });

  it('never labels a paid plan as free', () => {
    expect(planScreen()).toMatch(/paid\s*\?\s*formatMhc/);
  });
});

describe('confirmation states the exact credit deduction', () => {
  it('quotes the plan MHC price and the resulting balance', () => {
    const source = planScreen();
    expect(source).toContain('confirmTextMhc');
    expect(source).toContain('formatMhc(confirmPlan.mhcPrice ?? 0, locale)');
    expect(source).toContain('confirmBalanceAfter');
  });

  it('sends an Idempotency-Key so a double click cannot buy twice', () => {
    expect(planScreen()).toContain('crypto.randomUUID()');
    expect(stripComments(read(PLANS_CLIENT))).toMatch(
      /'Idempotency-Key'\]?\s*[:=]\s*opts\.idempotencyKey/,
    );
  });
});

describe('running out of credits offers a way forward', () => {
  it('matches on the API error code, not a localised message', () => {
    const source = planScreen();
    expect(source).toContain("code === 'MHC_INSUFFICIENT_CREDITS'");
    expect(stripComments(read(PLANS_CLIENT))).toContain('class PlanApiError');
  });

  it('links to the credits screen', () => {
    const source = planScreen();
    expect(source).toContain("buildLocalePath(locale, '/app/credits')");
    expect(source).toContain('plan-screen-credits-link');
  });
});

describe('the admin plans surface configures MHC per plan', () => {
  it('offers an MHC price field labelled in credits, not currency', () => {
    const source = adminPlans();
    expect(source).toContain('formData.mhcPrice');
    expect(source).toContain('mhcPriceLabel');
    expect(enDictionary.admin.plansMgmt.mhcPriceLabel).toMatch(/MHC/);
    expect(enDictionary.admin.plansMgmt.mhcPriceLabel).not.toMatch(/EGP|£|\$/);
  });

  it('keeps an empty price distinct from zero', () => {
    const source = adminPlans();
    // Empty means unpriced (fails purchasing closed); 0 means free.
    expect(source).toContain("formData.mhcPrice === '' ? null : Number(formData.mhcPrice)");
    expect(source).toContain("mhcPrice: plan.mhcPrice === null ? '' : String(plan.mhcPrice)");
  });

  it('rejects negative amounts at the input', () => {
    const source = adminPlans();
    const priceField = source.slice(source.indexOf('formData.mhcPrice'));
    expect(priceField).toMatch(/min=\{0\}/);
  });

  it('offers purchasable and visible switches, defaulting purchasable off', () => {
    const source = adminPlans();
    expect(source).toContain('formData.isPurchasable');
    expect(source).toContain('formData.isVisible');
    expect(source).toMatch(/isPurchasable: false/);
    expect(source).toMatch(/isVisible: true/);
  });

  it('marks the retained EGP price as legacy rather than presenting it as the price', () => {
    const source = adminPlans();
    expect(source).toContain('legacyEgpPrice');
    expect(enDictionary.admin.plansMgmt.legacyEgpPrice).toMatch(/legacy|not charged/i);
  });

  it('shows a dash for an unpriced plan instead of a misleading zero', () => {
    expect(adminPlans()).toMatch(/plan\.mhcPrice === null\s*\?\s*'—'/);
  });
});

describe('dictionaries cover every new plan string in both locales', () => {
  const planKeys = [
    'confirmTextMhc',
    'confirmBalanceAfter',
    'creditsBalance',
    'durationDays',
    'insufficientCredits',
    'buyCredits',
  ] as const;

  it('defines every plan-screen string in English and Arabic', () => {
    for (const key of planKeys) {
      const en = (enDictionary.plan as Record<string, unknown>)[key];
      const ar = (arDictionary.plan as Record<string, unknown>)[key];
      expect(typeof en, `en.plan.${key}`).toBe('string');
      expect(typeof ar, `ar.plan.${key}`).toBe('string');
      expect(String(ar).length).toBeGreaterThan(0);
    }
  });

  it('defines every admin string in English and Arabic', () => {
    for (const key of [
      'mhcPriceLabel',
      'mhcPriceHint',
      'mhcPriceUnset',
      'mhcUnit',
      'durationDaysLabel',
      'purchasableLabel',
      'purchasableHint',
      'visibleHint',
      'legacyEgpPrice',
      'notPurchasable',
      'durationFromCycle',
    ]) {
      const en = (enDictionary.admin.plansMgmt as Record<string, unknown>)[key];
      const ar = (arDictionary.admin.plansMgmt as Record<string, unknown>)[key];
      expect(typeof en, `en.admin.plansMgmt.${key}`).toBe('string');
      expect(typeof ar, `ar.admin.plansMgmt.${key}`).toBe('string');
    }
  });

  it('quotes no currency in any new plan string', () => {
    for (const key of planKeys) {
      for (const dict of [enDictionary, arDictionary]) {
        const raw = (dict.plan as Record<string, string | undefined>)[key];
        expect(raw ?? '').not.toMatch(/EGP|£|\$|ج\.م/);
      }
    }
  });

  it('keeps the plan dictionaries structurally aligned', () => {
    expect(Object.keys(arDictionary.plan as Record<string, unknown>).sort()).toEqual(
      Object.keys(enDictionary.plan as Record<string, unknown>).sort(),
    );
    expect(Object.keys(arDictionary.admin.plansMgmt as Record<string, unknown>).sort()).toEqual(
      Object.keys(enDictionary.admin.plansMgmt as Record<string, unknown>).sort(),
    );
  });
});
