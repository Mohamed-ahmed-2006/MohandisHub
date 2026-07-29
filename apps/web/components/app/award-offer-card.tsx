'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { isApiClientError } from '@/lib/auth/client';
import { useI18n } from '@/lib/i18n/context';
import { buildLocalePath } from '@/lib/i18n/path';
import { mhcApiClient } from '@/lib/mhc/client';
import { formatMhc, formatTimeRemaining, type Locale } from '@/lib/mhc/presentation';

import './award-offer-card.css';

// ---------------------------------------------------------------------------
// Provider award offer — accept and pay, or decline.
// ---------------------------------------------------------------------------
// Being selected by a customer is an OFFER, not a job. The provider must accept
// and spend MHC to activate it; only then do contact details unlock. Declining
// and letting it expire both cost nothing.
// ---------------------------------------------------------------------------

export type AwardOfferCardProps = {
  bidId: string;
  needTitle?: string;
  /** ISO timestamp; `infinity` or null means the offer does not expire. */
  expiresAt?: string | null;
  onResolved?: (outcome: 'activated' | 'declined') => void;
};

const copy = {
  heading: { en: 'You were selected', ar: 'تم اختيارك' },
  body: {
    en: 'Accept and activate this job to unlock the customer’s contact details and start work.',
    ar: 'اقبل العمل وفعّله للحصول على بيانات التواصل مع العميل وبدء التنفيذ.',
  },
  required: { en: 'Activation cost', ar: 'تكلفة التفعيل' },
  balance: { en: 'Your balance', ar: 'رصيدك' },
  accept: { en: 'Accept and activate', ar: 'قبول وتفعيل' },
  decline: { en: 'Decline', ar: 'رفض' },
  declining: { en: 'Declining…', ar: 'جارٍ الرفض…' },
  activating: { en: 'Activating…', ar: 'جارٍ التفعيل…' },
  free: { en: 'Free', ar: 'مجانًا' },
  short: { en: 'You need more credits to activate this job.', ar: 'تحتاج رصيدًا أكبر لتفعيل هذا العمل.' },
  buy: { en: 'Buy credits', ar: 'شراء رصيد' },
  expiresIn: { en: 'Expires in', ar: 'ينتهي خلال' },
  expired: { en: 'This offer has expired.', ar: 'انتهت صلاحية هذا العرض.' },
  noPaymentMethod: {
    en: 'Add a payment method first so the customer knows how to pay you.',
    ar: 'أضف وسيلة دفع أولًا ليعرف العميل كيف يدفع لك.',
  },
  addPaymentMethod: { en: 'Add payment method', ar: 'إضافة وسيلة دفع' },
  activated: { en: 'Job activated. Contact details are now available.', ar: 'تم تفعيل العمل. بيانات التواصل متاحة الآن.' },
  declined: { en: 'Offer declined. No credits were charged.', ar: 'تم رفض العرض. لم يتم خصم أي رصيد.' },
  noCharge: { en: 'Declining is free.', ar: 'الرفض مجاني.' },
};

const tr = (key: keyof typeof copy, locale: Locale): string =>
  locale === 'ar' ? copy[key].ar : copy[key].en;

export const AwardOfferCard = ({
  bidId,
  needTitle,
  expiresAt,
  onResolved,
}: AwardOfferCardProps) => {
  const { locale } = useI18n();
  const loc: Locale = locale === 'ar' ? 'ar' : 'en';
  const { accessToken } = useAuth();

  const [required, setRequired] = useState<number | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [done, setDone] = useState<'activated' | 'declined' | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    const [status, credits] = await Promise.allSettled([
      mhcApiClient.getAwardActivationStatus(accessToken, bidId),
      mhcApiClient.getCredits(accessToken),
    ]);
    if (status.status === 'fulfilled') setRequired(status.value.requiredMhc);
    if (credits.status === 'fulfilled') setBalance(credits.value.balance);
  }, [accessToken, bidId]);

  useEffect(() => {
    void load();
  }, [load]);

  const remaining = formatTimeRemaining(expiresAt, loc);
  const isExpired = remaining === (loc === 'ar' ? 'منتهي' : 'Expired');
  const short = required != null && balance != null && balance < required;

  const accept = async () => {
    if (!accessToken) return;
    setBusy('accept');
    setError(null);
    try {
      await mhcApiClient.activateAward(accessToken, bidId);
      setDone('activated');
      onResolved?.('activated');
    } catch (e) {
      if (isApiClientError(e)) {
        setError({ code: e.code, message: e.message });
      } else {
        setError({ message: loc === 'ar' ? 'تعذر التفعيل.' : 'Could not activate.' });
      }
    } finally {
      setBusy(null);
    }
  };

  const decline = async () => {
    if (!accessToken) return;
    setBusy('decline');
    setError(null);
    try {
      await mhcApiClient.declineAward(accessToken, bidId);
      setDone('declined');
      onResolved?.('declined');
    } catch (e) {
      setError({
        message: isApiClientError(e) ? e.message : loc === 'ar' ? 'تعذر الرفض.' : 'Could not decline.',
      });
    } finally {
      setBusy(null);
    }
  };

  if (done) {
    return (
      <section className="award-offer award-offer--done" dir={loc === 'ar' ? 'rtl' : 'ltr'}>
        <p role="status">{done === 'activated' ? tr('activated', loc) : tr('declined', loc)}</p>
      </section>
    );
  }

  return (
    <section className="award-offer" dir={loc === 'ar' ? 'rtl' : 'ltr'} data-testid="award-offer">
      <header className="award-offer-header">
        <h3>{tr('heading', loc)}</h3>
        {needTitle && <p className="award-offer-need">{needTitle}</p>}
      </header>

      <p className="award-offer-body">{tr('body', loc)}</p>

      <dl className="award-offer-figures">
        <div>
          <dt>{tr('required', loc)}</dt>
          <dd data-testid="award-offer-required">
            {required == null ? '—' : required === 0 ? tr('free', loc) : formatMhc(required, loc)}
          </dd>
        </div>
        <div>
          <dt>{tr('balance', loc)}</dt>
          <dd data-testid="award-offer-balance">
            {balance == null ? '—' : formatMhc(balance, loc)}
          </dd>
        </div>
        {remaining && (
          <div>
            <dt>{tr('expiresIn', loc)}</dt>
            <dd data-testid="award-offer-expiry">{remaining}</dd>
          </div>
        )}
      </dl>

      {isExpired ? (
        <p className="award-offer-error" role="alert">
          {tr('expired', loc)}
        </p>
      ) : (
        <>
          {short && (
            <div className="award-offer-short" role="status">
              <p>{tr('short', loc)}</p>
              <Link className="mhc-primary" href={buildLocalePath(loc, '/app/profile#wallet-settings')}>
                {tr('buy', loc)}
              </Link>
            </div>
          )}

          {error?.code === 'NO_ACTIVE_PAYMENT_METHOD' && (
            <div className="award-offer-short" role="alert">
              <p>{tr('noPaymentMethod', loc)}</p>
              <Link className="mhc-primary" href={buildLocalePath(loc, '/app/profile#wallet-settings')}>
                {tr('addPaymentMethod', loc)}
              </Link>
            </div>
          )}

          {error && error.code !== 'NO_ACTIVE_PAYMENT_METHOD' && (
            <p className="award-offer-error" role="alert">
              {error.message}
            </p>
          )}

          <div className="award-offer-actions">
            <button
              type="button"
              className="mhc-primary"
              disabled={busy !== null || short}
              onClick={() => void accept()}
            >
              {busy === 'accept' ? tr('activating', loc) : tr('accept', loc)}
            </button>
            <button
              type="button"
              className="mhc-link"
              disabled={busy !== null}
              onClick={() => void decline()}
            >
              {busy === 'decline' ? tr('declining', loc) : tr('decline', loc)}
            </button>
          </div>
          <p className="award-offer-note">{tr('noCharge', loc)}</p>
        </>
      )}
    </section>
  );
};
