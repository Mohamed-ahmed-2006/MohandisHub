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

  const createRole = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = (form.elements.namedItem('roleName') as HTMLInputElement).value.trim();
    const permissions = BUSINESS_TEAM_PERMISSIONS.filter(
      (permission) => (form.elements.namedItem(permission) as HTMLInputElement)?.checked,
    );
    if (!name || permissions.length === 0) return;
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
    const form = event.currentTarget;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim();
    const roleId = (form.elements.namedItem('roleId') as HTMLSelectElement).value;
    if (!email || !roleId) return;
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
    try {
      setOverview(await businessTeamsApiClient.revokeInvite(accessToken, inviteId));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="dashboard-empty">{dictionary.admin.loading}</p>;
  if (!overview) return <p className="dashboard-error">{error}</p>;

  return (
    <section className="dashboard-section">
      <h3 className="dashboard-section-title">{tr('Team', 'الفريق')}</h3>
      {error && <p className="dashboard-error">{error}</p>}

      <div className="dashboard-cards">
        <div className="dashboard-card">
          <h4 className="dashboard-card-title">{tr('Invite member', 'دعوة عضو')}</h4>
          <form className="dashboard-form" onSubmit={(e) => void invite(e)}>
            <input
              name="email"
              type="email"
              className="dashboard-input"
              placeholder="name@example.com"
              required
            />
            <select name="roleId" className="dashboard-select" required>
              <option value="">{tr('Select role', 'اختر الدور')}</option>
              {overview.roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            <button className="dashboard-primary-btn" type="submit" disabled={busy}>
              {tr('Send invite', 'إرسال الدعوة')}
            </button>
          </form>
        </div>

        <div className="dashboard-card">
          <h4 className="dashboard-card-title">{tr('Create role', 'إنشاء دور')}</h4>
          <form className="dashboard-form" onSubmit={(e) => void createRole(e)}>
            <input
              name="roleName"
              className="dashboard-input"
              placeholder={tr('Role name', 'اسم الدور')}
              required
            />
            <div className="dashboard-actions-row">
              {BUSINESS_TEAM_PERMISSIONS.map((permission) => (
                <label key={permission} className="dashboard-chip">
                  <input name={permission} type="checkbox" />
                  {permission}
                </label>
              ))}
            </div>
            <button className="dashboard-primary-btn" type="submit" disabled={busy}>
              {tr('Create role', 'إنشاء الدور')}
            </button>
          </form>
        </div>
      </div>

      <div className="service-campaign-table-wrapper">
        <table className="service-campaign-table">
          <thead>
            <tr>
              <th>{tr('Member', 'العضو')}</th>
              <th>{tr('Email', 'البريد')}</th>
              <th>{tr('Role', 'الدور')}</th>
            </tr>
          </thead>
          <tbody>
            {overview.members.map((member) => (
              <tr key={member.id}>
                <td>{member.displayName ?? member.userId.slice(0, 8)}</td>
                <td>{member.email ?? '-'}</td>
                <td>{member.roleName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {overview.invites.length > 0 && (
        <div className="service-campaign-table-wrapper">
          <table className="service-campaign-table">
            <thead>
              <tr>
                <th>{tr('Invite', 'الدعوة')}</th>
                <th>{tr('Role', 'الدور')}</th>
                <th>{tr('Status', 'الحالة')}</th>
                <th>{tr('Actions', 'إجراءات')}</th>
              </tr>
            </thead>
            <tbody>
              {overview.invites.map((row) => (
                <tr key={row.id}>
                  <td>{row.email}</td>
                  <td>{row.roleName}</td>
                  <td>{row.status}</td>
                  <td>
                    {row.status === 'pending' && (
                      <button
                        className="dashboard-secondary-btn"
                        type="button"
                        disabled={busy}
                        onClick={() => void revokeInvite(row.id)}
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
      )}
    </section>
  );
};
