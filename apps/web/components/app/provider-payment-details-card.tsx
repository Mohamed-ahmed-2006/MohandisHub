'use client';

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { isApiClientError } from '@/lib/auth/client';
import { useI18n } from '@/lib/i18n/context';
import { mhcApiClient, type ProviderPaymentMethod } from '@/lib/mhc/client';
import { METHOD_TYPE_LABELS, describePaymentMethod, type Locale } from '@/lib/mhc/presentation';

import './award-offer-card.css';

// ---------------------------------------------------------------------------
// Customer view: how to pay the provider, after activation.
// ---------------------------------------------------------------------------
// The platform does not hold, guarantee, or verify this payment — it happens
// directly between the customer and the provider. That is stated plainly here
// rather than left for the customer to discover.
// ---------------------------------------------------------------------------

const copy = {
  title: { en: 'How to pay your provider', ar: 'كيفية الدفع لمقدم الخدمة' },
  disclaimer: {
    en: 'You pay the provider directly. MohandisHub does not hold, guarantee, or verify this payment.',
    ar: 'تدفع مباشرة لمقدم الخدمة. المنصة لا تحتفظ بالمبلغ ولا تضمنه ولا تتحقق منه.',
  },
  locked: {
    en: 'Payment details become available once the provider activates the job.',
    ar: 'تظهر بيانات الدفع بعد أن يقوم مقدم الخدمة بتفعيل العمل.',
  },
  none: {
    en: 'The provider has not published any payment details yet. Ask them in the chat.',
    ar: 'لم ينشر مقدم الخدمة بيانات دفع بعد. تواصل معه عبر المحادثة.',
  },
  loading: { en: 'Loading…', ar: 'جارٍ التحميل…' },
  copy: { en: 'Copy', ar: 'نسخ' },
  copied: { en: 'Copied', ar: 'تم النسخ' },
};

const tr = (key: keyof typeof copy, locale: Locale): string =>
  locale === 'ar' ? copy[key].ar : copy[key].en;

export const ProviderPaymentDetailsCard = ({ bidId }: { bidId: string }) => {
  const { locale } = useI18n();
  const loc: Locale = locale === 'ar' ? 'ar' : 'en';
  const { accessToken } = useAuth();

  const [methods, setMethods] = useState<ProviderPaymentMethod[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const result = await mhcApiClient.getDisclosedPaymentDetails(accessToken, bidId);
      setMethods(result.methods);
      setLocked(false);
      setError(null);
    } catch (e) {
      if (isApiClientError(e) && e.status === 402) {
        // Not yet activated — expected, not an error state.
        setLocked(true);
      } else if (isApiClientError(e)) {
        setError(e.message);
      } else {
        setError(loc === 'ar' ? 'تعذر التحميل.' : 'Could not load.');
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, bidId, loc]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="mhc-empty">{tr('loading', loc)}</p>;

  if (locked) {
    return (
      <section
        className="award-offer"
        dir={loc === 'ar' ? 'rtl' : 'ltr'}
        data-testid="payment-locked"
      >
        <p className="mhc-note">{tr('locked', loc)}</p>
      </section>
    );
  }

  if (error) {
    return (
      <p className="mhc-error" role="alert">
        {error}
      </p>
    );
  }

  return (
    <section
      className="award-offer"
      dir={loc === 'ar' ? 'rtl' : 'ltr'}
      data-testid="payment-details"
    >
      <h3>{tr('title', loc)}</h3>
      {/* Stated up front: the platform is not a party to this payment. */}
      <p className="mhc-note">{tr('disclaimer', loc)}</p>

      {!methods || methods.length === 0 ? (
        <p className="mhc-empty">{tr('none', loc)}</p>
      ) : (
        <ul className="mhc-list">
          {methods.map((method) => (
            <li key={method.id} className="mhc-list-item">
              <div>
                <span className="mhc-list-title">
                  {loc === 'ar'
                    ? METHOD_TYPE_LABELS[method.methodType].ar
                    : METHOD_TYPE_LABELS[method.methodType].en}
                  {method.label ? ` — ${method.label}` : ''}
                </span>
                {describePaymentMethod(method, loc).map((line) => (
                  <span key={line.label} className="mhc-list-meta">
                    {line.label}: <strong>{line.value}</strong>
                    <button
                      type="button"
                      className="mhc-link"
                      onClick={() => {
                        void navigator.clipboard?.writeText(line.value);
                        setCopiedKey(`${method.id}:${line.label}`);
                      }}
                    >
                      {copiedKey === `${method.id}:${line.label}`
                        ? tr('copied', loc)
                        : tr('copy', loc)}
                    </button>
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
