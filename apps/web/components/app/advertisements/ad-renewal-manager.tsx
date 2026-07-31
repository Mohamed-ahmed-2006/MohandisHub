'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  advertisementsApiClient,
  type AdAutoRenewPausedReason,
  type AdBillingState,
} from '@/lib/advertisements/client';
import type { Locale } from '@/lib/i18n/types';
import { formatMhc } from '@/lib/mhc/presentation';

// ---------------------------------------------------------------------------
// Renewal management for one advertisement campaign.
// ---------------------------------------------------------------------------
// The screen where an advertiser decides whether their campaign keeps buying
// weeks by itself. Three things it deliberately does NOT do:
//
//   * it never shows a state the server has not confirmed. Enabling automatic
//     renewal re-reads the billing state and renders what came back, so a
//     refusal (no bound, no consent, a bound that already passed) cannot leave
//     a toggle looking switched on;
//   * it never computes a price or a period length. The weekly price and every
//     historical snapshot come from the server, and the period is 168 hours
//     because a database CHECK says so;
//   * it never implies a refund. Every control that stops something says what
//     happens to the week already paid for.
//
// MHC is a platform credit, not money: rendered through `formatMhc`, never with
// a currency symbol, and never described per day or per campaign.
// ---------------------------------------------------------------------------

const PERIOD_HOURS = 168;

type Props = {
  advertisementId: string;
  locale: Locale;
  accessToken: string;
  creditsHref: string;
  /** Refresh the parent list once a renewal actually changes campaign state. */
  onChanged: () => void | Promise<void>;
};

export const AdRenewalManager = ({
  advertisementId,
  locale,
  accessToken,
  creditsHref,
  onChanged,
}: Props) => {
  const isAr = locale === 'ar';
  const tr = (en: string, ar: string) => (isAr ? ar : en);

  const [state, setState] = useState<AdBillingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsCredits, setNeedsCredits] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Draft configuration. Seeded from the server on every load, so a refusal
  // leaves the form showing what is actually stored.
  const [wantsAutomatic, setWantsAutomatic] = useState(false);
  const [consent, setConsent] = useState(false);
  const [maxWeeks, setMaxWeeks] = useState('');
  const [endDate, setEndDate] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await advertisementsApiClient.getBillingState(accessToken, advertisementId);
      setState(next);
      setWantsAutomatic(next.autoRenewEnabled);
      setConsent(next.autoRenewEnabled);
      setMaxWeeks(next.maximumWeeks != null ? String(next.maximumWeeks) : '');
      setEndDate(next.renewalEndDate ? next.renewalEndDate.slice(0, 16) : '');
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isAr
            ? 'تعذر تحميل إعدادات التجديد.'
            : 'Failed to load renewal settings.',
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, advertisementId, isAr]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 402 is the one failure with a specific remedy: buy credits. */
  const report = (err: unknown, fallback: string) => {
    const code = (err as { code?: string } | null)?.code;
    setNeedsCredits(code === 'MHC_INSUFFICIENT_CREDITS');
    setError(err instanceof Error ? err.message : fallback);
  };

  const fmtDate = useCallback(
    (value: string | null | undefined) =>
      value ? new Date(value).toLocaleString(isAr ? 'ar-EG' : 'en-US') : '—',
    [isAr],
  );

  /**
   * Not memoised: it depends on the locale as well as the reason, and a stale
   * paused message is a worse defect than the cost of rebuilding five strings.
   */
  const pausedCopy = ((): { label: string; hint: string } | null => {
    const reason: AdAutoRenewPausedReason | null = state?.autoRenewPausedReason ?? null;
    if (!reason) return null;
    const map: Record<AdAutoRenewPausedReason, { label: string; hint: string }> = {
      insufficient_credits: {
        label: tr('Paused — not enough credits', 'متوقف — الرصيد غير كافٍ'),
        hint: tr(
          'Nothing was charged and no week was created. Add credits, then retry to start another week.',
          'لم يتم خصم أي رصيد ولم يبدأ أي أسبوع. أضف رصيدا ثم أعد المحاولة لبدء أسبوع جديد.',
        ),
      },
      pricing_unavailable: {
        label: tr('Paused — pricing unavailable', 'متوقف — السعر غير متاح'),
        hint: tr(
          'Advertisement pricing is not available right now. Nothing was charged.',
          'سعر الإعلان غير متاح حاليا. لم يتم خصم أي رصيد.',
        ),
      },
      max_weeks_reached: {
        label: tr('Finished — maximum weeks reached', 'انتهى — تم بلوغ الحد الأقصى للأسابيع'),
        hint: tr(
          'This campaign bought every week you allowed, so automatic renewal stopped. Nothing was charged.',
          'اشترت هذه الحملة كل الأسابيع المسموح بها، لذا توقف التجديد التلقائي. لم يتم خصم أي رصيد.',
        ),
      },
      end_date_reached: {
        label: tr('Finished — end date reached', 'انتهى — تم بلوغ تاريخ الانتهاء'),
        hint: tr(
          'A full week would not fit before your end date, so automatic renewal stopped. Weeks are never shortened.',
          'لا يتسع أسبوع كامل قبل تاريخ الانتهاء، لذا توقف التجديد التلقائي. لا يتم تقصير الأسابيع أبدا.',
        ),
      },
    };
    return map[reason];
  })();

  const onSaveConfig = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    setNeedsCredits(false);
    setNotice(null);
    try {
      const parsedWeeks = maxWeeks.trim() === '' ? null : Number.parseInt(maxWeeks, 10);
      await advertisementsApiClient.setAutoRenewal(accessToken, advertisementId, {
        enabled,
        ...(enabled ? { consentAccepted: consent } : {}),
        maximumWeeks: Number.isFinite(parsedWeeks as number) ? parsedWeeks : null,
        renewalEndDate: endDate.trim() === '' ? null : new Date(endDate).toISOString(),
      });
      setNotice(
        enabled
          ? tr(
              'Automatic renewal is on. One week of credits is charged each time it renews.',
              'التجديد التلقائي مفعل. يُخصم رصيد أسبوع واحد مع كل تجديد.',
            )
          : tr(
              'Automatic renewal is off. The week you already paid for keeps running to the end.',
              'تم إيقاف التجديد التلقائي. يستمر الأسبوع المدفوع حتى نهايته.',
            ),
      );
      await load();
      await onChanged();
    } catch (err) {
      report(err, tr('Failed to save renewal settings.', 'تعذر حفظ إعدادات التجديد.'));
      // Re-read, so the form never shows a setting the server refused.
      await load();
    } finally {
      setBusy(false);
    }
  };

  const onRetry = async () => {
    setBusy(true);
    setError(null);
    setNeedsCredits(false);
    setNotice(null);
    try {
      const result = await advertisementsApiClient.retryAutoRenewal(accessToken, advertisementId);
      setNotice(
        tr(
          `Renewed. Week ${result.periodNumber} runs for ${PERIOD_HOURS} hours.`,
          `تم التجديد. الأسبوع ${result.periodNumber} يعمل لمدة ${PERIOD_HOURS} ساعة.`,
        ),
      );
      await load();
      await onChanged();
    } catch (err) {
      report(err, tr('Renewal could not be completed.', 'تعذر إتمام التجديد.'));
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading && !state) {
    return <p className="myads-ad-card-meta">{tr('Loading renewal settings…', 'جاري تحميل إعدادات التجديد…')}</p>;
  }
  if (!state) {
    return <p className="myads-renewal-warning">{error}</p>;
  }

  // A campaign that predates weekly billing has no weeks to renew, and the
  // server refuses to configure one. Say so instead of showing dead controls.
  if (!state.autoRenewalAvailable) {
    return (
      <p className="myads-ad-card-meta">
        {state.billingModel === 'legacy'
          ? tr(
              'This campaign predates weekly billing and is not renewed in credits.',
              'هذه الحملة أقدم من نظام الفوترة الأسبوعية ولا يتم تجديدها بالرصيد.',
            )
          : tr(
              'This campaign can no longer buy another week.',
              'لم يعد بإمكان هذه الحملة شراء أسبوع آخر.',
            )}
      </p>
    );
  }

  const canSubmitEnable = consent && (maxWeeks.trim() !== '' || endDate.trim() !== '');

  return (
    <section className="myads-renewal" aria-label={tr('Renewal management', 'إدارة التجديد')}>
      {error ? (
        <p className="myads-renewal-warning" role="alert">
          {error}
          {needsCredits ? (
            <>
              {' '}
              <Link href={creditsHref} className="myads-credits-link">
                {tr('Add credits', 'أضف رصيدا')}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {notice ? (
        <p className="myads-renewal-notice" role="status">
          {notice}
        </p>
      ) : null}

      {/* ---- What the campaign costs and where it stands ---- */}
      <dl className="myads-renewal-facts">
        <div>
          <dt>{tr('Renewal mode', 'وضع التجديد')}</dt>
          <dd>
            {state.renewalMode === 'automatic'
              ? tr('Automatic', 'تلقائي')
              : tr('Manual', 'يدوي')}
          </dd>
        </div>
        <div>
          <dt>{tr('Price per advertisement week', 'السعر لكل أسبوع إعلاني')}</dt>
          <dd>
            {state.weeklyMhcPrice > 0
              ? formatMhc(state.weeklyMhcPrice, locale)
              : tr('Free', 'مجاني')}
          </dd>
        </div>
        {state.creditBalance !== null ? (
          <div>
            <dt>{tr('Your credit balance', 'رصيدك')}</dt>
            <dd>{formatMhc(state.creditBalance, locale)}</dd>
          </div>
        ) : null}
        <div>
          <dt>{tr('This week started', 'بدأ هذا الأسبوع')}</dt>
          <dd>{fmtDate(state.currentPeriodStartsAt)}</dd>
        </div>
        <div>
          <dt>{tr('This week ends', 'ينتهي هذا الأسبوع')}</dt>
          <dd>{fmtDate(state.currentPeriodEndsAt)}</dd>
        </div>
        <div>
          <dt>{tr('Weeks used', 'الأسابيع المستخدمة')}</dt>
          <dd>
            {state.periodsUsed}
            {state.maximumWeeks != null ? ` / ${state.maximumWeeks}` : ''}
          </dd>
        </div>
        <div>
          <dt>{tr('Renewal end date', 'تاريخ انتهاء التجديد')}</dt>
          <dd>{fmtDate(state.renewalEndDate)}</dd>
        </div>
        <div>
          <dt>{tr('Next renewal', 'التجديد القادم')}</dt>
          <dd>
            {state.autoRenewEnabled && state.autoRenewPausedReason === null
              ? fmtDate(state.nextRenewalAt ?? state.currentPeriodEndsAt)
              : tr('Not scheduled', 'غير مجدول')}
          </dd>
        </div>
        <div>
          <dt>{tr('Your agreement', 'موافقتك')}</dt>
          <dd>
            {state.autoRenewEnabled && state.autoRenewEnabledAt
              ? tr(
                  `Given ${fmtDate(state.autoRenewEnabledAt)}`,
                  `مسجلة في ${fmtDate(state.autoRenewEnabledAt)}`,
                )
              : tr('Not given', 'غير مسجلة')}
          </dd>
        </div>
        <div>
          <dt>{tr('Last renewal outcome', 'نتيجة آخر تجديد')}</dt>
          <dd>{state.lastRenewalOutcome ? describeOutcome(state.lastRenewalOutcome, tr) : '—'}</dd>
        </div>
      </dl>

      {pausedCopy ? (
        <div className="myads-renewal-paused" role="status">
          <strong>{pausedCopy.label}</strong>
          <span>{pausedCopy.hint}</span>
          {state.autoRenewPausedReason === 'insufficient_credits' ? (
            <Link href={creditsHref} className="myads-credits-link">
              {tr('Add credits', 'أضف رصيدا')}
            </Link>
          ) : null}
          {state.canRetryAutomaticRenewal ? (
            <button
              type="button"
              className="dashboard-btn dashboard-btn--primary"
              disabled={busy}
              onClick={() => void onRetry()}
            >
              {tr('Retry renewal now', 'أعد محاولة التجديد الآن')}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* ---- The controls ---- */}
      <fieldset className="myads-fieldset myads-renewal-form">
        <legend className="myads-legend">{tr('Automatic renewal', 'التجديد التلقائي')}</legend>

        <label className="myads-renewal-toggle">
          <input
            type="checkbox"
            checked={wantsAutomatic}
            disabled={busy}
            onChange={(e) => {
              setWantsAutomatic(e.target.checked);
              if (!e.target.checked) setConsent(false);
            }}
          />
          <span>{tr('Renew this advertisement automatically every week', 'جدّد هذا الإعلان تلقائيا كل أسبوع')}</span>
        </label>

        {wantsAutomatic ? (
          <>
            <p className="myads-price-summary-note">
              {tr(
                `Set a maximum number of weeks, an end date, or both. Whichever is reached first stops the campaign. Automatic renewal is never open-ended.`,
                'حدد عدد أسابيع أقصى أو تاريخ انتهاء أو كليهما. يتوقف الإعلان عند أول حد يتحقق. التجديد التلقائي ليس مفتوحا أبدا.',
              )}
            </p>
            <div className="myads-field-row">
              <div className="myads-field">
                <label className="myads-label" htmlFor={`max-weeks-${advertisementId}`}>
                  {tr('Maximum total weeks', 'أقصى عدد أسابيع إجمالي')}
                </label>
                <input
                  id={`max-weeks-${advertisementId}`}
                  className="dashboard-input"
                  type="number"
                  min={state.periodsUsed + 1}
                  max={520}
                  inputMode="numeric"
                  value={maxWeeks}
                  disabled={busy}
                  onChange={(e) => setMaxWeeks(e.target.value)}
                />
                <span className="myads-price-summary-note">
                  {tr(
                    `Counts every week this campaign has bought, including the first. You have used ${state.periodsUsed}.`,
                    `يشمل كل أسبوع اشترته هذه الحملة بما فيها الأول. استخدمت ${state.periodsUsed}.`,
                  )}
                </span>
              </div>
              <div className="myads-field">
                <label className="myads-label" htmlFor={`end-date-${advertisementId}`}>
                  {tr('Renewal end date', 'تاريخ انتهاء التجديد')}
                </label>
                <input
                  id={`end-date-${advertisementId}`}
                  className="dashboard-input"
                  type="datetime-local"
                  value={endDate}
                  disabled={busy}
                  onChange={(e) => setEndDate(e.target.value)}
                />
                <span className="myads-price-summary-note">
                  {tr(
                    `A new week is only bought if all ${PERIOD_HOURS} hours fit before this date. There is no shortened or part-priced final week.`,
                    `لا يتم شراء أسبوع جديد إلا إذا اتسعت ${PERIOD_HOURS} ساعة كاملة قبل هذا التاريخ. لا يوجد أسبوع أخير مختصر أو بسعر جزئي.`,
                  )}
                </span>
              </div>
            </div>

            <label className="myads-renewal-toggle">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                {tr(
                  `I agree that ${PERIOD_HOURS} hours of advertising is charged from my credits once per renewed week, until one of the limits above is reached.`,
                  `أوافق على خصم رصيد مقابل ${PERIOD_HOURS} ساعة إعلانية مرة واحدة عن كل أسبوع مُجدَّد، حتى يتحقق أحد الحدين أعلاه.`,
                )}
              </span>
            </label>
          </>
        ) : null}

        <ul className="myads-renewal-terms">
          <li>
            {tr(
              `Credits are charged once per renewed week. Each week is exactly ${PERIOD_HOURS} hours.`,
              `يُخصم الرصيد مرة واحدة عن كل أسبوع مُجدَّد. كل أسبوع ${PERIOD_HOURS} ساعة بالضبط.`,
            )}
          </li>
          <li>
            {tr(
              'A future price change applies to future weeks only. A week you already bought keeps the price it was bought at.',
              'أي تغيير في السعر مستقبلا يسري على الأسابيع القادمة فقط. الأسبوع الذي اشتريته يحتفظ بسعره وقت الشراء.',
            )}
          </li>
          <li>
            {tr(
              'The week that is running now is not refundable.',
              'الأسبوع الجاري حاليا غير قابل للاسترداد.',
            )}
          </li>
          <li>
            {tr(
              'Turning automatic renewal off does not cancel the current week — it keeps running to the end.',
              'إيقاف التجديد التلقائي لا يلغي الأسبوع الحالي — يستمر حتى نهايته.',
            )}
          </li>
          <li>
            {tr(
              'Cancelling the advertisement hides it immediately and stops every future renewal, with no refund.',
              'إلغاء الإعلان يخفيه فورا ويوقف كل تجديد قادم، دون أي استرداد.',
            )}
          </li>
        </ul>

        <div className="myads-form-actions">
          {wantsAutomatic ? (
            <button
              type="button"
              className="dashboard-btn dashboard-btn--primary"
              disabled={busy || !canSubmitEnable}
              onClick={() => void onSaveConfig(true)}
            >
              {state.autoRenewEnabled
                ? tr('Update renewal limits', 'تحديث حدود التجديد')
                : tr('Turn on automatic renewal', 'تفعيل التجديد التلقائي')}
            </button>
          ) : (
            <button
              type="button"
              className="dashboard-btn dashboard-btn--primary"
              disabled={busy || (!state.autoRenewEnabled && state.renewalMode === 'manual')}
              onClick={() => void onSaveConfig(false)}
            >
              {tr('Switch to manual renewal', 'التحويل إلى التجديد اليدوي')}
            </button>
          )}
        </div>
      </fieldset>

      {/* ---- History ---- */}
      <button
        type="button"
        className="myads-renewal-history-toggle"
        aria-expanded={showHistory}
        onClick={() => setShowHistory((prev) => !prev)}
      >
        {showHistory
          ? tr('Hide renewal history', 'إخفاء سجل التجديد')
          : tr('View renewal history', 'عرض سجل التجديد')}
      </button>

      {showHistory ? (
        <div className="myads-renewal-history">
          <div className="myads-renewal-history-scroll">
            <table className="myads-renewal-table">
              <caption className="myads-price-summary-note">
                {tr(
                  'Every week this campaign has bought, and what each one cost at the time.',
                  'كل أسبوع اشترته هذه الحملة، وتكلفة كل منها وقت الشراء.',
                )}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{tr('Week', 'الأسبوع')}</th>
                  <th scope="col">{tr('From', 'من')}</th>
                  <th scope="col">{tr('To', 'إلى')}</th>
                  <th scope="col">{tr('Bought', 'طريقة الشراء')}</th>
                  <th scope="col">{tr('Status', 'الحالة')}</th>
                  <th scope="col">{tr('Credits', 'الرصيد')}</th>
                </tr>
              </thead>
              <tbody>
                {state.periods.length === 0 ? (
                  <tr>
                    <td colSpan={6}>{tr('No weeks bought yet.', 'لم يتم شراء أي أسبوع بعد.')}</td>
                  </tr>
                ) : (
                  state.periods.map((period) => (
                    <tr key={period.id}>
                      <td>{period.periodNumber}</td>
                      <td>{fmtDate(period.startsAt)}</td>
                      <td>{fmtDate(period.endsAt)}</td>
                      <td>{describeSource(period.renewalSource, tr)}</td>
                      <td>{describePeriodStatus(period.status, tr)}</td>
                      <td>
                        {period.mhcPriceSnapshot > 0
                          ? formatMhc(period.mhcPriceSnapshot, locale)
                          : tr('Free', 'مجاني')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {state.renewalHistory.length > 0 ? (
            <ul className="myads-renewal-events">
              {state.renewalHistory.map((event) => (
                <li key={event.id}>
                  <span className="myads-renewal-event-when">{fmtDate(event.createdAt)}</span>
                  <span>
                    {describeEvent(event.eventType, event.periodNumber, tr)}
                    {event.mhcCharged != null && event.mhcCharged > 0
                      ? ` — ${formatMhc(event.mhcCharged, locale)}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

type Tr = (en: string, ar: string) => string;

function describeOutcome(outcome: string, tr: Tr): string {
  const map: Record<string, string> = {
    succeeded: tr('Renewed', 'تم التجديد'),
    insufficient_credits: tr('Not enough credits', 'الرصيد غير كافٍ'),
    pricing_unavailable: tr('Pricing unavailable', 'السعر غير متاح'),
    max_weeks_reached: tr('Maximum weeks reached', 'تم بلوغ الحد الأقصى للأسابيع'),
    end_date_reached: tr('End date reached', 'تم بلوغ تاريخ الانتهاء'),
  };
  return map[outcome] ?? outcome;
}

function describeSource(source: string, tr: Tr): string {
  const map: Record<string, string> = {
    initial: tr('First week', 'الأسبوع الأول'),
    manual: tr('Renewed manually', 'تجديد يدوي'),
    automatic: tr('Renewed automatically', 'تجديد تلقائي'),
    legacy: tr('Legacy', 'قديم'),
  };
  return map[source] ?? source;
}

function describePeriodStatus(status: string, tr: Tr): string {
  const map: Record<string, string> = {
    scheduled: tr('Scheduled', 'مجدول'),
    active: tr('Running', 'يعمل'),
    expired: tr('Ended', 'انتهى'),
    cancelled: tr('Cancelled', 'ملغى'),
    failed: tr('Failed', 'فشل'),
  };
  return map[status] ?? status;
}

function describeEvent(eventType: string, periodNumber: number, tr: Tr): string {
  const map: Record<string, string> = {
    initial_activated: tr(`Week ${periodNumber} started`, `بدأ الأسبوع ${periodNumber}`),
    renewal_succeeded: tr(
      `Week ${periodNumber} renewed automatically`,
      `تم تجديد الأسبوع ${periodNumber} تلقائيا`,
    ),
    renewal_failed_insufficient_credits: tr(
      `Week ${periodNumber} not renewed — not enough credits`,
      `لم يُجدَّد الأسبوع ${periodNumber} — الرصيد غير كافٍ`,
    ),
    renewal_failed_pricing_unavailable: tr(
      `Week ${periodNumber} not renewed — pricing unavailable`,
      `لم يُجدَّد الأسبوع ${periodNumber} — السعر غير متاح`,
    ),
    manual_renewal_required: tr(
      `Week ${periodNumber - 1} ended — manual renewal needed`,
      `انتهى الأسبوع ${periodNumber - 1} — يلزم تجديد يدوي`,
    ),
    renewal_reminder: tr(
      `Reminder sent before week ${periodNumber}`,
      `تم إرسال تذكير قبل الأسبوع ${periodNumber}`,
    ),
    auto_renew_stopped_max_weeks: tr(
      'Automatic renewal stopped — maximum weeks reached',
      'توقف التجديد التلقائي — تم بلوغ الحد الأقصى للأسابيع',
    ),
    auto_renew_stopped_end_date: tr(
      'Automatic renewal stopped — end date reached',
      'توقف التجديد التلقائي — تم بلوغ تاريخ الانتهاء',
    ),
    auto_renew_enabled: tr('Automatic renewal turned on', 'تم تفعيل التجديد التلقائي'),
    auto_renew_disabled: tr('Automatic renewal turned off', 'تم إيقاف التجديد التلقائي'),
  };
  return map[eventType] ?? eventType;
}
