'use client';

import type { BusinessWorkspaceSummary } from '@mohandishub/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { BusinessTeamPanel } from '@/components/app/business-team-panel';
import { useAuth } from '@/components/auth/auth-provider';
import { businessTeamsApiClient } from '@/lib/business-teams/client';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type Props = {
  locale: string;
  dictionary: Dictionary;
};

/**
 * The business workspace screen, reachable by anyone who belongs to one.
 *
 * The team panel used to live only inside `BusinessDashboard`, which is rendered
 * only when the primary account role is `business`. An expert or craftsman could
 * accept an invitation, be told they were now a member, follow the link, and
 * find nothing — membership was real and unreachable. This route asks the server
 * which workspaces the account can open and renders the panel for the chosen
 * one, so the account role stops deciding whether a membership is visible.
 *
 * It is also where a person who belongs to more than one workspace picks. The
 * `teamId` is a selector, never a grant: the API matches it against the caller's
 * own memberships and refuses anything else.
 */
export const WorkspaceScreen = ({ locale, dictionary }: Props) => {
  const searchParams = useSearchParams();
  const { accessToken, isAuthenticated, isReady } = useAuth();

  const [workspaces, setWorkspaces] = useState<BusinessWorkspaceSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loc = (locale as Locale) || 'en';
  const isArabic = locale === 'ar';
  const tr = (en: string, ar: string) => (isArabic ? ar : en);

  const requestedTeamId = searchParams.get('teamId');

  const load = useCallback(async () => {
    if (!accessToken) {
      setWorkspaces([]);
      setSelected(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await businessTeamsApiClient.listWorkspaces(accessToken);
      setWorkspaces(result.workspaces);
      // A requested workspace is honoured only if it is genuinely one of theirs.
      // The server would refuse otherwise; checking here avoids rendering a
      // panel that is about to error.
      const requestedIsMine = result.workspaces.some((w) => w.teamId === requestedTeamId);
      setSelected(requestedIsMine ? requestedTeamId : result.defaultTeamId);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tr('Could not load your workspaces.', 'تعذر تحميل مساحات العمل.'),
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, requestedTeamId]);

  useEffect(() => {
    if (!isReady) return;
    void load();
  }, [isReady, load]);

  if (!isReady || loading) {
    return (
      <div className="dashboard-container" style={{ padding: '3rem 1rem', textAlign: 'center' }}>
        <p className="dashboard-empty">
          {dictionary.common?.loading ?? tr('Loading...', 'جاري التحميل...')}
        </p>
      </div>
    );
  }

  if (!isAuthenticated || !accessToken) {
    const returnTo = buildLocalePath(loc, '/workspaces');
    return (
      <div
        className="dashboard-container"
        style={{ maxWidth: '600px', margin: '3rem auto', padding: '2rem' }}
      >
        <div className="dashboard-card" style={{ textAlign: 'center' }}>
          <h2 className="dashboard-card-title" style={{ fontSize: '1.5rem' }}>
            {tr('Business Workspaces', 'مساحات عمل الشركات')}
          </h2>
          <p className="dashboard-card-meta" style={{ marginTop: '1rem' }}>
            {tr('Sign in to open your workspaces.', 'سجّل الدخول لفتح مساحات العمل.')}
          </p>
          <div style={{ marginTop: '1.5rem' }}>
            <Link
              href={`${buildLocalePath(loc, '/auth')}?mode=login&next=${encodeURIComponent(returnTo)}`}
              className="dashboard-primary-btn"
            >
              {tr('Sign In', 'تسجيل الدخول')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-container" style={{ padding: '2rem 1rem' }}>
        <p className="dashboard-error" role="alert">
          {error}
        </p>
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div
        className="dashboard-container"
        style={{ maxWidth: '600px', margin: '3rem auto', padding: '2rem' }}
      >
        <div className="dashboard-card" style={{ textAlign: 'center' }}>
          <h2 className="dashboard-card-title" style={{ fontSize: '1.35rem' }}>
            {tr('No business workspaces yet', 'لا توجد مساحات عمل بعد')}
          </h2>
          <p className="dashboard-card-meta" style={{ marginTop: '1rem' }}>
            {tr(
              'You are not a member of any business team. A Team Owner or Admin can invite you by email.',
              'أنت لست عضواً في أي فريق عمل. يمكن لمالك أو مسؤول دعوتك عبر البريد الإلكتروني.',
            )}
          </p>
          <div style={{ marginTop: '1.5rem' }}>
            <Link href={buildLocalePath(loc, '/app')} className="dashboard-secondary-btn">
              {tr('Go to App', 'الانتقال للتطبيق')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const tierLabel = (tier: 'owner' | 'admin' | 'member') =>
    tier === 'owner'
      ? tr('Team Owner', 'مالك الفريق')
      : tier === 'admin'
        ? tr('Admin', 'مسؤول')
        : tr('Member', 'عضو');

  return (
    <div className="dashboard-container" style={{ padding: '2rem 1rem', maxWidth: '1100px' }}>
      <h1 className="dashboard-section-title" style={{ marginBottom: '1rem' }}>
        {tr('Business Workspaces', 'مساحات عمل الشركات')}
      </h1>

      {/* Only shown when there is genuinely a choice to make. */}
      {workspaces.length > 1 && (
        <div className="dashboard-card" style={{ marginBottom: '1.5rem' }}>
          <label
            className="dashboard-card-meta"
            htmlFor="workspace-select"
            style={{ display: 'block', marginBottom: '0.5rem' }}
          >
            {tr('Active workspace', 'مساحة العمل النشطة')}
          </label>
          <select
            id="workspace-select"
            className="dashboard-select"
            style={{ width: '100%', maxWidth: '420px' }}
            value={selected ?? ''}
            onChange={(event) => setSelected(event.target.value)}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.teamId} value={workspace.teamId}>
                {workspace.teamName ?? tr('Business team', 'فريق العمل')} —{' '}
                {tierLabel(workspace.tier)}
              </option>
            ))}
          </select>
        </div>
      )}

      {selected && (
        <BusinessTeamPanel
          key={selected}
          dictionary={dictionary}
          accessToken={accessToken}
          teamId={selected}
        />
      )}
    </div>
  );
};
