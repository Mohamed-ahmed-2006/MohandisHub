import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { arDictionary } from '@/lib/i18n/dictionaries/ar';
import { enDictionary } from '@/lib/i18n/dictionaries/en';

// ---------------------------------------------------------------------------
// LC-02 — the plans screen at launch.
// ---------------------------------------------------------------------------
// Only the Free plan is available. A paid plan must read as "not yet", never as
// free and never with a price: quoting an EGP figure for something that cannot
// be bought is worse than quoting nothing, and the wallet it referred to is
// frozen. An existing paid subscriber must still see the plan they hold.
//
// These assert against the component source and the real dictionaries, which is
// what this repository's UI suites already do (see mhc-presentation.test.ts and
// advertisement-mhc-presentation.test.ts). There is no DOM renderer configured.
// ---------------------------------------------------------------------------

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string): string => readFileSync(join(WEB_ROOT, relative), 'utf8');

const PLAN_SCREEN = 'components/app/my-plan-screen.tsx';
const AVATAR_MENU = 'components/app/app-avatar-menu.tsx';

/** Strip comments so prose explaining the retired EGP path never trips a scan. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const planScreen = (): string => stripComments(read(PLAN_SCREEN));

describe('paid plans are presented as coming soon', () => {
  it('renders the shared comingSoon string instead of a price', () => {
    const source = planScreen();
    expect(source).toContain('plan-card-price--coming-soon');
    expect(source).toContain('dictionary.common.comingSoon');
  });

  it('decides availability from the paused flag, failing closed when status is absent', () => {
    const source = planScreen();
    // `!== false` and not `=== true`: an unknown status must not be read as
    // "purchasing is open".
    expect(source).toContain('status?.pausePlanSubscriptions !== false');
    expect(source).toMatch(/const notYetAvailable = paid && subscriptionsPaused/);
  });

  it('classifies a plan as paid by its price, so the free plan stays usable', () => {
    expect(planScreen()).toMatch(
      /isPaidPlan = \(plan: Plan\): boolean => Number\(plan\.price\) > 0/,
    );
  });

  it('never labels a paid plan as free', () => {
    const source = planScreen();
    // The free label is reachable only on the `!paid` branch.
    expect(source).toMatch(/paid \? plan\.price : \(d\.freePrice \?\? 'Free'\)/);
  });
});

describe('no EGP figure survives on the plans screen', () => {
  it('no longer renders a wallet balance', () => {
    const source = planScreen();
    expect(source).not.toContain('plan-screen-balance');
    expect(source).not.toMatch(/wallet\.balance/);
    expect(source).not.toMatch(/wallet\.currency/);
  });

  it('does not fetch the EGP wallet at all', () => {
    const source = planScreen();
    expect(source).not.toContain('walletApiClient');
    expect(source).not.toContain("from '@/lib/wallet/client'");
  });

  it('does not read the legacy walletBalance off the subscribe response', () => {
    expect(planScreen()).not.toContain('result.walletBalance');
  });

  it('renders no hardcoded currency literal', () => {
    const source = planScreen();
    expect(source).not.toMatch(/'EGP'/);
    expect(source).not.toMatch(/plan\.currency/);
  });
});

describe('no subscribe control is offered while subscriptions are paused', () => {
  it('gates the only subscribe button on the not-paused condition', () => {
    const source = planScreen();
    // Exactly one CTA exists, and it renders only when subscriptions are open.
    expect(source.match(/plan-card-cta/g) ?? []).toHaveLength(1);
    expect(source).toMatch(/const showSubscribeButton = !isCurrent && !subscriptionsPaused/);
    const chain = source.slice(source.indexOf('{isCurrent ? ('));
    const gateIndex = chain.indexOf('showSubscribeButton ? (');
    const ctaIndex = chain.indexOf('plan-card-cta');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(ctaIndex).toBeGreaterThan(gateIndex);
  });

  it('shows a coming-soon badge in place of the paid CTA', () => {
    expect(planScreen()).toContain('plan-card-badge--coming-soon');
  });
});

describe('an existing subscriber keeps their plan presentation', () => {
  it('still shows the held plan and its end date', () => {
    const source = planScreen();
    expect(source).toContain('plan-card--current');
    expect(source).toContain('subscriptionEndsAt');
    expect(source).toContain('getCurrentSubscription');
  });

  it('labels a held paid plan by plan name, not as a trust signal', () => {
    expect(planScreen()).toMatch(/\$\{plan\.name\} \$\{d\.planNoun \?\? 'plan'\}/);
  });

  it('still lists plan features and usage for the current plan', () => {
    const source = planScreen();
    expect(source).toContain('plan-card-features');
    expect(source).toContain('getMyUsage');
  });
});

describe('the paid-plan badge does not imply verification', () => {
  it('names the plan rather than standing alone as "Pro"', () => {
    // badgePro sits next to badgeTrustedBusiness in the avatar menu. A bare
    // "Pro" reads as a platform trust signal; this badge is granted by plan
    // purchase alone, so it has to name the plan.
    expect(enDictionary.plan.badgePro).toBe('Pro plan');
    expect(enDictionary.plan.badgePro).toMatch(/plan/i);
    expect(arDictionary.plan.badgePro).toContain('خطة');
  });

  it('uses no verification wording for either plan badge', () => {
    for (const value of [enDictionary.plan.badgePro, arDictionary.plan.badgePro]) {
      expect(value).not.toMatch(/verified|verification|موثوق|تحقق/i);
    }
  });

  it('still renders the plan badge and the trust badge as separate things', () => {
    const source = stripComments(read(AVATAR_MENU));
    expect(source).toContain('dictionary.plan.badgePro');
    expect(source).toContain('dictionary.plan.badgeTrustedBusiness');
  });
});

describe('dictionaries carry every new plan string in both locales', () => {
  it('defines comingSoon in both locales without a currency symbol', () => {
    expect(enDictionary.common.comingSoon).toMatch(/Coming soon/i);
    expect(arDictionary.common.comingSoon).toContain('قريب');
    for (const value of [enDictionary.common.comingSoon, arDictionary.common.comingSoon]) {
      expect(value).not.toMatch(/EGP|£|\$/);
    }
  });

  it('defines the free-price and plan-noun strings in both locales', () => {
    for (const dict of [enDictionary, arDictionary]) {
      expect(typeof dict.plan.freePrice).toBe('string');
      expect(String(dict.plan.freePrice).length).toBeGreaterThan(0);
      expect(typeof dict.plan.planNoun).toBe('string');
      expect(String(dict.plan.planNoun).length).toBeGreaterThan(0);
    }
    expect(enDictionary.plan.freePrice).toBe('Free');
    expect(arDictionary.plan.freePrice).toBe('مجاني');
  });

  it('keeps the two plan dictionaries structurally aligned', () => {
    const enKeys = Object.keys(enDictionary.plan as Record<string, unknown>).sort();
    const arKeys = Object.keys(arDictionary.plan as Record<string, unknown>).sort();
    expect(arKeys).toEqual(enKeys);
  });
});
