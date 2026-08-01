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
import '@/components/team/team-management.css';

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

  // Capture the bearer in tab-scoped sessionStorage, then replace the current
  // history entry so the token is absent from the visible URL, redirects,
  // referrers, screenshots and durable browser storage.
  useEffect(() => {
    setToken(captureInvitation(searchParams.get('token')));
    setTokenReady(true);
    // Arrival-only: re-running after URL scrubbing would overwrite the captured
    // value with the now-tokenless address.
  }, []);

  const loc = (locale as Locale) || 'en';
  const isArabic = locale === 'ar';
  const tr = (en: string, ar: string) => (isArabic ? ar : en);

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
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [token, accessToken]);

  useEffect(() => {
    if (!isReady || !tokenReady) return;
    void loadPreview();
  }, [isReady, tokenReady, loadPreview]);

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

  const shell = (children: React.ReactNode, testId?: string) => (
    <div
      className="team-container"
      style={{ maxWidth: '640px', margin: '3rem auto', padding: '1rem' }}
      data-testid={testId ?? 'invitation-acceptance-card'}
    >
      <div
        className="team-card"
        style={{
          padding: '2rem',
          textAlign: 'center',
          boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.15)',
        }}
      >
        {children}
      </div>
    </div>
  );

  if (!isReady || previewLoading) {
    return shell(
      <div data-testid="invitation-loading-state">
        <div style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          ⏳{' '}
          {dictionary.common?.loading ??
            tr('Loading invitation details...', 'جاري تحميل تفاصيل الدعوة...')}
        </div>
      </div>,
      'invitation-loading-shell',
    );
  }

  if (!token || preview?.state === 'malformed') {
    return shell(
      <div data-testid="invitation-malformed-state">
        <h2 style={{ fontSize: '1.4rem', color: '#ef4444', margin: '0 0 1rem 0' }}>
          🚫 {tr('Invalid Invitation Link', 'رابط الدعوة غير صالح')}
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: '0.9rem',
            lineHeight: '1.5',
            color: 'hsl(var(--muted-foreground))',
          }}
        >
          {tr(
            'This invitation link is not valid. Please check the link in your email, or ask the business administrator for a new invitation.',
            'رابط الدعوة هذا غير صالح. يرجى التحقق من الرابط في البريد الإلكتروني أو طلب دعوة جديدة من مسؤول الشركة.',
          )}
        </p>
        <div style={{ marginTop: '1.75rem' }}>
          <Link href={buildLocalePath(loc, '/')} className="team-btn-primary">
            {tr('Return Home', 'العودة للرئيسية')}
          </Link>
        </div>
      </div>,
      'invitation-malformed-shell',
    );
  }

  const invitationSummary = preview && (
    <div
      style={{
        background: 'hsl(var(--muted) / 0.3)',
        border: '1px solid hsl(var(--border))',
        borderRadius: '10px',
        padding: '1.25rem',
        marginBottom: '1.5rem',
        textAlign: 'start',
      }}
      data-testid="invitation-summary"
    >
      {preview.teamName && (
        <div style={{ marginBottom: '0.4rem', fontSize: '0.9rem' }}>
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>
            {tr('Workspace', 'مساحة العمل')}:{' '}
          </span>
          <strong className="team-text-wrap">{preview.teamName}</strong>
        </div>
      )}
      {preview.roleName && (
        <div style={{ marginBottom: '0.4rem', fontSize: '0.9rem' }}>
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>
            {tr('Offered role', 'الدور المعروض')}:{' '}
          </span>
          <strong className="team-badge team-badge--member">{preview.roleName}</strong>
        </div>
      )}
      {preview.inviterDisplayName && (
        <div style={{ marginBottom: '0.4rem', fontSize: '0.9rem' }}>
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>
            {tr('Invited by', 'الدعوة من')}:{' '}
          </span>
          <strong>{preview.inviterDisplayName}</strong>
        </div>
      )}
      {preview.maskedEmail && (
        <div style={{ marginBottom: '0.4rem', fontSize: '0.9rem' }}>
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>
            {tr('Sent to', 'مرسلة إلى')}:{' '}
          </span>
          <strong className="team-text-wrap" data-testid="invitation-masked-email">
            {preview.maskedEmail}
          </strong>
        </div>
      )}
      {preview.expiresAt && preview.state === 'valid' && (
        <div
          style={{
            fontSize: '0.85rem',
            color: 'hsl(var(--muted-foreground))',
            marginTop: '0.5rem',
          }}
        >
          <span>{tr('Expires', 'تنتهي في')}: </span>
          <span>
            {new Date(preview.expiresAt).toLocaleDateString(isArabic ? 'ar-EG' : 'en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        </div>
      )}
    </div>
  );

  if (!isAuthenticated) {
    // The token stays in this tab's sessionStorage. Authentication receives a
    // tokenless, allowlisted continuation path.
    const returnTo = buildLocalePath(loc, '/invitations/accept');
    const authPath = buildLocalePath(loc, '/auth');
    const loginRedirect = `${authPath}?mode=login&next=${encodeURIComponent(returnTo)}`;
    const registerRedirect = `${authPath}?mode=register&next=${encodeURIComponent(returnTo)}`;
    return shell(
      <div data-testid="invitation-unauthenticated-state">
        <h2 style={{ fontSize: '1.5rem', margin: '0 0 1rem 0' }}>
          🤝 {tr('Team Invitation', 'دعوة الانضمام للفريق')}
        </h2>
        {invitationSummary}
        <p
          style={{
            margin: '0 0 1.5rem 0',
            fontSize: '0.9rem',
            color: 'hsl(var(--muted-foreground))',
          }}
        >
          {tr(
            'Sign in with the invited email address to accept this invitation and join the workspace.',
            'سجّل الدخول بالبريد الإلكتروني المدعو لقبول هذه الدعوة والانضمام إلى مساحة العمل.',
          )}
        </p>
        <div
          style={{
            display: 'flex',
            gap: '0.85rem',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Link href={loginRedirect} className="team-btn-primary">
            {tr('Sign In to Accept', 'تسجيل الدخول للقبول')}
          </Link>
          <Link href={registerRedirect} className="team-btn-secondary">
            {tr('Create an Account', 'إنشاء حساب')}
          </Link>
        </div>
      </div>,
      'invitation-unauth-shell',
    );
  }

  return shell(
    <div>
      <h2 style={{ fontSize: '1.5rem', margin: '0 0 0.5rem 0' }}>
        🏢 {tr('Business Team Invitation', 'دعوة فريق العمل')}
      </h2>

      {authUser && (
        <p
          style={{
            margin: '0 0 1.25rem 0',
            fontSize: '0.88rem',
            color: 'hsl(var(--muted-foreground))',
          }}
          className="team-text-wrap"
          data-testid="signed-in-user-email"
        >
          {tr('Signed in as', 'مسجل الدخول كـ')}: <strong>{authUser.email}</strong>
        </p>
      )}

      {state !== 'success' && invitationSummary}

      {state === 'idle' && (
        <div data-testid="invitation-idle-state">
          <p
            style={{
              margin: '0 0 1.5rem 0',
              fontSize: '0.9rem',
              color: 'hsl(var(--muted-foreground))',
              lineHeight: 1.5,
            }}
          >
            {tr(
              'Accepting adds this workspace to your account. Your primary account role remains unchanged.',
              'قبول الدعوة يضيف مساحة العمل إلى حسابك. لن يتغير نوع حسابك الأساسي.',
            )}
          </p>
          <button
            type="button"
            className="team-btn-primary"
            style={{ padding: '0.75rem 2.25rem', fontSize: '1rem' }}
            onClick={() => void handleAccept()}
            data-testid="accept-invitation-btn"
          >
            {tr('Accept Invitation', 'قبول الدعوة')}
          </button>
        </div>
      )}

      {state === 'submitting' && (
        <div data-testid="invitation-submitting-state">
          <p style={{ margin: '1rem 0', fontSize: '1rem', fontWeight: 600 }}>
            ⏳ {tr('Accepting invitation...', 'جاري قبول الدعوة...')}
          </p>
        </div>
      )}

      {state === 'success' && (
        <div data-testid="invitation-success-state">
          <div
            className="team-alert team-alert--success"
            role="status"
            style={{ display: 'block', textAlign: 'center' }}
          >
            <h3 style={{ margin: 0, fontSize: '1.2rem' }}>
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
          <div style={{ marginTop: '1.5rem' }}>
            <Link
              href={`${buildLocalePath(loc, '/workspaces')}${
                acceptedTeamId ? `?teamId=${encodeURIComponent(acceptedTeamId)}` : ''
              }`}
              className="team-btn-primary"
            >
              {tr('Open Business Workspace', 'فتح مساحة عمل الشركات')}
            </Link>
          </div>
        </div>
      )}

      {state === 'already_used' && (
        <div data-testid="invitation-already-used-state">
          <div
            className="team-alert team-alert--info"
            style={{ display: 'block', textAlign: 'center' }}
          >
            <h3 style={{ margin: 0, fontSize: '1.15rem' }}>
              ℹ {tr('Invitation Already Accepted', 'تم قبول هذه الدعوة سابقاً')}
            </h3>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.88rem' }}>
              {tr(
                'This invitation link has already been used. You can access your business workspace directly.',
                'تم استخدام رابط الدعوة هذا بالفعل. يمكنك الوصول مباشرة إلى مساحة العمل.',
              )}
            </p>
          </div>
          <div style={{ marginTop: '1.5rem' }}>
            <Link href={buildLocalePath(loc, '/workspaces')} className="team-btn-primary">
              {tr('Open Business Workspace', 'فتح مساحة عمل الشركات')}
            </Link>
          </div>
        </div>
      )}

      {state === 'wrong_account' && (
        <div data-testid="invitation-wrong-account-state">
          <div
            className="team-alert team-alert--warning"
            style={{ display: 'block', textAlign: 'center' }}
          >
            <h3 style={{ margin: 0, fontSize: '1.15rem' }}>
              ⚠️ {tr('Signed in with a different account', 'أنت مسجّل الدخول بحساب مختلف')}
            </h3>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.88rem' }}>
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
          <div style={{ marginTop: '1.5rem' }}>
            <Link href={buildLocalePath(loc, '/app')} className="team-btn-secondary">
              {tr('Go to App', 'الانتقال للتطبيق')}
            </Link>
          </div>
        </div>
      )}

      {state === 'expired' && (
        <div data-testid="invitation-expired-state">
          <div
            className="team-alert team-alert--warning"
            style={{ display: 'block', textAlign: 'center' }}
          >
            <h3 style={{ margin: 0, fontSize: '1.15rem' }}>
              ⚠️ {tr('Invitation Expired', 'انتهت صلاحية الدعوة')}
            </h3>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.88rem' }}>
              {tr(
                'This invitation link has expired. Please ask the business administrator to send a new invitation.',
                'انتهت صلاحية رابط الدعوة هذا. يرجى طلب دعوة جديدة من مسؤول الشركة.',
              )}
            </p>
          </div>
          <div style={{ marginTop: '1.5rem' }}>
            <Link href={buildLocalePath(loc, '/app')} className="team-btn-secondary">
              {tr('Go to App', 'الانتقال للتطبيق')}
            </Link>
          </div>
        </div>
      )}

      {state === 'revoked' && (
        <div data-testid="invitation-revoked-state">
          <div
            className="team-alert team-alert--error"
            style={{ display: 'block', textAlign: 'center' }}
          >
            <h3 style={{ margin: 0, fontSize: '1.15rem' }}>
              🚫 {tr('Invitation Revoked', 'تم إلغاء الدعوة')}
            </h3>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.88rem' }}>
              {tr(
                'This invitation was revoked by the business team administrator.',
                'تم إلغاء هذه الدعوة بواسطة مسؤول فريق العمل.',
              )}
            </p>
          </div>
          <div style={{ marginTop: '1.5rem' }}>
            <Link href={buildLocalePath(loc, '/app')} className="team-btn-secondary">
              {tr('Go to App', 'الانتقال للتطبيق')}
            </Link>
          </div>
        </div>
      )}

      {state === 'error' && (
        <div data-testid="invitation-error-state">
          <div
            className="team-alert team-alert--error"
            role="alert"
            style={{ marginBottom: '1.5rem' }}
          >
            <span>⚠️ {errorMessage}</span>
          </div>
          <button
            type="button"
            className="team-btn-primary"
            onClick={() => void handleAccept()}
            data-testid="try-again-btn"
          >
            {tr('Try Again', 'إعادة المحاولة')}
          </button>
        </div>
      )}
    </div>,
    'invitation-accepted-shell',
  );
};
