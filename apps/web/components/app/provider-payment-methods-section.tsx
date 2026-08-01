'use client';

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { isApiClientError } from '@/lib/auth/client';
import { useI18n } from '@/lib/i18n/context';
import {
  mhcApiClient,
  type ProviderPaymentMethod,
  type ProviderPaymentMethodType,
} from '@/lib/mhc/client';
import { METHOD_TYPE_LABELS, describePaymentMethod, type Locale } from '@/lib/mhc/presentation';

// ---------------------------------------------------------------------------
// Provider payment methods — how a customer pays this provider directly.
// ---------------------------------------------------------------------------
// The platform never holds job money, so these details are the only route by
// which a provider gets paid. At least one active method is required before an
// award can be activated, which is why this sits next to the credits balance
// rather than buried in profile settings.
// ---------------------------------------------------------------------------

const copy = {
  title: { en: 'Your payment methods', ar: 'وسائل الدفع الخاصة بك' },
  intro: {
    en: 'Customers see these only after they hire you and the job is activated. You need at least one to activate a job.',
    ar: 'يراها العملاء فقط بعد التعاقد وتفعيل العمل. تحتاج إلى وسيلة واحدة على الأقل لتفعيل أي عمل.',
  },
  none: {
    en: 'You have no payment methods yet. Add one so customers can pay you.',
    ar: 'لا توجد وسائل دفع. أضف واحدة ليتمكن العملاء من الدفع لك.',
  },
  add: { en: 'Add payment method', ar: 'إضافة وسيلة دفع' },
  save: { en: 'Save', ar: 'حفظ' },
  cancel: { en: 'Cancel', ar: 'إلغاء' },
  remove: { en: 'Remove', ar: 'حذف' },
  type: { en: 'Method', ar: 'الوسيلة' },
  label: { en: 'Label (optional)', ar: 'اسم مختصر (اختياري)' },
  accountHolder: { en: 'Account holder name', ar: 'اسم صاحب الحساب' },
  instapayAddress: { en: 'InstaPay address', ar: 'عنوان إنستاباي' },
  walletProvider: { en: 'Wallet provider', ar: 'مزود المحفظة' },
  phone: { en: 'Phone number', ar: 'رقم الهاتف' },
  bankName: { en: 'Bank name', ar: 'اسم البنك' },
  accountNumber: { en: 'Account number', ar: 'رقم الحساب' },
  iban: { en: 'IBAN', ar: 'الآيبان' },
  bankHint: {
    en: 'Provide an account number or an IBAN.',
    ar: 'أدخل رقم الحساب أو الآيبان.',
  },
  loading: { en: 'Loading…', ar: 'جارٍ التحميل…' },
};

const tr = (key: keyof typeof copy, locale: Locale): string =>
  locale === 'ar' ? copy[key].ar : copy[key].en;

const WALLET_PROVIDERS = [
  { value: 'vodafone_cash', en: 'Vodafone Cash', ar: 'فودافون كاش' },
  { value: 'etisalat_cash', en: 'Etisalat Cash', ar: 'اتصالات كاش' },
  { value: 'orange_money', en: 'Orange Money', ar: 'أورنج موني' },
  { value: 'we_pay', en: 'WE Pay', ar: 'وي باي' },
] as const;

export const ProviderPaymentMethodsSection = () => {
  const { locale } = useI18n();
  const loc: Locale = locale === 'ar' ? 'ar' : 'en';
  const { accessToken } = useAuth();

  const [methods, setMethods] = useState<ProviderPaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const result = await mhcApiClient.listPaymentMethods(accessToken);
      setMethods(result.methods);
      setError(null);
    } catch (e) {
      if (isApiClientError(e) && e.code !== 'PROVIDERS_ONLY') setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    if (!accessToken) return;
    try {
      await mhcApiClient.deletePaymentMethod(accessToken, id);
      await load();
    } catch (e) {
      if (isApiClientError(e)) setError(e.message);
    }
  };

  return (
    <div className="mhc-payouts" dir={loc === 'ar' ? 'rtl' : 'ltr'}>
      <h3 className="mhc-subtitle">{tr('title', loc)}</h3>
      <p className="mhc-note">{tr('intro', loc)}</p>

      {error && (
        <p className="mhc-error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mhc-empty">{tr('loading', loc)}</p>
      ) : methods.length === 0 ? (
        <p className="mhc-empty" data-testid="no-payment-methods">
          {tr('none', loc)}
        </p>
      ) : (
        <ul className="mhc-list" data-testid="payment-methods">
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
                    {line.label}: {line.value}
                  </span>
                ))}
              </div>
              <button type="button" className="mhc-link" onClick={() => void remove(method.id)}>
                {tr('remove', loc)}
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <PaymentMethodForm
          locale={loc}
          accessToken={accessToken ?? ''}
          onDone={() => {
            setAdding(false);
            void load();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" className="mhc-primary" onClick={() => setAdding(true)}>
          {tr('add', loc)}
        </button>
      )}
    </div>
  );
};

const PaymentMethodForm = ({
  locale,
  accessToken,
  onDone,
  onCancel,
}: {
  locale: Locale;
  accessToken: string;
  onDone: () => void;
  onCancel: () => void;
}) => {
  const [methodType, setMethodType] = useState<ProviderPaymentMethodType>('instapay');
  const [label, setLabel] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, value: string) => setFields((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // Only the fields belonging to the chosen method are sent; the server
      // strips anything else, but there is no reason to send it either.
      const details: Record<string, string> = { accountHolderName: fields.accountHolderName ?? '' };
      if (methodType === 'instapay') {
        details.instapayAddress = fields.instapayAddress ?? '';
      } else if (methodType === 'mobile_wallet') {
        details.walletProvider = fields.walletProvider ?? 'vodafone_cash';
        details.phoneNumber = fields.phoneNumber ?? '';
      } else {
        details.bankName = fields.bankName ?? '';
        if (fields.accountNumber) details.accountNumber = fields.accountNumber;
        if (fields.iban) details.iban = fields.iban;
      }

      await mhcApiClient.createPaymentMethod(accessToken, {
        methodType,
        ...(label.trim() ? { label: label.trim() } : {}),
        details,
      });
      onDone();
    } catch (e) {
      setError(
        isApiClientError(e) ? e.message : locale === 'ar' ? 'تعذر الحفظ.' : 'Could not save.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mhc-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="mhc-field">
        <span>{tr('type', locale)}</span>
        <select
          value={methodType}
          onChange={(e) => setMethodType(e.target.value as ProviderPaymentMethodType)}
        >
          {(Object.keys(METHOD_TYPE_LABELS) as ProviderPaymentMethodType[]).map((key) => (
            <option key={key} value={key}>
              {locale === 'ar' ? METHOD_TYPE_LABELS[key].ar : METHOD_TYPE_LABELS[key].en}
            </option>
          ))}
        </select>
      </label>

      <label className="mhc-field">
        <span>{tr('accountHolder', locale)}</span>
        <input
          type="text"
          value={fields.accountHolderName ?? ''}
          onChange={(e) => set('accountHolderName', e.target.value)}
          required
        />
      </label>

      {methodType === 'instapay' && (
        <label className="mhc-field">
          <span>{tr('instapayAddress', locale)}</span>
          <input
            type="text"
            placeholder="name@instapay"
            value={fields.instapayAddress ?? ''}
            onChange={(e) => set('instapayAddress', e.target.value)}
            required
          />
        </label>
      )}

      {methodType === 'mobile_wallet' && (
        <>
          <label className="mhc-field">
            <span>{tr('walletProvider', locale)}</span>
            <select
              value={fields.walletProvider ?? 'vodafone_cash'}
              onChange={(e) => set('walletProvider', e.target.value)}
            >
              {WALLET_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {locale === 'ar' ? p.ar : p.en}
                </option>
              ))}
            </select>
          </label>
          <label className="mhc-field">
            <span>{tr('phone', locale)}</span>
            <input
              type="tel"
              inputMode="numeric"
              placeholder="01012345678"
              value={fields.phoneNumber ?? ''}
              onChange={(e) => set('phoneNumber', e.target.value)}
              required
            />
          </label>
        </>
      )}

      {methodType === 'bank_transfer' && (
        <>
          <label className="mhc-field">
            <span>{tr('bankName', locale)}</span>
            <input
              type="text"
              value={fields.bankName ?? ''}
              onChange={(e) => set('bankName', e.target.value)}
              required
            />
          </label>
          <label className="mhc-field">
            <span>{tr('accountNumber', locale)}</span>
            <input
              type="text"
              value={fields.accountNumber ?? ''}
              onChange={(e) => set('accountNumber', e.target.value)}
            />
          </label>
          <label className="mhc-field">
            <span>{tr('iban', locale)}</span>
            <input
              type="text"
              placeholder="EG…"
              value={fields.iban ?? ''}
              onChange={(e) => set('iban', e.target.value)}
            />
          </label>
          <p className="mhc-note">{tr('bankHint', locale)}</p>
        </>
      )}

      <label className="mhc-field">
        <span>{tr('label', locale)}</span>
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>

      {error && (
        <p className="mhc-error" role="alert">
          {error}
        </p>
      )}

      <div className="mhc-form-actions">
        <button type="submit" className="mhc-primary" disabled={busy}>
          {tr('save', locale)}
        </button>
        <button type="button" className="mhc-link" onClick={onCancel}>
          {tr('cancel', locale)}
        </button>
      </div>
    </form>
  );
};
