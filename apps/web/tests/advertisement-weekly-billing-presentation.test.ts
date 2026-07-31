import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formatMhc } from '@/lib/mhc/presentation';

// ---------------------------------------------------------------------------
// The advertisement surfaces price a WEEK, in credits, and tell the truth about
// when a provider is charged.
// ---------------------------------------------------------------------------
// This replaces advertisement-mhc-presentation.test.ts, which pinned the
// previous shape: one flat charge per campaign, taken the moment the campaign
// was created. Both of those statements are now false, so the assertions that
// encoded them are replaced rather than relaxed. What is still asserted, and
// still matters, is that no currency figure and no wallet deduction appears
// anywhere on these screens.
//
// The renderer itself is shared with the credits screen and is covered by
// mhc-presentation.test.ts; what is asserted here is the advertisement screens'
// own strings, price maths and state-driven controls.
// ---------------------------------------------------------------------------

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string): string => readFileSync(join(WEB_ROOT, relative), 'utf8');

const MY_ADS = 'components/app/advertisements/my-ads-screen.tsx';
const RENEWAL_MANAGER = 'components/app/advertisements/ad-renewal-manager.tsx';
const ADMIN_ADS = 'components/admin/admin-ads-tab.tsx';
const ADS_CLIENT = 'lib/advertisements/client.ts';
const MY_ADS_CSS = 'app/my-ads.css';

/** Strip comments, so prose about the legacy EGP path never trips these scans. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('advertisement pricing is presented as MHC credits per week', () => {
  it('renders a weekly price with no currency symbol', () => {
    const rendered = formatMhc(40, 'en');
    expect(rendered).toContain('MHC');
    expect(rendered).not.toMatch(/EGP|£|\$/);
  });

  it('renders an Arabic weekly price with no currency symbol', () => {
    const rendered = formatMhc(40, 'ar');
    expect(rendered).toContain('نقطة');
    expect(rendered).not.toMatch(/EGP|£|\$|ج\.م/);
  });

  it('prices the provider ad form through formatMhc, not a currency template', () => {
    const source = stripComments(read(MY_ADS));
    expect(source).toContain('formatMhc(weeklyPrice, locale)');
    expect(source).not.toMatch(/toFixed\(2\)\}\s*EGP/);
    expect(source).not.toContain('pricePerDay');
  });

  it('labels the price as being per advertisement week', () => {
    const source = stripComments(read(MY_ADS));
    expect(source).toMatch(/MHC per advertisement week/);
    expect(source).toMatch(/per advertisement week/);
  });

  it('no longer prices or describes a whole campaign', () => {
    const source = stripComments(read(MY_ADS));
    // The retired wording: one flat price for the campaign, charged on create.
    expect(source).not.toMatch(/campaignCost/);
    expect(source).not.toMatch(/per campaign/i);
    expect(source).not.toMatch(/Charged from your credits when the campaign is created/);
  });

  it('does not ask the provider to choose a campaign length', () => {
    const source = stripComments(read(MY_ADS));
    // A week is exactly seven days server-side; there is nothing to choose.
    expect(source).not.toContain('durationDays');
    expect(source).not.toMatch(/Duration \(days\)/);
  });

  it('never mentions a wallet deduction, and says when credits are taken', () => {
    const source = stripComments(read(MY_ADS));
    expect(source).not.toMatch(/Deducted from wallet/i);
    expect(source).toMatch(/Charged from your credits when an admin approves/);
  });

  it('states plainly that submitting is free', () => {
    const source = stripComments(read(MY_ADS));
    expect(source).toMatch(/Submitting is free/);
    expect(source).toMatch(/Nothing has been charged yet/);
  });

  it('states plainly when a week is free instead of showing 0.00', () => {
    const source = stripComments(read(MY_ADS));
    expect(source).toMatch(/No credits are charged for this advertisement week/);
    expect(source).toMatch(/tr\('Free', 'مجاني'\)/);
  });

  it('shows a historic EGP amount only where one genuinely exists', () => {
    const source = stripComments(read(MY_ADS));
    expect(source).toMatch(/Number\.parseFloat\(ad\.amount_paid \?\? '0'\) > 0/);
    expect(source).toMatch(/tr\('Paid \(legacy\)', 'المدفوع \(سابقًا\)'\)/);
  });
});

describe('the provider screen reflects moderation and billing state', () => {
  const source = stripComments(read(MY_ADS));

  it('labels every moderation status, including the new ones', () => {
    for (const status of [
      'pending_review',
      'scheduled',
      'active',
      'expired',
      'rejected',
      'cancelled',
      'paused_by_admin',
    ]) {
      expect(source).toContain(status);
    }
    expect(source).toMatch(/Pending review/);
    // The pre-moderation status is gone from the screen entirely.
    expect(source).not.toContain('pending_payment');
  });

  it('explains each billing state to the advertiser', () => {
    expect(source).toMatch(/Waiting for admin review\. Nothing has been charged\./);
    expect(source).toMatch(/Approved\. Your first week is charged when it starts\./);
    expect(source).toMatch(/Approved, but you did not have enough credits/);
    expect(source).toMatch(/The paid week ended\. Renew to run for another 7 days\./);
    expect(source).toMatch(/Cancelled\. The last paid week is not refunded\./);
  });

  it('shows the current period start and end', () => {
    expect(source).toContain('current_period_starts_at');
    expect(source).toContain('current_period_ends_at');
    expect(source).toMatch(/This week started/);
    expect(source).toMatch(/This week ends/);
  });

  it('shows a rejection reason when there is one', () => {
    expect(source).toContain('ad.rejection_reason');
    expect(source).toMatch(/tr\('Reason', 'السبب'\)/);
  });

  it('offers manual renewal only once a week has ended', () => {
    expect(source).toMatch(/needsRenewal\s*=\s*isWeekly && ad\.billing_status === 'renewal_required'/);
    expect(source).toMatch(/Renew 7 days/);
    expect(source).toMatch(/needsRenewal \?/);
  });

  it('offers a start action for a campaign approved without credits', () => {
    expect(source).toMatch(/awaitingCredits\s*=\s*isWeekly && ad\.billing_status === 'awaiting_credits'/);
    expect(source).toMatch(/Start now/);
  });

  it('offers cancellation while cancelling still means something', () => {
    expect(source).toMatch(
      /canCancel\s*=\s*isWeekly && ad\.status !== 'cancelled' && ad\.status !== 'rejected'/,
    );
    expect(source).toMatch(/Cancel ad/);
    // And says what cancelling costs, so it is not a surprise.
    expect(source).toMatch(/The current week is not refunded/);
  });

  it('links to Credits only for an insufficient-credit failure', () => {
    expect(source).toContain("code === 'MHC_INSUFFICIENT_CREDITS'");
    expect(source).toContain("buildLocalePath(locale, '/app/credits')");
    expect(source).toMatch(/needsCredits \?/);
    expect(source).toMatch(/tr\('Add credits', 'أضف رصيدا'\)/);
  });

  it('sends an Idempotency-Key on every action that can spend credits', () => {
    expect(source).toMatch(/renewAd\(accessToken, adId, crypto\.randomUUID\(\)\)/);
    expect(source).toMatch(/activateAd\(accessToken, adId, crypto\.randomUUID\(\)\)/);
    expect(source).toContain('crypto.randomUUID()');
  });
});

// ---------------------------------------------------------------------------
// Automatic renewal is real now, and the screen has to say what it costs.
// ---------------------------------------------------------------------------
// This block replaces "automatic renewal is visibly unavailable", which pinned
// the disabled "Coming soon" checkbox Wave 2F-A shipped. That control is gone
// because the backend behind it exists; the assertions that described it are
// replaced with stricter ones about what the working control must promise.
// ---------------------------------------------------------------------------
describe('the retired "Coming soon" placeholder is gone', () => {
  const source = stripComments(read(MY_ADS));

  it('no longer renders a disabled placeholder toggle', () => {
    expect(source).not.toMatch(/type="checkbox" disabled checked=\{false\} readOnly/);
    expect(source).not.toMatch(/Coming soon/);
    expect(source).not.toMatch(/قريبا/);
  });

  it('offers renewal management on the campaign instead of on the draft form', () => {
    // A standing weekly charge attaches to an approved campaign, not to a form
    // for a campaign that does not exist yet.
    expect(source).toContain('AdRenewalManager');
    expect(source).toMatch(/Manage renewal/);
  });

  it('drops the dead placeholder CSS with the placeholder', () => {
    expect(read(MY_ADS_CSS)).not.toContain('.myads-autorenew');
  });
});

describe('the renewal manager tells the truth about what a week costs', () => {
  const source = stripComments(read(RENEWAL_MANAGER));

  it('prices a week through formatMhc, never as a currency figure', () => {
    expect(source).toContain('formatMhc(state.weeklyMhcPrice, locale)');
    expect(source).toContain('formatMhc(period.mhcPriceSnapshot, locale)');
    // A bare `$` would match every template literal in the file, so the dollar
    // case is checked as a dollar AMOUNT rather than as a character.
    expect(source).not.toMatch(/\bEGP\b|£|ج\.م|\$\s?\d/);
  });

  it('never describes advertising per day or per campaign', () => {
    expect(source).not.toMatch(/per day/i);
    expect(source).not.toMatch(/per campaign/i);
    expect(source).not.toMatch(/يوميا/);
  });

  it('states the five things a provider must not be surprised by', () => {
    // Charged once per renewed week...
    expect(source).toMatch(/Credits are charged once per renewed week/);
    // ...each week is exactly 168 hours...
    expect(source).toMatch(/PERIOD_HOURS = 168/);
    expect(source).toMatch(/Each week is exactly \$\{PERIOD_HOURS\} hours/);
    // ...a price change applies forward only...
    expect(source).toMatch(/applies to future weeks only/);
    // ...the running week is not refundable...
    expect(source).toMatch(/is not refundable/);
    // ...and turning it off does not cancel that week.
    expect(source).toMatch(/does not cancel the current week/);
    expect(source).toMatch(/stops every future renewal, with no refund/);
  });

  it('says all of it in Arabic too', () => {
    expect(source).toMatch(/يُخصم الرصيد مرة واحدة عن كل أسبوع مُجدَّد/);
    expect(source).toMatch(/غير قابل للاسترداد/);
    expect(source).toMatch(/لا يلغي الأسبوع الحالي/);
    expect(source).toMatch(/دون أي استرداد/);
  });

  it('requires the consent checkbox before it will submit an enable', () => {
    // Not decoration: the button is disabled without it, and the server refuses
    // without it as well.
    expect(source).toMatch(/const canSubmitEnable = consent &&/);
    expect(source).toMatch(/consentAccepted: consent/);
  });

  it('will not submit an enable with no bound at all', () => {
    expect(source).toMatch(/maxWeeks\.trim\(\) !== '' \|\| endDate\.trim\(\) !== ''/);
  });

  it('never shows an automatic state the server has not confirmed', () => {
    // Every write re-reads the billing state, including on failure, so a
    // refusal cannot leave the toggle looking switched on.
    expect(source).toMatch(/report\(err[\s\S]{0,120}await load\(\)/);
    expect(source).toContain('setWantsAutomatic(next.autoRenewEnabled)');
  });

  it('deep-links to credits exactly where credits are the remedy', () => {
    expect(source).toMatch(/needsCredits \?/);
    expect(source).toMatch(/autoRenewPausedReason === 'insufficient_credits'/);
    expect(source).toMatch(/creditsHref/);
    expect(source).toMatch(/tr\('Add credits', 'أضف رصيدا'\)/);
  });

  it('shows every fact the provider needs to reconcile a charge', () => {
    for (const fact of [
      'Renewal mode',
      'Price per advertisement week',
      'Your credit balance',
      'This week started',
      'This week ends',
      'Weeks used',
      'Renewal end date',
      'Next renewal',
      'Your agreement',
      'Last renewal outcome',
    ]) {
      expect(source).toContain(fact);
    }
  });

  it('renders a per-week price snapshot in the history, not one live price', () => {
    expect(source).toContain('period.mhcPriceSnapshot');
    expect(source).toMatch(/what each one cost at the time/);
  });

  it('hides the controls entirely when the server would refuse them', () => {
    expect(source).toMatch(/if \(!state\.autoRenewalAvailable\)/);
    expect(source).toMatch(/predates weekly billing/);
  });

  it('keeps the paused state honest about what was charged', () => {
    expect(source).toMatch(/Nothing was charged and no week was created/);
    expect(source).toMatch(/Weeks are never shortened/);
  });
});

describe('the renewal manager is accessible and fits a phone', () => {
  const source = stripComments(read(RENEWAL_MANAGER));
  const css = read(MY_ADS_CSS);

  it('labels every input and announces its state changes', () => {
    expect(source).toMatch(/htmlFor=\{`max-weeks-\$\{advertisementId\}`\}/);
    expect(source).toMatch(/htmlFor=\{`end-date-\$\{advertisementId\}`\}/);
    expect(source).toMatch(/aria-expanded=\{showHistory\}/);
    expect(source).toMatch(/role="alert"/);
    expect(source).toMatch(/role="status"/);
    expect(source).toMatch(/aria-label=\{tr\('Renewal management'/);
  });

  it('gives the history table a caption and real column headers', () => {
    expect(source).toMatch(/<caption/);
    expect(source).toMatch(/scope="col"/);
  });

  it('scrolls the wide table inside itself rather than the page', () => {
    expect(css).toMatch(/\.myads-renewal-history-scroll\s*\{[^}]*overflow-x:\s*auto/s);
    expect(css).toMatch(/\.myads-renewal-table\s*\{[^}]*min-width/s);
  });

  it('lays the facts out fluidly and collapses them near 375px', () => {
    expect(css).toMatch(/\.myads-renewal-facts\s*\{[^}]*minmax\(9rem, 1fr\)/s);
    expect(css).toMatch(/@media \(max-width: 30rem\)/);
    // No fixed pixel widths anywhere in the renewal styles.
    const renewalCss = css.slice(css.indexOf('.myads-renewal {'));
    expect(renewalCss).not.toMatch(/width:\s*\d{3,}px/);
  });

  it('mirrors rather than re-specifies for Arabic RTL', () => {
    const renewalCss = css.slice(css.indexOf('.myads-renewal {'));
    expect(renewalCss).toContain('padding-inline-start');
    expect(renewalCss).toContain('border-inline-start');
    expect(renewalCss).toContain('text-align: start');
    // Physical left/right properties would not flip with the document.
    expect(renewalCss).not.toMatch(/\bpadding-left:/);
    expect(renewalCss).not.toMatch(/\btext-align:\s*(left|right)\b/);
  });
});

describe('provider screen stays bilingual and mobile-friendly', () => {
  const source = stripComments(read(MY_ADS));

  it('keeps every new provider-facing string bilingual', () => {
    for (const pair of [
      /tr\(\s*'Credits & timeline',\s*'الرصيد والجدول'\s*\)/,
      /tr\('Free', 'مجاني'\)/,
      /tr\('Renew 7 days', 'تجديد 7 أيام'\)/,
      /tr\('Start now', 'ابدأ الآن'\)/,
      /tr\('Cancel ad', 'إلغاء الإعلان'\)/,
      /tr\('Add credits', 'أضف رصيدا'\)/,
      /tr\('Renewals', 'التجديدات'\)/,
      /tr\('This week ends', 'ينتهي هذا الأسبوع'\)/,
    ]) {
      expect(source).toMatch(pair);
    }
  });

  it('formats dates and prices for the active locale', () => {
    expect(source).toMatch(/isAr \? 'ar-EG' : 'en-US'/);
    expect(source).toContain('formatMhc(weeklyPrice, locale)');
  });

  it('keeps the Arabic form fields right-to-left', () => {
    expect(source).toMatch(/dir="rtl"/);
  });

  it('collapses the form to one column on a narrow phone', () => {
    const css = read(MY_ADS_CSS);
    // 560px covers the 375px target width.
    expect(css).toMatch(/@media \(max-width: 560px\)/);
    expect(css).toMatch(/@media \(max-width: 560px\)\s*\{\s*\.myads-field-row\s*\{\s*grid-template-columns: 1fr;/s);
  });
});

describe('admin advertisement moderation and weekly pricing', () => {
  const source = stripComments(read(ADMIN_ADS));

  it('labels the price control as MHC per advertisement week', () => {
    expect(source).toContain('MHC per advertisement week');
    expect(source).not.toContain('Price per day (EGP)');
    expect(source).not.toContain('Price per campaign');
  });

  it('says that a price change applies to future weeks only', () => {
    expect(source).toMatch(/applies to future weeks only/);
  });

  it('binds the control to mhcPrice, not to the retired EGP field', () => {
    expect(source).toContain('controls.mhcPrice');
    expect(source).not.toContain('pricePerDay');
  });

  it('shows no EGP figure at all', () => {
    // The admin table used to render `${ad.amount_paid} EGP (legacy)`.
    expect(source).not.toMatch(/EGP/);
    expect(source).not.toContain('amount_paid');
  });

  it('defaults to the review queue and offers approve and reject', () => {
    expect(source).toMatch(/useState<string>\('pending_review'\)/);
    expect(source).toContain('adminApprove');
    expect(source).toContain('adminReject');
    expect(source).toMatch(/Awaiting review/);
  });

  it('requires a rejection reason before it can be submitted', () => {
    expect(source).toMatch(/rejectReason\.trim\(\)\.length < 3/);
    expect(source).toMatch(/The advertiser sees this reason/);
    expect(source).toMatch(/creates no billing period and charges\s*\n?\s*nothing/);
  });

  it('surfaces billing state, the current week and the scheduled start', () => {
    expect(source).toContain('BILLING_LABEL');
    expect(source).toContain('current_period_starts_at');
    expect(source).toMatch(/Scheduled start/);
    expect(source).toMatch(/Paid week running/);
    expect(source).toMatch(/Approved — advertiser has insufficient credits/);
  });

  it('invokes the due-start service rather than forcing a status', () => {
    expect(source).toContain('adminActivateDue');
    expect(source).toMatch(/Start due week/);
    // Forcing a weekly campaign live by status is refused server-side, so the
    // control is not offered here either.
    expect(source).not.toMatch(/setStatus\(ad\.id, 'active'\)/);
  });

  it('exposes no automatic-renewal control', () => {
    expect(source).not.toContain('auto_renew');
    expect(source).not.toContain('autoRenew');
  });
});

describe('advertisement API client', () => {
  const source = stripComments(read(ADS_CLIENT));

  it('types ad controls with a weekly MHC price and no EGP field', () => {
    expect(source).toMatch(/mhcPrice: number/);
    expect(source).not.toContain('pricePerDay');
  });

  it('sends an Idempotency-Key so a retried spend cannot double-charge', () => {
    expect(source).toMatch(/'Idempotency-Key': opts\.idempotencyKey/);
  });

  it('sends no duration and no price when submitting', () => {
    expect(source).not.toContain('durationDays');
    // Scoped to createAd's own body type: `AdminAdControls.mhcPrice` is a
    // legitimate read elsewhere in this file, but nothing priced may be SENT.
    const createAdBody = source.slice(
      source.indexOf('createAd: ('),
      source.indexOf('getMyAds: ('),
    );
    expect(createAdBody).not.toContain('mhcPrice');
    expect(createAdBody).not.toContain('price');
    expect(createAdBody).not.toContain('amount');
  });

  it('surfaces the error code so the screen can react to a 402', () => {
    expect(source).toMatch(/error\.code = body\.error\.code/);
  });

  it('exposes the weekly billing state, renewal and moderation calls', () => {
    for (const method of [
      'getBillingState',
      'renewAd',
      'activateAd',
      'cancelAd',
      'adminApprove',
      'adminReject',
      'adminActivateDue',
    ]) {
      expect(source).toContain(`${method}:`);
    }
  });

  it('types the billing state with immutable per-week price snapshots', () => {
    expect(source).toMatch(/mhcPriceSnapshot: number/);
    expect(source).toMatch(/weeklyMhcPrice: number/);
    expect(source).toMatch(/autoRenewalAvailable: boolean/);
  });

  it('offers only destinations the database can store', () => {
    expect(source).toMatch(/AdLinkType = 'profile' \| 'service'/);
  });
});
