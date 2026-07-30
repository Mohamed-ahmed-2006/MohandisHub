'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { businessTeamsApiClient } from '@/lib/business-teams/client';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type Props = {
  locale: string;
  dictionary: Dictionary;
};

type AcceptanceState =
  | 'idle'
  | 'submitting'
  | 'success'
  | 'expired'
  | 'revoked'
  | 'already_used'
  | 'wrong_account'
  | 'error';

export const InvitationAcceptanceScreen = ({ locale, dictionary }: Props) => {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const { authUser, accessToken, isAuthenticated, isReady } = useAuth();

  const [state, setState] = useState<AcceptanceState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loc = (locale as Locale) || 'en';
  const isArabic = locale === 'ar';
  const tr = (en: string, ar: string) => (isArabic ? ar : en);

  const handleAccept = async () => {
    if (!accessToken || !token) return;
    setState('submitting');
    setErrorMessage(null);

    try {
      await businessTeamsApiClient.acceptInvite(accessToken, token);
      setState('success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();

      if (lower.includes('expired')) {
        setState('expired');
      } else if (lower.includes('revoked')) {
        setState('revoked');
      } else if (lower.includes('already') || lower.includes('accepted')) {
        setState('already_used');
      } else {
        setState('error');
        setErrorMessage(msg || tr('Failed to accept invitation.', 'تعذر قبول الدعوة.'));
      }
    }
  };

  if (!isReady) {
    return (
      <div className="dashboard-container" style={{ padding: '3rem 1rem', textAlign: 'center' }}>
        <p className="dashboard-empty">{dictionary.common?.loading ?? tr('Loading...', 'جاري التحميل...')}</p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="dashboard-container" style={{ maxWidth: '600px', margin: '3rem auto', padding: '2rem' }}>
        <div className="dashboard-card" style={{ textAlign: 'center' }}>
          <h2 className="dashboard-card-title" style={{ fontSize: '1.5rem', color: '#e11d48' }}>
            {tr('Invalid Invitation Link', 'رابط الدعوة غير صالح')}
          </h2>
          <p className="dashboard-card-meta" style={{ marginTop: '1rem' }}>
            {tr(
              'No invitation token was provided in the URL. Please check your invitation email link.',
              'لم يتم توفير رمز دعوة في الرابط. يرجى التحقق من رابط بريد الدعوة.',
            )}
          </p>
          <div style={{ marginTop: '1.5rem' }}>
            <Link href={buildLocalePath(loc, '/')} className="dashboard-primary-btn">
              {tr('Return Home', 'العودة للرئيسية')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    const loginRedirect = buildLocalePath(loc, `/login?redirect=${encodeURIComponent(`/invitations/accept?token=${token}`)}`);
    return (
      <div className="dashboard-container" style={{ maxWidth: '600px', margin: '3rem auto', padding: '2rem' }}>
        <div className="dashboard-card" style={{ textAlign: 'center' }}>
          <h2 className="dashboard-card-title" style={{ fontSize: '1.5rem' }}>
            {tr('Team Invitation', 'دعوة الانضمام للفريق')}
          </h2>
          <p className="dashboard-card-meta" style={{ marginTop: '1rem' }}>
            {tr(
              'You have been invited to join a MohandisHub business team. Please sign in to accept.',
              'لقد تم دعوتك للانضمام إلى فريق عمل MohandisHub. يرجى تسجيل الدخول للقبول.',
            )}
          </p>
          <div style={{ marginTop: '1.5rem' }}>
            <Link href={loginRedirect} className="dashboard-primary-btn">
              {tr('Sign In to Accept', 'تسجيل الدخول للقبول')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container" style={{ maxWidth: '600px', margin: '3rem auto', padding: '2rem' }}>
      <div className="dashboard-card" style={{ textAlign: 'center' }}>
        <h2 className="dashboard-card-title" style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
          {tr('Business Team Invitation', 'دعوة فريق العمل')}
        </h2>

        {authUser && (
          <p className="dashboard-card-meta" style={{ marginBottom: '1.5rem' }}>
            {tr('Signed in as', 'مسجل الدخول كـ')}: <strong>{authUser.email}</strong>
          </p>
        )}

        {state === 'idle' && (
          <>
            <p className="dashboard-card-meta" style={{ marginBottom: '1.5rem' }}>
              {tr(
                'Click below to join the business workspace and access shared team tools.',
                'اضغط أدناه للانضمام إلى مساحة العمل والوصول إلى أدوات الفريق المشتركة.',
              )}
            </p>
            <button
              type="button"
              className="dashboard-primary-btn"
              style={{ padding: '0.75rem 2rem', fontSize: '1rem' }}
              onClick={() => void handleAccept()}
            >
              {tr('Accept Invitation', 'قبول الدعوة')}
            </button>
          </>
        )}

        {state === 'submitting' && (
          <p className="dashboard-empty">{tr('Accepting invitation...', 'جاري قبول الدعوة...')}</p>
        )}

        {state === 'success' && (
          <div>
            <div
              style={{
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                color: '#10b981',
                padding: '1rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                ✓ {tr('Invitation Accepted!', 'تم قبول الدعوة بنجاح!')}
              </h3>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
                {tr(
                  'You are now a member of the business team and can access the workspace.',
                  'أصبحت الآن عضواً في فريق العمل ويمكنك الوصول إلى مساحة العمل.',
                )}
              </p>
            </div>
            <Link href={buildLocalePath(loc, '/app')} className="dashboard-primary-btn">
              {tr('Open Business Workspace', 'فتح مساحة عمل الشركات')}
            </Link>
          </div>
        )}

        {state === 'already_used' && (
          <div>
            <div
              style={{
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                color: '#3b82f6',
                padding: '1rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                ℹ {tr('Invitation Already Accepted', 'تم قبول هذه الدعوة سابقاً')}
              </h3>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
                {tr(
                  'This invitation link has already been used. You can directly access your business workspace.',
                  'تم استخدام رابط الدعوة هذا بالفعل. يمكنك الوصول مباشرة إلى مساحة العمل.',
                )}
              </p>
            </div>
            <Link href={buildLocalePath(loc, '/app')} className="dashboard-primary-btn">
              {tr('Open Business Workspace', 'فتح مساحة عمل الشركات')}
            </Link>
          </div>
        )}

        {state === 'expired' && (
          <div>
            <div
              style={{
                background: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                color: '#f59e0b',
                padding: '1rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                ⚠️ {tr('Invitation Expired', 'انتهت صلاحية الدعوة')}
              </h3>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
                {tr(
                  'This invitation link has expired. Please ask the business administrator to send a new invite.',
                  'انتهت صلاحية رابط الدعوة هذا. يرجى طلب دعوة جديدة من مسؤول الشركة.',
                )}
              </p>
            </div>
            <Link href={buildLocalePath(loc, '/app')} className="dashboard-secondary-btn">
              {tr('Go to App', 'الانتقال للتطبيق')}
            </Link>
          </div>
        )}

        {state === 'revoked' && (
          <div>
            <div
              style={{
                background: 'rgba(225, 29, 72, 0.1)',
                border: '1px solid rgba(225, 29, 72, 0.3)',
                color: '#e11d48',
                padding: '1rem',
                borderRadius: '8px',
                marginBottom: '1.5rem',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                🚫 {tr('Invitation Revoked', 'تم إلغاء الدعوة')}
              </h3>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
                {tr(
                  'This invitation was revoked by the business team administrator.',
                  'تم إلغاء هذه الدعوة بواسطة مسؤول فريق العمل.',
                )}
              </p>
            </div>
            <Link href={buildLocalePath(loc, '/app')} className="dashboard-secondary-btn">
              {tr('Go to App', 'الانتقال للتطبيق')}
            </Link>
          </div>
        )}

        {state === 'error' && (
          <div>
            <div className="dashboard-error" style={{ marginBottom: '1.5rem' }}>
              {errorMessage}
            </div>
            <button
              type="button"
              className="dashboard-primary-btn"
              onClick={() => void handleAccept()}
            >
              {tr('Try Again', 'إعادة المحاولة')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
