'use client';

import type { BusinessTeamOverview } from '@mohandishub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { BUSINESS_TEAM_PERMISSIONS, businessTeamsApiClient } from '@/lib/business-teams/client';
import type { Dictionary } from '@/lib/i18n/types';
import '@/components/team/team-management.css';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  /**
   * Selects one of the caller's server-authorized workspace memberships. It is
   * never an authorization grant and is verified on every API call.
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
  const teamSurfaceRef = useRef<HTMLDivElement>(null);
  const removalDialogRef = useRef<HTMLDivElement>(null);
  const removalTriggerRef = useRef<HTMLElement | null>(null);

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

  // The confirmation is a modal keyboard scope: focus enters it, Tab and
  // Shift+Tab wrap within it, Escape closes it, and closing restores the
  // triggering control.
  useEffect(() => {
    if (!pendingRemoval) return;

    const dialog = removalDialogRef.current;
    const focusable = Array.from(
      dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const first = focusable[0] ?? dialog;
    const last = focusable.at(-1) ?? dialog;
    first?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPendingRemoval(null);
        return;
      }
      if (event.key !== 'Tab') return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      const trigger = removalTriggerRef.current;
      (trigger?.isConnected ? trigger : teamSurfaceRef.current)?.focus();
      removalTriggerRef.current = null;
    };
  }, [pendingRemoval]);

  /**
   * Run a mutation and take the fresh overview from its response.
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
    if (ok) {
      form.reset();
      setNotice(tr('Custom role created successfully.', 'تم إنشاء الدور المخصص بنجاح.'));
    }
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

  const tierLabel = (tier: 'owner' | 'admin' | 'member') =>
    tier === 'owner'
      ? tr('Team Owner', 'مالك الفريق')
      : tier === 'admin'
        ? tr('Admin', 'مسؤول')
        : tr('Member', 'عضو');

  const memberRoleLabel = (member: BusinessTeamOverview['members'][number]) =>
    member.isOwner ? tierLabel('owner') : (member.roleName ?? tierLabel(member.tier));

  const requestRemoval = (member: BusinessTeamOverview['members'][number]) => {
    removalTriggerRef.current = document.activeElement as HTMLElement | null;
    setPendingRemoval({
      id: member.id,
      label: member.displayName ?? member.email ?? 'Member',
    });
  };

  if (loading) {
    return (
      <div className="team-container" data-testid="team-loading-state">
        <div className="team-empty-state">
          <div style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            ⏳{' '}
            {dictionary.admin?.loading ??
              tr('Loading business team...', 'جاري تحميل فريق العمل...')}
          </div>
        </div>
      </div>
    );
  }

  if (!overview || !viewer) {
    return (
      <div className="team-container" data-testid="team-error-state">
        <div className="team-alert team-alert--error" role="alert">
          <div>
            <strong>⚠️ {tr('Team Error', 'خطأ في تحميل الفريق')}</strong>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.88rem' }}>
              {error ??
                tr('Failed to load business team overview.', 'تعذر تحميل بيانات فريق العمل.')}
            </p>
          </div>
          <button type="button" className="team-btn-secondary" onClick={() => void load()}>
            {tr('Retry', 'إعادة المحاولة')}
          </button>
        </div>
      </div>
    );
  }

  const pendingInvitesCount = overview.invites.filter((i) => i.status === 'pending').length;

  return (
    <div
      ref={teamSurfaceRef}
      tabIndex={-1}
      className="team-container"
      data-testid="team-overview-surface"
    >
      {/* Workspace Summary Card */}
      <header className="team-header-card" data-testid="workspace-summary">
        <div className="team-header-title-group">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <h2 className="team-header-title">
              {overview.team.name ?? tr('Business Team', 'فريق العمل')}
            </h2>
            <span
              className={`team-badge team-badge--${workspaceTier}`}
              data-testid="workspace-role-badge"
            >
              {tierLabel(workspaceTier)}
            </span>
          </div>
          <p className="team-header-subtitle">
            <span>{tr('Workspace Team ID', 'معرف فريق مساحة العمل')}:</span>
            <code
              style={{
                fontFamily: 'monospace',
                background: 'hsl(var(--muted) / 0.5)',
                padding: '0.1rem 0.4rem',
                borderRadius: '4px',
                fontSize: '0.8rem',
              }}
            >
              {overview.team.id.slice(0, 8)}...
            </code>
          </p>
        </div>

        <div className="team-header-stats">
          <div className="team-stat-chip">
            <span>{tr('Members', 'الأعضاء')}</span>
            <span className="team-stat-chip-count">{overview.members.length}</span>
          </div>
          <div className="team-stat-chip">
            <span>{tr('Pending Invites', 'الدعوات المعلقة')}</span>
            <span className="team-stat-chip-count">{pendingInvitesCount}</span>
          </div>
          <div className="team-stat-chip">
            <span>{tr('Roles', 'الأدوار')}</span>
            <span className="team-stat-chip-count">{overview.roles.length}</span>
          </div>
        </div>
      </header>

      {/* Global Alerts & Notices */}
      {error && (
        <div className="team-alert team-alert--error" role="alert" data-testid="team-alert-error">
          <span>⚠️ {error}</span>
          <button
            type="button"
            className="team-btn-secondary"
            style={{ padding: '0.2rem 0.6rem', fontSize: '0.78rem' }}
            onClick={() => setError(null)}
          >
            {tr('Dismiss', 'إغلاق')}
          </button>
        </div>
      )}

      {formValidationError && (
        <div
          className="team-alert team-alert--warning"
          role="alert"
          data-testid="team-form-validation-error"
        >
          <span>⚠️ {formValidationError}</span>
          <button
            type="button"
            className="team-btn-secondary"
            style={{ padding: '0.2rem 0.6rem', fontSize: '0.78rem' }}
            onClick={() => setFormValidationError(null)}
          >
            {tr('Dismiss', 'إغلاق')}
          </button>
        </div>
      )}

      {notice && (
        <div
          className="team-alert team-alert--success"
          role="status"
          data-testid="team-alert-notice"
        >
          <span>✓ {notice}</span>
          <button
            type="button"
            className="team-btn-secondary"
            style={{ padding: '0.2rem 0.6rem', fontSize: '0.78rem' }}
            onClick={() => setNotice(null)}
          >
            {tr('Dismiss', 'إغلاق')}
          </button>
        </div>
      )}

      {/* Removal Confirmation Dialog Modal */}
      {pendingRemoval && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="remove-member-title"
          aria-describedby="remove-member-desc"
          data-testid="member-removal-dialog"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            ref={removalDialogRef}
            tabIndex={-1}
            className="team-card"
            style={{
              maxWidth: '480px',
              width: '100%',
              borderColor: 'rgba(239, 68, 68, 0.4)',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
            }}
          >
            <h3
              id="remove-member-title"
              style={{ margin: 0, color: '#ef4444', fontSize: '1.2rem' }}
            >
              ⚠️ {tr('Remove team member?', 'إزالة عضو الفريق؟')}
            </h3>
            <p id="remove-member-desc" style={{ margin: 0, fontSize: '0.9rem', lineHeight: '1.5' }}>
              {tr(
                `Are you sure you want to remove ${pendingRemoval.label}? They will lose access to this workspace immediately. Past activity is preserved.`,
                `هل أنت تأكد من إزالة ${pendingRemoval.label}؟ سيفقد الوصول إلى مساحة العمل فورًا. يتم الاحتفاظ بسجل النشاط السابق.`,
              )}
            </p>
            <div
              style={{
                display: 'flex',
                gap: '0.75rem',
                justifyContent: 'flex-end',
                marginTop: '0.5rem',
              }}
            >
              <button
                type="button"
                className="team-btn-secondary"
                onClick={() => setPendingRemoval(null)}
              >
                {tr('Cancel', 'إلغاء')}
              </button>
              <button
                type="button"
                className="team-btn-danger"
                style={{ padding: '0.55rem 1.1rem', fontSize: '0.85rem' }}
                disabled={busy}
                onClick={() => void confirmRemoval()}
              >
                {busy
                  ? tr('Removing...', 'جاري الإزالة...')
                  : tr('Confirm Removal', 'تأكيد الإزالة')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Administration Section: Forms */}
      {canAdministerTeam ? (
        <section className="team-section">
          <div className="team-card-grid team-card-grid--2col">
            {/* Invite Member Form */}
            <div className="team-card" data-testid="invite-member-form-card">
              <div className="team-section-header">
                <h3 className="team-section-title">✉️ {tr('Invite Member', 'دعوة عضو جديد')}</h3>
              </div>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>
                {tr(
                  'Enter recipient email and select a workspace role.',
                  'أدخل البريد الإلكتروني للمستلم واختر دوره الوظيفي.',
                )}
              </p>
              <form className="team-form" onSubmit={(e) => void invite(e)}>
                <div className="team-field">
                  <label htmlFor="invite-email" className="team-label">
                    {tr('Recipient Email', 'بريد المستلم')}
                  </label>
                  <input
                    id="invite-email"
                    name="email"
                    type="email"
                    className="team-input team-text-wrap"
                    placeholder="name@example.com"
                    aria-label={tr('Recipient email', 'بريد المستلم')}
                    required
                  />
                </div>
                <div className="team-field">
                  <label htmlFor="invite-role" className="team-label">
                    {tr('Workspace Role', 'دور مساحة العمل')}
                  </label>
                  <select
                    id="invite-role"
                    name="roleId"
                    className="team-select"
                    aria-label={tr('Workspace role', 'دور مساحة العمل')}
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      {tr('-- Select Role --', '-- اختر الدور --')}
                    </option>
                    {assignableRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name} ({tierLabel(role.tier)})
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="team-btn-primary" disabled={busy}>
                  {busy
                    ? tr('Sending...', 'جاري الإرسال...')
                    : tr('Send Invitation', 'إرسال الدعوة')}
                </button>
              </form>
            </div>

            {/* Custom Role Form */}
            {canManageRoles && (
              <div className="team-card" data-testid="create-role-form-card">
                <div className="team-section-header">
                  <h3 className="team-section-title">
                    ⚙️ {tr('Create Custom Role', 'إنشاء دور مخصص')}
                  </h3>
                </div>
                <form className="team-form" onSubmit={(e) => void createRole(e)}>
                  <div className="team-field">
                    <label htmlFor="role-name-input" className="team-label">
                      {tr('Role Name', 'اسم الدور')}
                    </label>
                    <input
                      id="role-name-input"
                      name="roleName"
                      className="team-input"
                      placeholder={tr('e.g. Operations Manager', 'مثال: مدير العمليات')}
                      aria-label={tr('Role name', 'اسم الدور')}
                      required
                    />
                  </div>
                  <div className="team-field">
                    <span className="team-label">{tr('Permissions', 'الصلاحيات')}</span>
                    <div className="team-permissions-grid">
                      {BUSINESS_TEAM_PERMISSIONS.map((permission) => {
                        const isEnforced = permission === 'manage_team';
                        const permissionLabels: Record<string, { en: string; ar: string }> = {
                          manage_team: { en: 'Manage Team', ar: 'إدارة الفريق' },
                          manage_services: { en: 'Manage Services', ar: 'إدارة الخدمات' },
                          manage_jobs: { en: 'Manage Jobs & Hiring', ar: 'إدارة الوظائف والتوفيد' },
                          manage_reservations: {
                            en: 'Manage Orders & Bookings',
                            ar: 'إدارة الطلبات والحجوزات',
                          },
                          view_wallet: { en: 'View Wallet & Ledger', ar: 'عرض المحفظة والسجل' },
                          manage_support_disputes: {
                            en: 'Manage Support & Disputes',
                            ar: 'إدارة الدعم والنزاعات',
                          },
                          view_analytics: { en: 'View Analytics', ar: 'عرض التحليلات' },
                        };
                        const label = permissionLabels[permission]
                          ? isArabic
                            ? permissionLabels[permission].ar
                            : permissionLabels[permission].en
                          : permission.replace(/_/g, ' ');
                        return (
                          <label
                            key={permission}
                            className={`team-permission-chip ${
                              isEnforced
                                ? 'team-permission-chip--active'
                                : 'team-permission-chip--deferred'
                            }`}
                            data-testid={`permission-chip-${permission}`}
                          >
                            <input
                              name={permission}
                              type="checkbox"
                              disabled={!isEnforced}
                              defaultChecked={isEnforced}
                              style={{ cursor: isEnforced ? 'pointer' : 'not-allowed' }}
                            />
                            <span>{label}</span>
                            {!isEnforced && (
                              <span
                                style={{
                                  fontSize: '0.7rem',
                                  color: 'hsl(var(--muted-foreground))',
                                }}
                              >
                                {tr('(Deferred)', '(مؤجل)')}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                    <p
                      style={{
                        margin: '0.4rem 0 0',
                        fontSize: '0.78rem',
                        color: 'hsl(var(--muted-foreground))',
                        lineHeight: 1.4,
                      }}
                      data-testid="deferred-permissions-note"
                    >
                      ℹ{' '}
                      {tr(
                        'Only team administration (manage_team) is active. Operational permissions are deferred for launch.',
                        'إدارة الفريق (manage_team) هي الصلاحية المطبقة حالياً. صلاحيات التشغيل والمالية والتحليلات مؤجلة.',
                      )}
                    </p>
                  </div>
                  <button type="submit" className="team-btn-primary" disabled={busy}>
                    {busy ? tr('Creating...', 'جاري الإنشاء...') : tr('Create Role', 'إنشاء الدور')}
                  </button>
                </form>
              </div>
            )}
          </div>
        </section>
      ) : (
        <div className="team-alert team-alert--info" style={{ marginBottom: '2rem' }}>
          <span>
            ℹ{' '}
            {tr(
              'Team administration (inviting members and custom role creation) requires Team Owner or Admin workspace permissions.',
              'إدارة الفريق (دعوة الأعضاء وإنشاء الأدوار المخصصة) تتطلب صلاحيات مالك الفريق أو مسؤول في مساحة العمل.',
            )}
          </span>
        </div>
      )}

      {/* Team Members List */}
      <section className="team-section" data-testid="members-section">
        <div className="team-section-header">
          <h3 className="team-section-title">
            👥 {tr('Team Members', 'أعضاء الفريق')} ({overview.members.length})
          </h3>
        </div>

        {/* Desktop Table View */}
        <div className="team-table-wrapper team-table-desktop-only">
          <table className="team-table" aria-label={tr('Team Members', 'أعضاء الفريق')}>
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
                <tr key={member.id} data-testid={`member-row-${member.id}`}>
                  <td>
                    <div style={{ fontWeight: 600 }}>
                      <span className="team-text-wrap">
                        {member.displayName ?? member.email ?? tr('Team member', 'عضو في الفريق')}
                      </span>
                      {member.isSelf && (
                        <span
                          style={{
                            fontSize: '0.75rem',
                            color: 'hsl(var(--muted-foreground))',
                            marginInlineStart: '0.4rem',
                          }}
                        >
                          ({tr('you', 'أنت')})
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="team-text-wrap">{member.email ?? '-'}</td>
                  <td>
                    {canAdministerTeam && !member.isOwner ? (
                      <select
                        className="team-select"
                        style={{ fontSize: '0.82rem', padding: '0.35rem 0.6rem', width: 'auto' }}
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
                        {!assignableRoles.some((role) => role.id === member.roleId) && (
                          <option value="">{memberRoleLabel(member)}</option>
                        )}
                        {assignableRoles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name} ({tierLabel(role.tier)})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className={`team-badge team-badge--${member.tier}`}
                        data-testid={`member-badge-${member.tier}`}
                      >
                        {memberRoleLabel(member)}
                      </span>
                    )}
                  </td>
                  <td>
                    {actions?.removeMembers === true && !member.isOwner && (
                      <button
                        type="button"
                        className="team-btn-danger"
                        disabled={busy}
                        onClick={() => requestRemoval(member)}
                        aria-label={`${tr('Remove', 'إزالة')} ${member.displayName ?? member.email}`}
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

        {/* Mobile Responsive Cards View (<=639px) */}
        <div className="team-cards-mobile-only" data-testid="members-mobile-cards">
          {overview.members.map((member) => (
            <div key={member.id} className="team-member-mobile-card">
              <div className="team-member-mobile-row">
                <div style={{ fontWeight: 600 }} className="team-text-wrap">
                  {member.displayName ?? member.email ?? tr('Team member', 'عضو في الفريق')}
                  {member.isSelf && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        color: 'hsl(var(--muted-foreground))',
                        marginInlineStart: '0.3rem',
                      }}
                    >
                      ({tr('you', 'أنت')})
                    </span>
                  )}
                </div>
                <span className={`team-badge team-badge--${member.tier}`}>
                  {memberRoleLabel(member)}
                </span>
              </div>
              <div
                className="team-text-wrap"
                style={{ fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}
              >
                {member.email ?? '-'}
              </div>
              {canAdministerTeam && !member.isOwner && (
                <div className="team-member-mobile-row" style={{ marginTop: '0.25rem' }}>
                  <select
                    className="team-select"
                    style={{ fontSize: '0.82rem', padding: '0.35rem 0.5rem' }}
                    aria-label={tr('Change role', 'تغيير الدور')}
                    value={
                      assignableRoles.some((role) => role.id === member.roleId)
                        ? (member.roleId ?? '')
                        : ''
                    }
                    disabled={busy}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (next && next !== member.roleId) void changeMemberRole(member.id, next);
                    }}
                  >
                    {!assignableRoles.some((role) => role.id === member.roleId) && (
                      <option value="">{memberRoleLabel(member)}</option>
                    )}
                    {assignableRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                  {actions?.removeMembers === true && (
                    <button
                      type="button"
                      className="team-btn-danger"
                      disabled={busy}
                      onClick={() => requestRemoval(member)}
                    >
                      {tr('Remove', 'إزالة')}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Pending & Historical Invitations */}
      <section className="team-section" data-testid="invitations-section">
        <div className="team-section-header">
          <h3 className="team-section-title">
            📨 {tr('Team Invitations', 'دعوات الفريق')} ({overview.invites.length})
          </h3>
        </div>

        {overview.invites.length === 0 ? (
          <div className="team-empty-state" data-testid="invitations-empty-state">
            <div className="team-empty-icon">📭</div>
            <h4 style={{ margin: 0, fontSize: '1rem' }}>
              {tr('No Invitations Sent', 'لم يتم إرسال أي دعوات بعد')}
            </h4>
            <p style={{ margin: '0.4rem 0 0', fontSize: '0.85rem' }}>
              {tr(
                'Invitations sent to team members will appear here with status updates.',
                'الدعوات التي ترسلها لأعضاء الفريق ستظهر هنا مع تحديث حالتها.',
              )}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Invitations Table */}
            <div className="team-table-wrapper team-table-desktop-only">
              <table className="team-table" aria-label={tr('Team Invitations', 'دعوات الفريق')}>
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
                    <tr key={inviteItem.id} data-testid={`invite-row-${inviteItem.id}`}>
                      <td className="team-text-wrap">{inviteItem.email}</td>
                      <td>{inviteItem.roleName}</td>
                      <td>
                        <span
                          className={`team-badge team-badge--${inviteItem.status}`}
                          data-testid={`invite-badge-${inviteItem.status}`}
                        >
                          {inviteItem.status}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                        {new Date(inviteItem.expiresAt).toLocaleDateString(
                          isArabic ? 'ar-EG' : 'en-US',
                          {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          },
                        )}
                      </td>
                      <td>
                        {inviteItem.status === 'pending' && actions?.revokeInvites === true && (
                          <button
                            type="button"
                            className="team-btn-danger"
                            disabled={busy}
                            onClick={() => void revokeInvite(inviteItem.id)}
                            aria-label={`${tr('Revoke', 'إلغاء')} ${inviteItem.email}`}
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

            {/* Mobile Invitations Cards */}
            <div className="team-cards-mobile-only" data-testid="invitations-mobile-cards">
              {overview.invites.map((inviteItem) => (
                <div key={inviteItem.id} className="team-member-mobile-card">
                  <div className="team-member-mobile-row">
                    <span className="team-text-wrap" style={{ fontWeight: 600 }}>
                      {inviteItem.email}
                    </span>
                    <span className={`team-badge team-badge--${inviteItem.status}`}>
                      {inviteItem.status}
                    </span>
                  </div>
                  <div
                    className="team-member-mobile-row"
                    style={{ fontSize: '0.82rem', color: 'hsl(var(--muted-foreground))' }}
                  >
                    <span>
                      {tr('Role', 'الدور')}: {inviteItem.roleName}
                    </span>
                    <span>
                      {tr('Expires', 'تنتهي')}:{' '}
                      {new Date(inviteItem.expiresAt).toLocaleDateString(
                        isArabic ? 'ar-EG' : 'en-US',
                        {
                          month: 'short',
                          day: 'numeric',
                        },
                      )}
                    </span>
                  </div>
                  {inviteItem.status === 'pending' && actions?.revokeInvites === true && (
                    <div style={{ marginTop: '0.25rem', textAlign: 'end' }}>
                      <button
                        type="button"
                        className="team-btn-danger"
                        disabled={busy}
                        onClick={() => void revokeInvite(inviteItem.id)}
                      >
                        {tr('Revoke Invitation', 'إلغاء الدعوة')}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Team Ownership Section — Unavailable Notice for Launch */}
      {viewer.isOwner && (
        <section className="team-section" data-testid="team-ownership-section">
          <div className="team-card" style={{ borderColor: 'hsl(var(--border) / 0.8)' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>
              👑 {tr('Team Ownership', 'ملكية الفريق')}
            </h3>
            <p
              style={{
                margin: '0.4rem 0 0',
                fontSize: '0.85rem',
                color: 'hsl(var(--muted-foreground))',
                lineHeight: 1.5,
              }}
              data-testid="ownership-transfer-unavailable-notice"
            >
              ℹ{' '}
              {tr(
                'Team ownership transfer is unavailable for launch. Workspace-wide asset control and ownership transfer actions are deferred.',
                'نقل ملكية الفريق غير متاح حالياً للإطلاق. إجراءات نقل الملكية والتحكم التام بالأصول مؤجلة.',
              )}
            </p>
          </div>
        </section>
      )}
    </div>
  );
};
