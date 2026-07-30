'use client';

import type { BusinessTeamOverview } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { BUSINESS_TEAM_PERMISSIONS, businessTeamsApiClient } from '@/lib/business-teams/client';
import type { Dictionary } from '@/lib/i18n/types';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
};

type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export const BusinessTeamPanel = ({ dictionary, accessToken }: Props) => {
  const { authUser } = useAuth();
  const [overview, setOverview] = useState<BusinessTeamOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noticeModal, setNoticeModal] = useState<{ title: string; message: string } | null>(null);
  const [formValidationError, setFormValidationError] = useState<string | null>(null);

  const isArabic = /[\u0600-\u06FF]/.test(dictionary.nav?.home ?? '');
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

  // Determine current user's workspace role
  const currentUserMember = overview?.members.find((m) => m.userId === authUser?.id);
  const userWorkspaceRole: WorkspaceRole = currentUserMember
    ? currentUserMember.roleKey === 'owner'
      ? 'owner'
      : currentUserMember.roleKey === 'manager' || currentUserMember.roleKey === 'admin'
        ? 'admin'
        : 'member'
    : authUser?.role === 'business'
      ? 'owner'
      : 'member';

  const canAdministerTeam = userWorkspaceRole === 'owner' || userWorkspaceRole === 'admin';
  const isOwner = userWorkspaceRole === 'owner';

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
      setFormValidationError(
        tr('Select at least one permission.', 'اختر إذنًا واحدًا على الأقل.'),
      );
      return;
    }

    setBusy(true);
    setError(null);
    try {
      setOverview(await businessTeamsApiClient.createRole(accessToken, { name, permissions }));
      form.reset();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tr('Could not create role.', 'تعذر إنشاء الدور.'),
      );
    } finally {
      setBusy(false);
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
      setFormValidationError(tr('Please enter a valid email address.', 'يرجى إدخال بريد إلكتروني صحيح.'));
      return;
    }
    if (!roleId) {
      setFormValidationError(tr('Please select a business role.', 'يرجى اختيار دور وظيفي.'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      setOverview(await businessTeamsApiClient.createInvite(accessToken, { email, roleId }));
      form.reset();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tr('Could not send invite.', 'تعذر إرسال الدعوة.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const revokeInvite = async (inviteId: string) => {
    setBusy(true);
    setError(null);
    try {
      setOverview(await businessTeamsApiClient.revokeInvite(accessToken, inviteId));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tr('Could not revoke invite.', 'تعذر إلغاء الدعوة.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveMemberClick = (memberDisplayName: string, memberId: string) => {
    setNoticeModal({
      title: tr('Member Removal Unavailable', 'إزالة العضو غير متاحة حالياً'),
      message: tr(
        `Member removal for "${memberDisplayName}" is currently pending backend API deployment (Required Contract: DELETE /api/v1/business-teams/members/${memberId}). Frontend action is safely disabled until backend implementation completes.`,
        `إزالة العضو "${memberDisplayName}" معطلة حالياً بنظرة انتظر نشر API الخلفي المطلوب (العقد: DELETE /api/v1/business-teams/members/${memberId}). الإجراء غير مفعل حتى اكتمال الدعم البرمجي.`,
      ),
    });
  };

  const handleTransferOwnershipClick = () => {
    setNoticeModal({
      title: tr('Ownership Transfer Unavailable', 'نقل الملكية غير متاح حالياً'),
      message: tr(
        'Workspace ownership transfer is pending backend API deployment (Required Contract: POST /api/v1/business-teams/transfer-ownership). Ownership transfer remains safely unavailable.',
        'نقل ملكية مساحة العمل معطل حالياً بانتظار نشر API الخلفي المطلوب (العقد: POST /api/v1/business-teams/transfer-ownership). نقل الملكية غير متاح مؤقتاً.',
      ),
    });
  };

  if (loading) return <p className="dashboard-empty">{dictionary.admin.loading}</p>;
  if (!overview) return <p className="dashboard-error">{error}</p>;

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
          <span className="dashboard-card-meta">{tr('Your Workspace Role', 'دورك في مساحة العمل')}:</span>
          <span
            className={`dashboard-badge dashboard-badge--${userWorkspaceRole}`}
            style={{
              padding: '0.35rem 0.85rem',
              borderRadius: '20px',
              fontWeight: 600,
              fontSize: '0.85rem',
              textTransform: 'capitalize',
            }}
          >
            {userWorkspaceRole === 'owner'
              ? tr('Owner', 'مالك')
              : userWorkspaceRole === 'admin'
                ? tr('Admin', 'مسؤول')
                : tr('Member', 'عضو')}
          </span>
        </div>
      </div>

      {error && <p className="dashboard-error" style={{ marginBottom: '1rem' }}>{error}</p>}
      {formValidationError && (
        <p className="dashboard-error" style={{ marginBottom: '1rem' }}>{formValidationError}</p>
      )}

      {/* Notice Modal / Banner for Pending Endpoints */}
      {noticeModal && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '8px',
            padding: '1rem',
            marginBottom: '1.5rem',
            position: 'relative',
          }}
        >
          <h4 style={{ color: '#ef4444', margin: '0 0 0.5rem 0', fontSize: '1rem' }}>
            ⚠️ {noticeModal.title}
          </h4>
          <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: '1.4' }}>{noticeModal.message}</p>
          <button
            type="button"
            className="dashboard-secondary-btn"
            style={{ marginTop: '0.75rem', padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
            onClick={() => setNoticeModal(null)}
          >
            {tr('Dismiss', 'إغلاق')}
          </button>
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
                required
              />
              <select name="roleId" className="dashboard-select" required defaultValue="">
                <option value="" disabled>
                  {tr('Select role', 'اختر الدور')}
                </option>
                {overview.roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name} ({role.key})
                  </option>
                ))}
              </select>
              <button className="dashboard-primary-btn" type="submit" disabled={busy}>
                {busy ? tr('Sending...', 'جاري الإرسال...') : tr('Send Invitation', 'إرسال الدعوة')}
              </button>
            </form>
          </div>

          {isOwner && (
            <div className="dashboard-card">
              <h4 className="dashboard-card-title">{tr('Create Custom Role', 'إنشاء دور مخصص')}</h4>
              <form className="dashboard-form" onSubmit={(e) => void createRole(e)}>
                <input
                  name="roleName"
                  className="dashboard-input"
                  placeholder={tr('Role name (e.g. Operations)', 'اسم الدور (مثال: العمليات)')}
                  required
                />
                <div className="dashboard-actions-row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                  {BUSINESS_TEAM_PERMISSIONS.map((permission) => (
                    <label key={permission} className="dashboard-chip" style={{ fontSize: '0.8rem' }}>
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
            ℹ {tr(
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
              {overview.members.map((member) => {
                const isMemberOwner = member.roleKey === 'owner';
                return (
                  <tr key={member.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>
                        {member.displayName ?? member.userId.slice(0, 8)}
                      </div>
                    </td>
                    <td>{member.email ?? '-'}</td>
                    <td>
                      <span className={`dashboard-badge dashboard-badge--${member.roleKey}`}>
                        {member.roleName}
                      </span>
                    </td>
                    <td>
                      {canAdministerTeam && !isMemberOwner && (
                        <button
                          type="button"
                          className="dashboard-secondary-btn"
                          style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', color: '#ef4444' }}
                          onClick={() => handleRemoveMemberClick(member.displayName ?? member.email ?? 'Member', member.id)}
                        >
                          {tr('Remove', 'إزالة')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
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
                      {inviteItem.status === 'pending' && canAdministerTeam && (
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
      {isOwner && (
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
            <p className="dashboard-card-meta" style={{ margin: '0.2rem 0 0', fontSize: '0.85rem' }}>
              {tr(
                'Transfer primary ownership of this business workspace to another member.',
                'نقل الملكية الرئيسية لمساحة العمل هذه إلى عضو آخر.',
              )}
            </p>
          </div>
          <button
            type="button"
            className="dashboard-secondary-btn"
            style={{ fontSize: '0.85rem' }}
            onClick={handleTransferOwnershipClick}
          >
            {tr('Transfer Ownership', 'نقل الملكية')}
          </button>
        </div>
      )}
    </section>
  );
};
