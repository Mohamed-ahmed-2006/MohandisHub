'use client';

import type { BusinessInvitePreview } from '@mohandishub/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { BusinessTeamApiError, businessTeamsApiClient } from '@/lib/business-teams/client';
import { captureInvitation, forgetInvitation } from '@/lib/business-teams/invitation-continuation';
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

/**
 * Backend error codes mapped onto the screen's states.
 *
 * Matching on codes rather than on message text: the messages are user-facing
 * copy that can be reworded or localised, and a screen that decides what
 * happened by searching for the substring "expired" is one rewrite away from
 * telling someone the wrong thing.
 */
const STATE_FOR_CODE: Record<string, AcceptanceState> = {
  INVITE_EXPIRED: 'expired',
  INVITE_REVOKED: 'revoked',
  INVITE_WRONG_ACCOUNT: 'wrong_account',
  INVITE_NOT_FOUND: 'error',
};

export const InvitationAcceptanceScreen = ({ locale, dictionary }: Props) => {
  const searchParams = useSearchParams();
  const { authUser, accessToken, isAuthenticated, isReady } = useAuth();

  const [state, setState] = useState<AcceptanceState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<BusinessInvitePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [acceptedTeamId, setAcceptedTeamId] = useState<string | null>(null);

  /**
   * Take the token out of the URL on arrival, and keep it for the round trip
   * through sign-in or sign-up.
   *
   * Runs once, before anything is fetched. After it, the address bar no longer
   * carries the token — so it is not in this history entry, not in the `Referer`
   * of the next navigation, and not in a screenshot — while the value itself
   * lives in `sessionStorage` for the rest of the tab's session.
   */
  useEffect(() => {
    setToken(captureInvitation(searchParams.get('token')));
    setTokenReady(true);
    // Intentionally arrival-only: re-running on every searchParams change would
    // re-capture a token this effect has just removed from the URL.
  }, []);

  const loc = (locale as Locale) || 'en';
  const isArabic = locale === 'ar';
  const tr = (en: string, ar: string) => (isArabic ? ar : en);

  /**
   * Verify the link with the server before claiming anything about it.
   *
   * Nothing on this screen asserts that an invitation is valid, who sent it or
   * which workspace it belongs to until this call has answered. Re-run once the
   * session is known, because the signed-in account is what decides the
   * `wrong_account` answer.
   */
  const loadPreview = useCallback(async () => {
    if (!token) {
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    try {
      const result = await businessTeamsApiClient.previewInvite(token, accessToken);
      setPreview(result);
      if (result.state === 'expired') setState('expired');
      else if (result.state === 'revoked') setState('revoked');
      else if (result.state === 'already_used') setState('already_used');
      else if (result.state === 'wrong_account') setState('wrong_account');
      else setState('idle');
    } catch {
      // A preview that cannot be reached is not evidence that the invitation is
      // bad. The screen stays honest and still offers the accept action, which
      // is the call that actually decides.
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [token, accessToken]);

  useEffect(() => {
    if (!isReady || !tokenReady) return;
    void loadPreview();
  }, [isReady, tokenReady, loadPreview]);

  /**
   * Stop carrying an invitation nothing can be done with.
   *
   * Every one of these is terminal: no retry, no different account and no later
   * visit changes the answer, so the token is dropped rather than left in the
   * tab to be replayed by the next navigation. `wrong_account` is deliberately
   * NOT here — signing in as the invited person is exactly the retry that works.
   */
  useEffect(() => {
    if (
      state === 'success' ||
      state === 'already_used' ||
      state === 'expired' ||
      state === 'revoked'
    ) {
      forgetInvitation();
    }
  }, [state]);

  useEffect(() => {
    if (tokenReady && !token) forgetInvitation();
    if (preview?.state === 'malformed') forgetInvitation();
  }, [tokenReady, token, preview]);

  const handleAccept = async () => {
    if (!accessToken || !token) return;
    setState('submitting');
    setErrorMessage(null);

    try {
      const result = await businessTeamsApiClient.acceptInvite(accessToken, token);
      // The workspace the caller may now open — which is what makes the link
      // below land somewhere real for an account whose primary role is not
      // `business`, and for one that already belonged to another workspace.
      setAcceptedTeamId(result.teamId);
      setState('success');
    } catch (err) {
      if (err instanceof BusinessTeamApiError) {
        const mapped = STATE_FOR_CODE[err.code];
        if (mapped && mapped !== 'error') {
          setState(mapped);
          return;
        }
      }
      setState('error');
      setErrorMessage(
        err instanceof Error && err.message
          ? err.message
          : tr('Failed to accept invitation.', 'تعذر قبول الدعوة.'),
      );
    }
  };

  const shell = (children: React.ReactNode) => (
    <div
      className="dashboard-container"
      style={{ maxWidth: '600px', margin: '3rem auto', padding: '2rem' }}
    >
      <div className="dashboard-card" style={{ textAlign: 'center' }}>
        {children}
      </div>
    </div>
  );

  if (!isReady || previewLoading) {
    return (
      <div className="dashboard-container" style={{ padding: '3rem 1rem', textAlign: 'center' }}>
        <p className="dashboard-empty">
          {dictionary.common?.loading ?? tr('Loading...', 'جاري التحميل...')}
        </p>
      </div>
    );
  }

  if (!token || preview?.state === 'malformed') {
    return shell(
      <>
        <h2 className="dashboard-card-title" style={{ fontSize: '1.5rem', color: '#e11d48' }}>
          {tr('Invalid Invitation Link', 'رابط الدعوة غير صالح')}
        </h2>
        <p className="dashboard-card-meta" style={{ marginTop: '1rem' }}>
          {tr(
            'This invitation link is not valid. Please check the link in your invitation email, or ask for a new invitation.',
            'رابط الدعوة هذا غير صالح. يرجى التحقق من الرابط في بريد الدعوة أو طلب دعوة جديدة.',
          )}
        </p>
        <div style={{ marginTop: '1.5rem' }}>
          <Link href={buildLocalePath(loc, '/')} className="dashboard-primary-btn">
            {tr('Return Home', 'العودة للرئيسية')}
          </Link>
        </div>
      </>,
    );
  }

  // What the server verified, shown only after it verified it. `malformed` has
  // already returned above, so anything reaching here names a real invitation.
  const invitationSummary = preview && (
    <div
      style={{
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '8px',
        padding: '1rem',
        marginBottom: '1.5rem',
        textAlign: 'start',
      }}
    >
      {preview.teamName && (
        <p className="dashboard-card-meta" style={{ margin: 0 }}>
          {tr('Workspace', 'مساحة العمل')}: <strong>{preview.teamName}</strong>
        </p>
      )}
      {preview.roleName && (
        <p className="dashboard-card-meta" style={{ margin: '0.35rem 0 0' }}>
          {tr('Offered role', 'الدور المعروض')}: <strong>{preview.roleName}</strong>
        </p>
      )}
      {preview.inviterDisplayName && (
        <p className="dashboard-card-meta" style={{ margin: '0.35rem 0 0' }}>
          {tr('Invited by', 'الدعوة من')}: <strong>{preview.inviterDisplayName}</strong>
        </p>
      )}
      {preview.maskedEmail && (
        <p className="dashboard-card-meta" style={{ margin: '0.35rem 0 0' }}>
          {tr('Sent to', 'مرسلة إلى')}: <strong>{preview.maskedEmail}</strong>
        </p>
      )}
      {preview.expiresAt && preview.state === 'valid' && (
        <p className="dashboard-card-meta" style={{ margin: '0.35rem 0 0' }}>
          {tr('Expires', 'تنتهي في')}:{' '}
          {new Date(preview.expiresAt).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </p>
      )}
    </div>
  );

  if (!isAuthenticated) {
    // The return path carries NO token. The token is already in this tab's
    // sessionStorage, and this screen reads it back on the way in — so the auth
    // flow's `next` parameter, the URL it produces and the history entries in
    // between never contain the bearer at all.
    const returnTo = buildLocalePath(loc, '/invitations/accept');
    const authPath = buildLocalePath(loc, '/auth');
    const loginRedirect = `${authPath}?mode=login&next=${encodeURIComponent(returnTo)}`;
    const registerRedirect = `${authPath}?mode=register&next=${encodeURIComponent(returnTo)}`;
    return shell(
      <>
        <h2 className="dashboard-card-title" style={{ fontSize: '1.5rem' }}>
          {tr('Team Invitation', 'دعوة الانضمام للفريق')}
        </h2>
        {invitationSummary}
        <p className="dashboard-card-meta" style={{ marginTop: '1rem' }}>
          {tr(
            'Sign in with the invited email address to accept this invitation.',
            'سجّل الدخول بالبريد الإلكتروني المدعو لقبول هذه الدعوة.',
          )}
        </p>
        <div
          className="dashboard-actions-row"
          style={{
            marginTop: '1.5rem',
            justifyContent: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <Link href={loginRedirect} className="dashboard-primary-btn">
            {tr('Sign In to Accept', 'تسجيل الدخول للقبول')}
          </Link>
          <Link href={registerRedirect} className="dashboard-secondary-btn">
            {tr('Create an Account', 'إنشاء حساب')}
          </Link>
        </div>
      </>,
    );
  }

  return shell(
    <>
      <h2 className="dashboard-card-title" style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
        {tr('Business Team Invitation', 'دعوة فريق العمل')}
      </h2>

      {authUser && (
        <p className="dashboard-card-meta" style={{ marginBottom: '1.5rem' }}>
          {tr('Signed in as', 'مسجل الدخول كـ')}: <strong>{authUser.email}</strong>
        </p>
      )}

      {state !== 'success' && invitationSummary}

      {state === 'idle' && (
        <>
          <p className="dashboard-card-meta" style={{ marginBottom: '1.5rem' }}>
            {tr(
              'Accepting adds this workspace to your account. Your own account type does not change.',
              'قبول الدعوة يضيف مساحة العمل إلى حسابك. لن يتغير نوع حسابك الأساسي.',
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
            role="status"
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
              {preview?.teamName
                ? tr(
                    `You are now a member of ${preview.teamName} and can access the workspace.`,
                    `أصبحت الآن عضواً في ${preview.teamName} ويمكنك الوصول إلى مساحة العمل.`,
                  )
                : tr(
                    'You are now a member of the business team and can access the workspace.',
                    'أصبحت الآن عضواً في فريق العمل ويمكنك الوصول إلى مساحة العمل.',
                  )}
            </p>
          </div>
          <Link
            href={`${buildLocalePath(loc, '/workspaces')}${
              acceptedTeamId ? `?teamId=${encodeURIComponent(acceptedTeamId)}` : ''
            }`}
            className="dashboard-primary-btn"
          >
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
          <Link href={buildLocalePath(loc, '/workspaces')} className="dashboard-primary-btn">
            {tr('Open Business Workspace', 'فتح مساحة عمل الشركات')}
          </Link>
        </div>
      )}

      {state === 'wrong_account' && (
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
              {tr('Signed in with a different account', 'أنت مسجّل الدخول بحساب مختلف')}
            </h3>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
              {preview?.maskedEmail
                ? tr(
                    `This invitation was sent to ${preview.maskedEmail}. Sign out and sign in with that address to accept it.`,
                    `أُرسلت هذه الدعوة إلى ${preview.maskedEmail}. سجّل الخروج ثم ادخل بهذا البريد لقبولها.`,
                  )
                : tr(
                    'This invitation was sent to a different email address. Sign out and sign in with that address to accept it.',
                    'أُرسلت هذه الدعوة إلى بريد إلكتروني مختلف. سجّل الخروج ثم ادخل بذلك البريد لقبولها.',
                  )}
            </p>
          </div>
          <Link href={buildLocalePath(loc, '/app')} className="dashboard-secondary-btn">
            {tr('Go to App', 'الانتقال للتطبيق')}
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
          <div className="dashboard-error" style={{ marginBottom: '1.5rem' }} role="alert">
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
    </>,
  );
};
