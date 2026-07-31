'use client';

import type { BusinessTeamOverview } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import { BUSINESS_TEAM_PERMISSIONS, businessTeamsApiClient } from '@/lib/business-teams/client';
import type { Dictionary } from '@/lib/i18n/types';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
};

export const BusinessTeamPanel = ({ dictionary, accessToken }: Props) => {
  const [overview, setOverview] = useState<BusinessTeamOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formValidationError, setFormValidationError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; label: string } | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const isArabic = /[؀-ۿ]/.test(dictionary.nav?.home ?? '');
  const tr = (en: string, ar: string) => (isArabic ? ar : en);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await businessTeamsApiClient.getMine(accessToken));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tr('Failed to load team.', 'تعذر تحميل الفريق.'),
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

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
  const canTransferOwnership = actions?.transferOwnership === true;
  const assignableRoles = (overview?.roles ?? []).filter((role) => role.assignable);
  const transferCandidates = (overview?.members ?? []).filter(
    (member) => !member.isOwner && !member.isSelf,
  );

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
      () => businessTeamsApiClient.createRole(accessToken, { name, permissions }),
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
      () => businessTeamsApiClient.createInvite(accessToken, { email, roleId }),
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
      () => businessTeamsApiClient.revokeInvite(accessToken, inviteId),
      tr('Could not revoke invite.', 'تعذر إلغاء الدعوة.'),
    );

  const changeMemberRole = (memberId: string, roleId: string) =>
    mutate(
      () => businessTeamsApiClient.updateMemberRole(accessToken, memberId, { roleId }),
      tr('Could not update the member role.', 'تعذر تحديث دور العضو.'),
    );

  const confirmRemoval = async () => {
    if (!pendingRemoval) return;
    const ok = await mutate(
      () => businessTeamsApiClient.removeMember(accessToken, pendingRemoval.id),
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

  const transferOwnership = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!overview) return;
    setFormValidationError(null);
    const form = event.currentTarget;
    const memberId = (form.elements.namedItem('targetMemberId') as HTMLSelectElement).value;
    const confirmation = (form.elements.namedItem('confirmation') as HTMLInputElement).value;

    if (!memberId) {
      setFormValidationError(
        tr('Choose the member who will become owner.', 'اختر العضو الذي سيصبح المالك.'),
      );
      return;
    }
    // Checked here for a quick answer and again by the backend, which is the one
    // that decides. The typed name is what makes an irreversible action
    // deliberate.
    if (confirmation.trim().toLowerCase() !== (overview.team.name ?? '').trim().toLowerCase()) {
      setFormValidationError(
        tr('Type the workspace name exactly to confirm.', 'اكتب اسم مساحة العمل تمامًا للتأكيد.'),
      );
      return;
    }

    const ok = await mutate(
      () => businessTeamsApiClient.transferOwnership(accessToken, { memberId, confirmation }),
      tr('Could not transfer ownership.', 'تعذر نقل الملكية.'),
    );
    if (ok) {
      form.reset();
      setTransferOpen(false);
      setNotice(
        tr(
          'Ownership transferred. You are now an admin of this workspace.',
          'تم نقل الملكية. أنت الآن مسؤول في مساحة العمل.',
        ),
      );
    }
  };

  if (loading) return <p className="dashboard-empty">{dictionary.admin.loading}</p>;
  if (!overview || !viewer) return <p className="dashboard-error">{error}</p>;

  const tierLabel = (tier: 'owner' | 'admin' | 'member') =>
    tier === 'owner'
      ? tr('Owner', 'مالك')
      : tier === 'admin'
        ? tr('Admin', 'مسؤول')
        : tr('Member', 'عضو');

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
          <h3 className="dashboard-section-title" style={{ margin: 0 }}>
            {overview.team.name ?? tr('Business Team', 'فريق العمل')}
          </h3>
          <p className="dashboard-card-meta" style={{ margin: '0.25rem 0 0' }}>
            {tr('Workspace Team ID', 'معرف فريق مساحة العمل')}: {overview.team.id.slice(0, 8)}...
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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

      {/* Team Administration Forms: Visible for Owner & Admin */}
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
                {/* Owner and retired roles are absent because the backend
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
                  {BUSINESS_TEAM_PERMISSIONS.map((permission) => (
                    <label
                      key={permission}
                      className="dashboard-chip"
                      style={{ fontSize: '0.8rem' }}
                    >
                      <input name={permission} type="checkbox" />
                      {permission.replace('_', ' ')}
                    </label>
                  ))}
                </div>
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
              'Team administration (inviting members and role configuration) requires Owner or Admin workspace permissions.',
              'إدارة الفريق (دعوة الأعضاء وتكوين الأدوار) تتطلب صلاحيات مالك أو مسؤول في مساحة العمل.',
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
                  <td>
                    <div style={{ fontWeight: 500 }}>
                      {member.displayName ?? member.userId.slice(0, 8)}
                      {member.isSelf && (
                        <span className="dashboard-card-meta"> ({tr('you', 'أنت')})</span>
                      )}
                    </div>
                  </td>
                  <td>{member.email ?? '-'}</td>
                  <td>
                    {/* The owner's role is shown, never edited here: it moves
                        only through an ownership transfer. */}
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
                          <option value="">{member.roleName ?? tierLabel(member.tier)}</option>
                        )}
                        {assignableRoles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`dashboard-badge dashboard-badge--${member.tier}`}>
                        {member.roleName ?? tierLabel(member.tier)}
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
                    <td>{inviteItem.email}</td>
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

      {/* Business Workspace Operations & Ownership Transfer */}
      {canTransferOwnership && (
        <div
          style={{
            marginTop: '2rem',
            padding: '1rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div>
            <h4 style={{ margin: 0, fontSize: '0.95rem' }}>
              {tr('Business Ownership', 'ملكية مساحة العمل')}
            </h4>
            <p
              className="dashboard-card-meta"
              style={{ margin: '0.2rem 0 0', fontSize: '0.85rem' }}
            >
              {tr(
                'Transfer primary ownership of this business workspace to another member. You become an admin.',
                'نقل الملكية الرئيسية لمساحة العمل هذه إلى عضو آخر. ستصبح أنت مسؤولاً.',
              )}
            </p>
          </div>
          <button
            type="button"
            className="dashboard-secondary-btn"
            style={{ fontSize: '0.85rem' }}
            aria-expanded={transferOpen}
            onClick={() => setTransferOpen((open) => !open)}
          >
            {transferOpen ? tr('Cancel', 'إلغاء') : tr('Transfer Ownership', 'نقل الملكية')}
          </button>
        </div>
      )}

      {canTransferOwnership && transferOpen && (
        <div className="dashboard-card" style={{ marginTop: '1rem' }}>
          {transferCandidates.length === 0 ? (
            <p className="dashboard-card-meta">
              {tr(
                'Ownership can only be transferred to another member of this workspace. Invite someone first.',
                'يمكن نقل الملكية إلى عضو آخر في مساحة العمل فقط. قم بدعوة عضو أولاً.',
              )}
            </p>
          ) : (
            <form className="dashboard-form" onSubmit={(e) => void transferOwnership(e)}>
              <select
                name="targetMemberId"
                className="dashboard-select"
                aria-label={tr('New owner', 'المالك الجديد')}
                required
                defaultValue=""
              >
                <option value="" disabled>
                  {tr('Select the new owner', 'اختر المالك الجديد')}
                </option>
                {transferCandidates.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName ?? member.email ?? member.userId.slice(0, 8)}
                  </option>
                ))}
              </select>
              <input
                name="confirmation"
                className="dashboard-input"
                aria-label={tr('Confirm workspace name', 'تأكيد اسم مساحة العمل')}
                placeholder={tr(
                  `Type "${overview.team.name ?? ''}" to confirm`,
                  `اكتب "${overview.team.name ?? ''}" للتأكيد`,
                )}
                required
              />
              <button className="dashboard-primary-btn" type="submit" disabled={busy}>
                {busy
                  ? tr('Transferring...', 'جاري النقل...')
                  : tr('Confirm Transfer', 'تأكيد النقل')}
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
};
