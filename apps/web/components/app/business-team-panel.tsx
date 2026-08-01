'use client';

import type { BusinessTeamOverview } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import { BUSINESS_TEAM_PERMISSIONS, businessTeamsApiClient } from '@/lib/business-teams/client';
import type { Dictionary } from '@/lib/i18n/types';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  /**
   * Which workspace to operate in.
   *
   * Omitted by the business dashboard, which has always shown the account's own
   * workspace. Supplied by the workspaces route, where a person who belongs to
   * more than one picks. Either way the server verifies it against the caller's
   * own memberships, so it selects and never grants.
   */
  teamId?: string | null;
};

export const BusinessTeamPanel = ({ dictionary, accessToken, teamId }: Props) => {
  const [overview, setOverview] = useState<BusinessTeamOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formValidationError, setFormValidationError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; label: string } | null>(null);

  const isArabic = /[؀-ۿ]/.test(dictionary.nav?.home ?? '');
  const tr = (en: string, ar: string) => (isArabic ? ar : en);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await businessTeamsApiClient.getMine(accessToken, teamId));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tr('Failed to load team.', 'تعذر تحميل الفريق.'),
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Run a mutation and take the fresh overview from its response.
   *
   * Every mutating endpoint returns the same authoritative overview, so the
   * caller's own permissions are re-read from the server after each change —
   * an admin who has just been demoted sees the correct screen on the next
   * render rather than the one they had before.
   */
  const mutate = async (action: () => Promise<BusinessTeamOverview>, failure: string) => {
    setBusy(true);
    setError(null);
    setFormValidationError(null);
    try {
      setOverview(await action());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Standing in the workspace, decided by the backend and only presented here.
  // Every action below is re-authorized server-side, so hiding a control is a
  // convenience rather than a control.
  const viewer = overview?.viewer ?? null;
  const actions = viewer?.allowedActions ?? null;
  const workspaceTier = viewer?.tier ?? 'member';
  const canAdministerTeam = actions?.inviteMembers === true;
  const canManageRoles = actions?.manageRoles === true;
  const assignableRoles = (overview?.roles ?? []).filter((role) => role.assignable);

  const createRole = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormValidationError(null);
    const form = event.currentTarget;
    const name = (form.elements.namedItem('roleName') as HTMLInputElement).value.trim();
    const permissions = BUSINESS_TEAM_PERMISSIONS.filter(
      (permission) => (form.elements.namedItem(permission) as HTMLInputElement)?.checked,
    );

    if (!name) {
      setFormValidationError(tr('Role name is required.', 'اسم الدور مطلوب.'));
      return;
    }
    if (permissions.length === 0) {
      setFormValidationError(tr('Select at least one permission.', 'اختر إذنًا واحدًا على الأقل.'));
      return;
    }

    const ok = await mutate(
      () => businessTeamsApiClient.createRole(accessToken, { name, permissions }, teamId),
      tr('Could not create role.', 'تعذر إنشاء الدور.'),
    );
    if (ok) form.reset();
  };

  const invite = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!overview) return;
    setFormValidationError(null);
    const form = event.currentTarget;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim();
    const roleId = (form.elements.namedItem('roleId') as HTMLSelectElement).value;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      setFormValidationError(
        tr('Please enter a valid email address.', 'يرجى إدخال بريد إلكتروني صحيح.'),
      );
      return;
    }
    if (!roleId) {
      setFormValidationError(tr('Please select a business role.', 'يرجى اختيار دور وظيفي.'));
      return;
    }

    const ok = await mutate(
      () => businessTeamsApiClient.createInvite(accessToken, { email, roleId }, teamId),
      tr('Could not send invite.', 'تعذر إرسال الدعوة.'),
    );
    if (ok) {
      form.reset();
      setNotice(
        tr(
          'Invitation sent. The recipient has a link that expires in 7 days.',
          'تم إرسال الدعوة. سيصل رابط ينتهي خلال 7 أيام.',
        ),
      );
    }
  };

  const revokeInvite = (inviteId: string) =>
    mutate(
      () => businessTeamsApiClient.revokeInvite(accessToken, inviteId, teamId),
      tr('Could not revoke invite.', 'تعذر إلغاء الدعوة.'),
    );

  const changeMemberRole = (memberId: string, roleId: string) =>
    mutate(
      () => businessTeamsApiClient.updateMemberRole(accessToken, memberId, { roleId }, teamId),
      tr('Could not update the member role.', 'تعذر تحديث دور العضو.'),
    );

  const confirmRemoval = async () => {
    if (!pendingRemoval) return;
    const ok = await mutate(
      () => businessTeamsApiClient.removeMember(accessToken, pendingRemoval.id, teamId),
      tr('Could not remove the member.', 'تعذر إزالة العضو.'),
    );
    setPendingRemoval(null);
    if (ok) {
      setNotice(
        tr(
          'Member removed. Their workspace access ended immediately.',
          'تمت إزالة العضو. انتهى وصوله إلى مساحة العمل فورًا.',
        ),
      );
    }
  };

  if (loading) return <p className="dashboard-empty">{dictionary.admin.loading}</p>;
  if (!overview || !viewer) return <p className="dashboard-error">{error}</p>;

  const tierLabel = (tier: 'owner' | 'admin' | 'member') =>
    tier === 'owner'
      ? tr('Team Owner', 'مالك الفريق')
      : tier === 'admin'
        ? tr('Admin', 'مسؤول')
        : tr('Member', 'عضو');

  const memberRoleLabel = (member: BusinessTeamOverview['members'][number]) =>
    member.isOwner ? tierLabel('owner') : (member.roleName ?? tierLabel(member.tier));

  return (
    <section className="dashboard-section" style={{ maxWidth: '100%' }}>
      {/* Workspace Header & Role Presentation */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.5rem',
          padding: '1rem',
          background: 'var(--card-bg, rgba(255, 255, 255, 0.05))',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <div>
          <h3 className="dashboard-section-title" style={{ margin: 0, wordBreak: 'break-word' }}>
            {overview.team.name ?? tr('Business Team', 'فريق العمل')}
          </h3>
          <p className="dashboard-card-meta" style={{ margin: '0.25rem 0 0' }}>
            {tr('Workspace Team ID', 'معرف فريق مساحة العمل')}: {overview.team.id.slice(0, 8)}...
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span className="dashboard-card-meta">
            {tr('Your Workspace Role', 'دورك في مساحة العمل')}:
          </span>
          <span
            className={`dashboard-badge dashboard-badge--${workspaceTier}`}
            style={{
              padding: '0.35rem 0.85rem',
              borderRadius: '20px',
              fontWeight: 600,
              fontSize: '0.85rem',
              textTransform: 'capitalize',
            }}
          >
            {tierLabel(workspaceTier)}
          </span>
        </div>
      </div>

      {error && (
        <p className="dashboard-error" style={{ marginBottom: '1rem' }} role="alert">
          {error}
        </p>
      )}
      {formValidationError && (
        <p className="dashboard-error" style={{ marginBottom: '1rem' }} role="alert">
          {formValidationError}
        </p>
      )}

      {notice && (
        <div
          role="status"
          style={{
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '8px',
            padding: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: '1.4' }}>{notice}</p>
          <button
            type="button"
            className="dashboard-secondary-btn"
            style={{ marginTop: '0.75rem', padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
            onClick={() => setNotice(null)}
          >
            {tr('Dismiss', 'إغلاق')}
          </button>
        </div>
      )}

      {/* Removal confirmation — an irreversible action asks once. */}
      {pendingRemoval && (
        <div
          role="alertdialog"
          aria-label={tr('Confirm member removal', 'تأكيد إزالة العضو')}
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '8px',
            padding: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <h4 style={{ color: '#ef4444', margin: '0 0 0.5rem 0', fontSize: '1rem' }}>
            {tr('Remove member?', 'إزالة العضو؟')}
          </h4>
          <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: '1.4' }}>
            {tr(
              `${pendingRemoval.label} will lose access to this workspace immediately. Their past activity is kept.`,
              `سيفقد ${pendingRemoval.label} الوصول إلى مساحة العمل فورًا. يتم الاحتفاظ بسجل نشاطه السابق.`,
            )}
          </p>
          <div className="dashboard-actions-row" style={{ marginTop: '0.75rem', gap: '0.5rem' }}>
            <button
              type="button"
              className="dashboard-primary-btn"
              style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
              disabled={busy}
              onClick={() => void confirmRemoval()}
            >
              {busy ? tr('Removing...', 'جاري الإزالة...') : tr('Remove', 'إزالة')}
            </button>
            <button
              type="button"
              className="dashboard-secondary-btn"
              style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
              onClick={() => setPendingRemoval(null)}
            >
              {tr('Cancel', 'إلغاء')}
            </button>
          </div>
        </div>
      )}

      {/* Team Administration Forms: visible for Team Owner and Admin. */}
      {canAdministerTeam ? (
        <div className="dashboard-cards" style={{ marginBottom: '2rem' }}>
          <div className="dashboard-card">
            <h4 className="dashboard-card-title">{tr('Invite Member', 'دعوة عضو جديد')}</h4>
            <p className="dashboard-card-meta" style={{ marginBottom: '1rem' }}>
              {tr(
                'Enter recipient email and assign a business workspace role.',
                'أدخل البريد الإلكتروني للمستلم واختر دوره الوظيفي في مساحة العمل.',
              )}
            </p>
            <form className="dashboard-form" onSubmit={(e) => void invite(e)}>
              <input
                name="email"
                type="email"
                className="dashboard-input"
                placeholder="name@example.com"
                aria-label={tr('Recipient email', 'بريد المستلم')}
                required
              />
              <select
                name="roleId"
                className="dashboard-select"
                aria-label={tr('Workspace role', 'دور مساحة العمل')}
                required
                defaultValue=""
              >
                <option value="" disabled>
                  {tr('Select role', 'اختر الدور')}
                </option>
                {/* Team Owner and retired roles are absent because the backend
                    refuses them; offering one would only produce an error. */}
                {assignableRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name} ({tierLabel(role.tier)})
                  </option>
                ))}
              </select>
              <button className="dashboard-primary-btn" type="submit" disabled={busy}>
                {busy ? tr('Sending...', 'جاري الإرسال...') : tr('Send Invitation', 'إرسال الدعوة')}
              </button>
            </form>
          </div>

          {canManageRoles && (
            <div className="dashboard-card">
              <h4 className="dashboard-card-title">{tr('Create Custom Role', 'إنشاء دور مخصص')}</h4>
              <form className="dashboard-form" onSubmit={(e) => void createRole(e)}>
                <input
                  name="roleName"
                  className="dashboard-input"
                  placeholder={tr('Role name (e.g. Operations)', 'اسم الدور (مثال: العمليات)')}
                  aria-label={tr('Role name', 'اسم الدور')}
                  required
                />
                <div className="dashboard-actions-row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                  {BUSINESS_TEAM_PERMISSIONS.map((permission) => {
                    const isEnforced = permission === 'manage_team';
                    return (
                      <label
                        key={permission}
                        className="dashboard-chip"
                        style={{
                          fontSize: '0.8rem',
                          opacity: isEnforced ? 1 : 0.6,
                          cursor: isEnforced ? 'pointer' : 'not-allowed',
                        }}
                      >
                        <input
                          name={permission}
                          type="checkbox"
                          disabled={!isEnforced}
                          defaultChecked={isEnforced}
                        />
                        {permission.replace('_', ' ')}
                        {!isEnforced && (
                          <span style={{ fontSize: '0.75rem', opacity: 0.75 }}>
                            {tr(' (Deferred)', ' (مؤجل)')}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
                <p
                  className="dashboard-card-meta"
                  style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}
                >
                  {tr(
                    'Only team administration (manage_team) is enforced for launch. Service, job, financial and analytics permissions are deferred.',
                    'إدارة الفريق (manage_team) هي الصلاحية المطبقة حالياً. صلاحيات الخدمات والوظائف والمالية والتحليلات مؤجلة.',
                  )}
                </p>
                <button className="dashboard-primary-btn" type="submit" disabled={busy}>
                  {busy ? tr('Creating...', 'جاري الإنشاء...') : tr('Create Role', 'إنشاء الدور')}
                </button>
              </form>
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            padding: '1rem',
            background: 'rgba(255, 255, 255, 0.03)',
            borderRadius: '8px',
            marginBottom: '1.5rem',
          }}
        >
          <p className="dashboard-card-meta">
            ℹ{' '}
            {tr(
              'Team administration (inviting members and role configuration) requires Team Owner or Admin workspace permissions.',
              'إدارة الفريق (دعوة الأعضاء وتكوين الأدوار) تتطلب صلاحيات مالك الفريق أو مسؤول في مساحة العمل.',
            )}
          </p>
        </div>
      )}

      {/* Team Members List */}
      <div style={{ marginBottom: '2rem' }}>
        <h4 className="dashboard-card-title" style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>
          {tr('Team Members', 'أعضاء الفريق')} ({overview.members.length})
        </h4>
        <div className="service-campaign-table-wrapper" style={{ overflowX: 'auto' }}>
          <table className="service-campaign-table" style={{ width: '100%', minWidth: '350px' }}>
            <thead>
              <tr>
                <th>{tr('Member', 'العضو')}</th>
                <th>{tr('Email', 'البريد')}</th>
                <th>{tr('Role', 'الدور')}</th>
                <th>{tr('Actions', 'إجراءات')}</th>
              </tr>
            </thead>
            <tbody>
              {overview.members.map((member) => (
                <tr key={member.id}>
                  <td style={{ wordBreak: 'break-word' }}>
                    <div style={{ fontWeight: 500 }}>
                      {member.displayName ?? member.userId.slice(0, 8)}
                      {member.isSelf && (
                        <span className="dashboard-card-meta"> ({tr('you', 'أنت')})</span>
                      )}
                    </div>
                  </td>
                  <td style={{ wordBreak: 'break-word' }}>{member.email ?? '-'}</td>
                  <td>
                    {/* The owner's role is shown, never edited here. */}
                    {canAdministerTeam && !member.isOwner ? (
                      <select
                        className="dashboard-select"
                        style={{ fontSize: '0.8rem', padding: '0.2rem 0.4rem' }}
                        aria-label={tr('Change role', 'تغيير الدور')}
                        value={
                          assignableRoles.some((role) => role.id === member.roleId)
                            ? (member.roleId ?? '')
                            : ''
                        }
                        disabled={busy}
                        onChange={(event) => {
                          const next = event.target.value;
                          if (next && next !== member.roleId)
                            void changeMemberRole(member.id, next);
                        }}
                      >
                        {/* A member sitting on a retired role keeps showing it
                            until somebody deliberately moves them. */}
                        {!assignableRoles.some((role) => role.id === member.roleId) && (
                          <option value="">{memberRoleLabel(member)}</option>
                        )}
                        {assignableRoles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`dashboard-badge dashboard-badge--${member.tier}`}>
                        {memberRoleLabel(member)}
                      </span>
                    )}
                  </td>
                  <td>
                    {actions?.removeMembers === true && !member.isOwner && (
                      <button
                        type="button"
                        className="dashboard-secondary-btn"
                        style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', color: '#ef4444' }}
                        disabled={busy}
                        onClick={() =>
                          setPendingRemoval({
                            id: member.id,
                            label: member.displayName ?? member.email ?? 'Member',
                          })
                        }
                      >
                        {tr('Remove', 'إزالة')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending & Historical Invitations */}
      {overview.invites.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h4 className="dashboard-card-title" style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>
            {tr('Team Invitations', 'دعوات الفريق')} ({overview.invites.length})
          </h4>
          <div className="service-campaign-table-wrapper" style={{ overflowX: 'auto' }}>
            <table className="service-campaign-table" style={{ width: '100%', minWidth: '350px' }}>
              <thead>
                <tr>
                  <th>{tr('Recipient Email', 'البريد المستلم')}</th>
                  <th>{tr('Assigned Role', 'الدور المعين')}</th>
                  <th>{tr('Status', 'الحالة')}</th>
                  <th>{tr('Expires', 'تاريخ الانتهاء')}</th>
                  <th>{tr('Actions', 'إجراءات')}</th>
                </tr>
              </thead>
              <tbody>
                {overview.invites.map((inviteItem) => (
                  <tr key={inviteItem.id}>
                    <td style={{ wordBreak: 'break-word' }}>{inviteItem.email}</td>
                    <td>{inviteItem.roleName}</td>
                    <td>
                      <span
                        className={`dashboard-badge dashboard-badge--${inviteItem.status}`}
                        style={{
                          textTransform: 'capitalize',
                          padding: '0.2rem 0.6rem',
                          fontSize: '0.75rem',
                        }}
                      >
                        {inviteItem.status}
                      </span>
                    </td>
                    <td>
                      {new Date(inviteItem.expiresAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td>
                      {inviteItem.status === 'pending' && actions?.revokeInvites === true && (
                        <button
                          className="dashboard-secondary-btn"
                          type="button"
                          disabled={busy}
                          style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
                          onClick={() => void revokeInvite(inviteItem.id)}
                        >
                          {tr('Revoke', 'إلغاء')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Team ownership is stated for clarity, but no transfer action is offered. */}
      {viewer.isOwner && (
        <div
          style={{
            marginTop: '2rem',
            padding: '1rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(255, 255, 255, 0.02)',
            borderRadius: '8px',
          }}
        >
          <h4 style={{ margin: 0, fontSize: '0.95rem' }}>{tr('Team Ownership', 'ملكية الفريق')}</h4>
          <p
            className="dashboard-card-meta"
            style={{ margin: '0.4rem 0 0', fontSize: '0.85rem', lineHeight: '1.4' }}
          >
            {tr(
              'Team ownership transfer is unavailable for launch. Workspace-wide asset control and ownership transfer actions are deferred.',
              'نقل ملكية الفريق غير متاح حالياً للإطلاق. إجراءات نقل الملكية والتحكم التام بالأصول مؤجلة.',
            )}
          </p>
        </div>
      )}
    </section>
  );
};
