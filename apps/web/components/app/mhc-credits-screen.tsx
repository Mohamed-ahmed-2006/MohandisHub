'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ProviderPaymentMethodsSection } from './provider-payment-methods-section';

import { useAuth } from '@/components/auth/auth-provider';
import { isApiClientError } from '@/lib/auth/client';
import { useI18n } from '@/lib/i18n/context';
import {
  mhcApiClient,
  type MhcCreditsSummary,
  type MhcPackage,
  type MhcPurchase,
  type MhcTransaction,
} from '@/lib/mhc/client';
import {
  describePurchaseState,
  formatMhc,
  formatPackagePrice,
  type Locale,
} from '@/lib/mhc/presentation';
import { uploadPrivateFile } from '@/lib/upload/client';

import './mhc-credits-screen.css';

// ---------------------------------------------------------------------------
// MHC credits — the provider-facing launch wallet.
// ---------------------------------------------------------------------------
// This REPLACES the legacy EGP wallet surface. MHC is a closed-loop platform
// credit: it cannot be withdrawn, transferred, or converted back to money, and
// nothing here may imply otherwise. There is deliberately no withdraw action, no
// deposit-to-balance action, and no escrow.
// ---------------------------------------------------------------------------

const PROVIDER_ROLES = new Set(['expert', 'craftsman', 'business']);

type Tab = 'overview' | 'buy' | 'history' | 'payouts';

const copy = {
  title: { en: 'Credits & payments', ar: 'الرصيد والمدفوعات' },
  balance: { en: 'Your MHC balance', ar: 'رصيدك من النقاط' },
  notCashable: {
    en: 'MHC are platform credits. They unlock jobs and paid features. They cannot be withdrawn or converted to cash.',
    ar: 'النقاط رصيد داخلي للمنصة يُستخدم لفتح الأعمال والمزايا المدفوعة. لا يمكن سحبها أو تحويلها إلى نقود.',
  },
  customersPayDirect: {
    en: 'Customers pay you directly using the payment methods you add below. MohandisHub never holds your job payments.',
    ar: 'يدفع لك العملاء مباشرة عبر وسائل الدفع التي تضيفها بالأسفل. المنصة لا تحتفظ بمبالغ أعمالك.',
  },
  tabs: {
    overview: { en: 'Overview', ar: 'نظرة عامة' },
    buy: { en: 'Buy credits', ar: 'شراء رصيد' },
    history: { en: 'History', ar: 'السجل' },
    payouts: { en: 'How you get paid', ar: 'كيف تستلم أموالك' },
  },
  packages: { en: 'Credit packages', ar: 'باقات الرصيد' },
  noPackages: {
    en: 'No credit packages are available right now. Please check back shortly.',
    ar: 'لا توجد باقات متاحة حاليًا. برجاء المحاولة لاحقًا.',
  },
  buyInstapay: { en: 'Pay by InstaPay', ar: 'الدفع عبر إنستاباي' },
  buyCrypto: { en: 'Pay by crypto', ar: 'الدفع بالعملات الرقمية' },
  instapayHelp: {
    en: 'Transfer the package price to the account below, then upload your receipt and enter the transfer reference. Credits are added after review.',
    ar: 'حوِّل قيمة الباقة إلى الحساب التالي، ثم ارفع الإيصال وأدخل رقم العملية. تُضاف النقاط بعد المراجعة.',
  },
  transferReference: { en: 'Transfer reference', ar: 'رقم العملية' },
  receipt: { en: 'Payment receipt', ar: 'إيصال الدفع' },
  submit: { en: 'Submit for review', ar: 'إرسال للمراجعة' },
  transactions: { en: 'Credit activity', ar: 'حركة الرصيد' },
  purchases: { en: 'Purchases', ar: 'عمليات الشراء' },
  noTransactions: { en: 'No credit activity yet.', ar: 'لا توجد حركات بعد.' },
  noPurchases: { en: 'No purchases yet.', ar: 'لا توجد عمليات شراء بعد.' },
  providersOnly: {
    en: 'Credits are for service providers. Your account does not need them.',
    ar: 'النقاط مخصصة لمقدمي الخدمات. حسابك لا يحتاج إليها.',
  },
  loading: { en: 'Loading…', ar: 'جارٍ التحميل…' },
  selectPackage: { en: 'Select a package', ar: 'اختر باقة' },
  continueToPayment: { en: 'Continue to payment', ar: 'المتابعة للدفع' },
  openCheckout: { en: 'Open payment page', ar: 'فتح صفحة الدفع' },
  cryptoUnavailable: {
    en: 'Crypto payment is not available right now.',
    ar: 'الدفع بالعملات الرقمية غير متاح حاليًا.',
  },
};

const t = (key: keyof typeof copy, locale: Locale): string => {
  const entry = copy[key] as { en: string; ar: string };
  return locale === 'ar' ? entry.ar : entry.en;
};

// NOTE: Client-side route guards present UX redirection; the backend API endpoints
// (e.g. GET /api/mhc/credits) remain the primary, authoritative security boundary.

export const MhcCreditsScreen = () => {
  const { locale } = useI18n();
  const loc: Locale = locale === 'ar' ? 'ar' : 'en';
  const { authUser, accessToken, isReady, isAuthenticated } = useAuth();

  const isProvider = PROVIDER_ROLES.has(authUser?.role ?? '');

  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<MhcCreditsSummary | null>(null);
  const [transactions, setTransactions] = useState<MhcTransaction[]>([]);
  const [purchases, setPurchases] = useState<MhcPurchase[]>([]);
  const [instapayAccount, setInstapayAccount] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken || !isProvider) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [creditsResult, txResult, purchaseResult, instapayResult] = await Promise.allSettled([
        mhcApiClient.getCredits(accessToken),
        mhcApiClient.getTransactions(accessToken),
        mhcApiClient.getPurchases(accessToken),
        mhcApiClient.getInstapayInfo(accessToken),
      ]);
      if (creditsResult.status === 'fulfilled') setSummary(creditsResult.value);
      if (txResult.status === 'fulfilled') setTransactions(txResult.value);
      if (purchaseResult.status === 'fulfilled') setPurchases(purchaseResult.value);
      if (instapayResult.status === 'fulfilled') {
        setInstapayAccount(instapayResult.value.destinationAccount);
      }
      if (creditsResult.status === 'rejected') {
        const reason: unknown = creditsResult.reason;
        setError(
          isApiClientError(reason) ? reason.message : loc === 'ar' ? 'تعذر التحميل' : 'Failed to load',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, isProvider, loc]);

  useEffect(() => {
    if (isReady) {
      void load();
    }
  }, [isReady, load]);

  if (!isReady) {
    return (
      <section className="mhc-screen" dir={loc === 'ar' ? 'rtl' : 'ltr'}>
        <p className="mhc-empty">{t('loading', loc)}</p>
      </section>
    );
  }

  if (!isAuthenticated || !isProvider) {
    return (
      <section className="mhc-screen" dir={loc === 'ar' ? 'rtl' : 'ltr'}>
        <p className="mhc-empty">{t('providersOnly', loc)}</p>
      </section>
    );
  }

  return (
    <section className="mhc-screen" dir={loc === 'ar' ? 'rtl' : 'ltr'}>
      <header className="mhc-header">
        <h2 className="mhc-title">{t('title', loc)}</h2>
      </header>

      <div className="mhc-balance-card" data-testid="mhc-balance">
        <span className="mhc-balance-label">{t('balance', loc)}</span>
        <strong className="mhc-balance-value">
          {loading && !summary ? t('loading', loc) : formatMhc(summary?.balance ?? 0, loc)}
        </strong>
        {/* Stated on the primary surface, not buried in help text. */}
        <p className="mhc-balance-note">{t('notCashable', loc)}</p>
      </div>

      {error && (
        <p className="mhc-error" role="alert">
          {error}
        </p>
      )}

      <nav className="mhc-tabs" role="tablist">
        {(['overview', 'buy', 'history', 'payouts'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`mhc-tab${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {loc === 'ar' ? copy.tabs[id].ar : copy.tabs[id].en}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="mhc-panel">
          <p className="mhc-note">{t('customersPayDirect', loc)}</p>
          <PurchaseList purchases={purchases.slice(0, 5)} locale={loc} />
        </div>
      )}

      {tab === 'buy' && (
        <BuyCreditsPanel
          locale={loc}
          packages={summary?.packages ?? []}
          instapayAccount={instapayAccount}
          accessToken={accessToken ?? ''}
          onPurchased={() => void load()}
        />
      )}

      {tab === 'history' && (
        <div className="mhc-panel">
          <h3 className="mhc-subtitle">{t('purchases', loc)}</h3>
          <PurchaseList purchases={purchases} locale={loc} />

          <h3 className="mhc-subtitle">{t('transactions', loc)}</h3>
          {transactions.length === 0 ? (
            <p className="mhc-empty">{t('noTransactions', loc)}</p>
          ) : (
            <ul className="mhc-list" data-testid="mhc-transactions">
              {transactions.map((tx) => {
                const delta = parseFloat(tx.balance_delta ?? '0');
                return (
                  <li key={tx.id} className="mhc-list-item">
                    <div>
                      <span className="mhc-list-title">{tx.description ?? tx.type}</span>
                      <span className="mhc-list-meta">
                        {new Date(tx.created_at).toLocaleDateString(
                          loc === 'ar' ? 'ar-EG' : 'en-GB',
                        )}
                      </span>
                    </div>
                    <span className={`mhc-delta${delta < 0 ? ' is-negative' : ' is-positive'}`}>
                      {delta > 0 ? '+' : ''}
                      {formatMhc(delta, loc)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'payouts' && (
        <div className="mhc-panel">
          <p className="mhc-note">{t('customersPayDirect', loc)}</p>
          <ProviderPaymentMethodsSection />
        </div>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------

const PurchaseList = ({ purchases, locale }: { purchases: MhcPurchase[]; locale: Locale }) => {
  if (purchases.length === 0) {
    return <p className="mhc-empty">{t('noPurchases', locale)}</p>;
  }
  return (
    <ul className="mhc-list" data-testid="mhc-purchases">
      {purchases.map((purchase) => {
        const state = describePurchaseState(purchase, locale);
        return (
          <li key={purchase.id} className="mhc-list-item mhc-purchase">
            <div>
              <span className="mhc-list-title">
                {purchase.package_name ?? purchase.order_id}
                {purchase.mhc_grant_amount
                  ? ` — ${formatMhc(purchase.mhc_grant_amount, locale)}`
                  : ''}
              </span>
              <span className="mhc-list-meta">{state.hint}</span>
            </div>
            <div className="mhc-purchase-right">
              <span className={`mhc-badge mhc-badge--${state.tone}`}>{state.label}</span>
              {purchase.status === 'pending' && purchase.checkout_url && (
                <a
                  className="mhc-link"
                  href={purchase.checkout_url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t('openCheckout', locale)}
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};

// ---------------------------------------------------------------------------

const BuyCreditsPanel = ({
  locale,
  packages,
  instapayAccount,
  accessToken,
  onPurchased,
}: {
  locale: Locale;
  packages: MhcPackage[];
  instapayAccount: Record<string, unknown>;
  accessToken: string;
  onPurchased: () => void;
}) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [rail, setRail] = useState<'instapay' | 'crypto'>('instapay');
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const activePackages = useMemo(() => packages.filter((p) => p.is_active), [packages]);

  const submitInstapay = async () => {
    if (!selected || !file || reference.trim().length < 3) return;
    setBusy(true);
    setMessage(null);
    try {
      const upload = await uploadPrivateFile(accessToken, file);
      await mhcApiClient.submitInstapayPurchase(accessToken, {
        packageId: selected,
        // `filename` carries the private_uploads row id — see the /upload/private
        // response, which sets `filename: row.id`. The API validates the proof
        // against that id and the requesting user.
        proofUploadId: upload.filename,
        transferReference: reference.trim(),
      });
      setMessage({
        tone: 'ok',
        text:
          locale === 'ar'
            ? 'تم الإرسال للمراجعة. ستُضاف النقاط بعد الاعتماد.'
            : 'Submitted for review. Credits are added once approved.',
      });
      setReference('');
      setFile(null);
      setSelected(null);
      onPurchased();
    } catch (e) {
      setMessage({
        tone: 'err',
        text: isApiClientError(e)
          ? e.message
          : locale === 'ar'
            ? 'تعذر إرسال الطلب.'
            : 'Could not submit the request.',
      });
    } finally {
      setBusy(false);
    }
  };

  const submitCrypto = async () => {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await mhcApiClient.createNowPaymentsPurchase(accessToken, {
        packageId: selected,
      });
      if (result.invoiceUrl) {
        window.open(result.invoiceUrl, '_blank', 'noopener,noreferrer');
      }
      onPurchased();
    } catch (e) {
      setMessage({
        tone: 'err',
        text: isApiClientError(e) ? e.message : t('cryptoUnavailable', locale),
      });
    } finally {
      setBusy(false);
    }
  };

  if (activePackages.length === 0) {
    return (
      <div className="mhc-panel">
        <p className="mhc-empty">{t('noPackages', locale)}</p>
      </div>
    );
  }

  return (
    <div className="mhc-panel">
      <h3 className="mhc-subtitle">{t('packages', locale)}</h3>
      <ul className="mhc-packages" data-testid="mhc-packages">
        {activePackages.map((pkg) => (
          <li key={pkg.id}>
            <button
              type="button"
              className={`mhc-package${selected === pkg.id ? ' is-selected' : ''}`}
              aria-pressed={selected === pkg.id}
              onClick={() => setSelected(pkg.id)}
            >
              <span className="mhc-package-name">
                {locale === 'ar' ? (pkg.name_ar ?? pkg.name) : pkg.name}
              </span>
              <span className="mhc-package-amount">{formatMhc(pkg.mhc_amount, locale)}</span>
              <span className="mhc-package-price">
                {formatPackagePrice(pkg.external_price_amount, pkg.external_price_currency, locale)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mhc-rails" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={rail === 'instapay'}
          className={`mhc-tab${rail === 'instapay' ? ' is-active' : ''}`}
          onClick={() => setRail('instapay')}
        >
          {t('buyInstapay', locale)}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={rail === 'crypto'}
          className={`mhc-tab${rail === 'crypto' ? ' is-active' : ''}`}
          onClick={() => setRail('crypto')}
        >
          {t('buyCrypto', locale)}
        </button>
      </div>

      {rail === 'instapay' ? (
        <div className="mhc-form">
          <p className="mhc-note">{t('instapayHelp', locale)}</p>
          {Object.keys(instapayAccount).length > 0 && (
            <dl className="mhc-account">
              {Object.entries(instapayAccount).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
          <label className="mhc-field">
            <span>{t('transferReference', locale)}</span>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              required
            />
          </label>
          <label className="mhc-field">
            <span>{t('receipt', locale)}</span>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="button"
            className="mhc-primary"
            disabled={busy || !selected || !file || reference.trim().length < 3}
            onClick={() => void submitInstapay()}
          >
            {busy ? t('loading', locale) : t('submit', locale)}
          </button>
        </div>
      ) : (
        <div className="mhc-form">
          <button
            type="button"
            className="mhc-primary"
            disabled={busy || !selected}
            onClick={() => void submitCrypto()}
          >
            {busy ? t('loading', locale) : t('continueToPayment', locale)}
          </button>
        </div>
      )}

      {!selected && <p className="mhc-empty">{t('selectPackage', locale)}</p>}
      {message && (
        <p className={message.tone === 'ok' ? 'mhc-success' : 'mhc-error'} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
};
