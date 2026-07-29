import type { MhcPurchase, MhcPurchaseStatus, ProviderPaymentMethod } from './client';

// ---------------------------------------------------------------------------
// Pure presentation logic for MHC surfaces.
// ---------------------------------------------------------------------------
// Kept out of the components so the rules that matter — how a purchase state is
// described, and that MHC is never labelled as money — are directly testable.
// ---------------------------------------------------------------------------

export type Locale = 'en' | 'ar';

export type PurchaseStateTone = 'pending' | 'success' | 'error' | 'neutral';

export type PurchaseStateView = {
  tone: PurchaseStateTone;
  label: string;
  /** What the provider should understand or do next. */
  hint: string;
};

/**
 * Map a purchase to what the provider sees.
 *
 * `provider_status` is checked before `status` for the review cases, because a
 * NOWPayments payment that settled for the wrong amount stays `pending` while
 * carrying `amount_mismatch_review` — the provider needs to know it is with a
 * human, not that it is still waiting for payment.
 */
export function describePurchaseState(
  purchase: Pick<MhcPurchase, 'status' | 'provider' | 'provider_status' | 'rejection_reason'>,
  locale: Locale,
): PurchaseStateView {
  const ar = locale === 'ar';

  if (purchase.provider_status === 'amount_mismatch_review') {
    return {
      tone: 'pending',
      label: ar ? 'قيد المراجعة' : 'Under review',
      hint: ar
        ? 'المبلغ المستلم لا يطابق سعر الباقة. يراجع الفريق العملية يدويًا.'
        : 'The amount received does not match the package price. Our team is reviewing it.',
    };
  }

  switch (purchase.status) {
    case 'paid':
      return {
        tone: 'success',
        label: ar ? 'تم الاعتماد' : 'Approved',
        hint: ar ? 'تمت إضافة الرصيد إلى حسابك.' : 'The credits were added to your account.',
      };
    case 'pending_review':
      return {
        tone: 'pending',
        label: ar ? 'قيد المراجعة' : 'Under review',
        hint: ar
          ? 'استلمنا إيصالك. تتم المراجعة يدويًا قبل إضافة الرصيد.'
          : 'We have your receipt. Credits are added after a manual review.',
      };
    case 'pending':
      return {
        tone: 'pending',
        label: ar ? 'في انتظار الدفع' : 'Awaiting payment',
        hint:
          purchase.provider === 'nowpayments'
            ? ar
              ? 'أكمل الدفع عبر صفحة الدفع لإتمام العملية.'
              : 'Complete the payment on the checkout page to finish.'
            : ar
              ? 'في انتظار تأكيد الدفع.'
              : 'Waiting for payment confirmation.',
      };
    case 'rejected':
      return {
        tone: 'error',
        label: ar ? 'مرفوض' : 'Rejected',
        hint:
          purchase.rejection_reason ??
          (ar ? 'لم يتم اعتماد هذه العملية.' : 'This purchase was not approved.'),
      };
    case 'failed':
      return {
        tone: 'error',
        label: ar ? 'فشل' : 'Failed',
        hint: ar ? 'لم تكتمل عملية الدفع.' : 'The payment did not complete.',
      };
    case 'expired':
      return {
        tone: 'error',
        label: ar ? 'منتهي الصلاحية' : 'Expired',
        hint: ar ? 'انتهت صلاحية طلب الدفع.' : 'The payment request expired.',
      };
    case 'cancelled':
      return {
        tone: 'neutral',
        label: ar ? 'ملغي' : 'Cancelled',
        hint: ar ? 'تم إلغاء هذا الطلب.' : 'This request was cancelled.',
      };
    default:
      return {
        tone: 'neutral',
        label: purchase.status,
        hint: '',
      };
  }
}

/** Purchase states that still need something to happen. */
export function isPurchaseInFlight(status: MhcPurchaseStatus): boolean {
  return status === 'pending' || status === 'pending_review';
}

/**
 * Format an MHC amount. Deliberately suffixed with the MHC label and NEVER with
 * a currency symbol: MHC is a non-cashable access credit, and presenting it like
 * money would misrepresent what a provider is holding.
 */
export function formatMhc(amount: number | string, locale: Locale): string {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  const safe = Number.isFinite(value) ? value : 0;
  const formatted = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(safe);
  return locale === 'ar' ? `${formatted} نقطة` : `${formatted} MHC`;
}

/** The real-money price of a package — this one IS money, so it carries a currency. */
export function formatPackagePrice(
  amount: string | number,
  currency: string,
  locale: Locale,
): string {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', {
    style: 'currency',
    currency: currency || 'EGP',
    maximumFractionDigits: 0,
  }).format(safe);
}

/**
 * Time remaining on an award offer, or null when it never expires.
 *
 * `awardBid` stores the sentinel 'infinity' when an admin sets the acceptance
 * window to 0 hours, so that value means "no deadline", not "invalid date".
 */
export function formatTimeRemaining(
  expiresAt: string | null | undefined,
  locale: Locale,
  now: number = Date.now(),
): string | null {
  if (!expiresAt || expiresAt === 'infinity') return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return locale === 'ar' ? 'منتهي' : 'Expired';
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return locale === 'ar' ? `${days} يوم` : `${days}d`;
  }
  if (hours >= 1) return locale === 'ar' ? `${hours} ساعة` : `${hours}h ${minutes}m`;
  return locale === 'ar' ? `${minutes} دقيقة` : `${minutes}m`;
}

export const METHOD_TYPE_LABELS: Record<
  ProviderPaymentMethod['methodType'],
  { en: string; ar: string }
> = {
  instapay: { en: 'InstaPay', ar: 'إنستاباي' },
  mobile_wallet: { en: 'Mobile wallet', ar: 'محفظة إلكترونية' },
  bank_transfer: { en: 'Bank transfer', ar: 'تحويل بنكي' },
};

/** Human-readable lines for a disclosed payment method, in display order. */
export function describePaymentMethod(
  method: ProviderPaymentMethod,
  locale: Locale,
): Array<{ label: string; value: string }> {
  const ar = locale === 'ar';
  const d = method.details;
  const str = (key: string): string | null => {
    const v = d[key];
    return typeof v === 'string' && v.trim().length > 0 ? v : null;
  };
  const lines: Array<{ label: string; value: string }> = [];
  const push = (label: string, value: string | null) => {
    if (value) lines.push({ label, value });
  };

  push(ar ? 'اسم صاحب الحساب' : 'Account holder', str('accountHolderName'));

  switch (method.methodType) {
    case 'instapay':
      push(ar ? 'عنوان إنستاباي' : 'InstaPay address', str('instapayAddress'));
      break;
    case 'mobile_wallet': {
      const provider = str('walletProvider');
      const providerLabels: Record<string, { en: string; ar: string }> = {
        vodafone_cash: { en: 'Vodafone Cash', ar: 'فودافون كاش' },
        etisalat_cash: { en: 'Etisalat Cash', ar: 'اتصالات كاش' },
        orange_money: { en: 'Orange Money', ar: 'أورنج موني' },
        we_pay: { en: 'WE Pay', ar: 'وي باي' },
      };
      push(
        ar ? 'المحفظة' : 'Wallet',
        provider ? (ar ? providerLabels[provider]?.ar : providerLabels[provider]?.en) ?? provider : null,
      );
      push(ar ? 'رقم الهاتف' : 'Phone number', str('phoneNumber'));
      break;
    }
    case 'bank_transfer':
      push(ar ? 'البنك' : 'Bank', str('bankName'));
      push(ar ? 'رقم الحساب' : 'Account number', str('accountNumber'));
      push('IBAN', str('iban'));
      push(ar ? 'الفرع' : 'Branch', str('branch'));
      break;
  }

  return lines;
}
