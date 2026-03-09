'use client';

import type { AdminUserDetail, Plan } from '@mohandishub/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { adminApiClient } from '@/lib/admin/client';
import type { Dictionary } from '@/lib/i18n/types';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  refreshSession: () => Promise<string | null>;
  userId: string | null;
  onClose: () => void;
  onSuccess: () => void;
};

const opts = (refreshSession: () => Promise<string | null>) => ({ refreshSession });

const formatDate = (value: string | null): string => {
  if (!value) return '-';
  return new Date(value).toLocaleDateString();
};

const formatDateTime = (value: string | null): string => {
  if (!value) return '-';
  return new Date(value).toLocaleString();
};

export const AdminUserDetailModal = ({
  dictionary,
  accessToken,
  refreshSession,
  userId,
  onClose,
  onSuccess,
}: Props) => {
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustForm, setAdjustForm] = useState({
    type: 'deposit' as string,
    amount: 0,
    description: '',
  });
  const [editRole, setEditRole] = useState<string | null>(null);
  const [editPlanId, setEditPlanId] = useState<string | null>(null);
  const [editAdmin, setEditAdmin] = useState<boolean | null>(null);
  const [editAdminPermissions, setEditAdminPermissions] = useState<string[] | null>(null);

  const availablePermissions = [
    { id: 'manage_users', label: 'Manage Users' },
    { id: 'manage_plans', label: 'Manage Plans' },
    { id: 'manage_transactions', label: 'Manage Transactions' },
    { id: 'manage_services', label: 'Manage Services' },
    { id: 'manage_verifications', label: 'Manage Verifications' },
    { id: 'manage_settings', label: 'Manage App Settings' },
  ];

  const d = dictionary.admin.users;
  const ud = d.userDetail;

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [userData, plansData] = await Promise.all([
        adminApiClient.getUserDetail(accessToken, userId, opts(refreshSession)),
        adminApiClient.getPlans(accessToken, opts(refreshSession)),
      ]);
      setUser(userData);
      setPlans(plansData);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, refreshSession, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdjust = async () => {
    if (!user) return;
    setActionLoading('adjust');
    try {
      const body: {
        userId: string;
        type: 'deposit' | 'withdrawal' | 'adjustment' | 'bonus';
        amount: number;
        description?: string;
      } = {
        userId: user.id,
        type: adjustForm.type as 'deposit' | 'withdrawal' | 'adjustment' | 'bonus',
        amount: adjustForm.amount,
      };
      if (adjustForm.description) body.description = adjustForm.description;
      await adminApiClient.adjustBalance(accessToken, body, opts(refreshSession));
      setShowAdjust(false);
      setAdjustForm({ type: 'deposit', amount: 0, description: '' });
      void load();
      onSuccess();
    } catch {
      /* empty */
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdateRole = async () => {
    if (!user || !editRole) return;
    setActionLoading('role');
    try {
      await adminApiClient.updateUser(
        accessToken,
        user.id,
        { primaryRole: editRole as 'customer' | 'expert' | 'business' },
        opts(refreshSession),
      );
      setEditRole(null);
      void load();
      onSuccess();
    } catch {
      /* empty */
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdateAdmin = async () => {
    if (!user || editAdmin === null) return;
    setActionLoading('admin');
    try {
      const body: { isAdmin: boolean; adminPermissions?: string[] } = { isAdmin: editAdmin };
      if (editAdminPermissions) {
        body.adminPermissions = editAdminPermissions;
      }
      await adminApiClient.updateUser(
        accessToken,
        user.id,
        body,
        opts(refreshSession),
      );
      setEditAdmin(null);
      setEditAdminPermissions(null);
      void load();
      onSuccess();
    } catch {
      /* empty */
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdatePlan = async () => {
    if (!user || editPlanId === null) return;
    setActionLoading('plan');
    try {
      await adminApiClient.updateUser(
        accessToken,
        user.id,
        { planId: editPlanId || null },
        opts(refreshSession),
      );
      setEditPlanId(null);
      void load();
      onSuccess();
    } catch {
      /* empty */
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendVerification = async () => {
    if (!user) return;
    setActionLoading('sendVerification');
    try {
      await adminApiClient.sendVerificationEmail(accessToken, user.id, opts(refreshSession));
      void load();
      onSuccess();
    } catch {
      /* empty */
    } finally {
      setActionLoading(null);
    }
  };

  const handleVerifyEmail = async () => {
    if (!user) return;
    setActionLoading('verifyEmail');
    try {
      await adminApiClient.verifyEmail(accessToken, user.id, opts(refreshSession));
      void load();
      onSuccess();
    } catch {
      /* empty */
    } finally {
      setActionLoading(null);
    }
  };

  const handleActivateDeactivate = async () => {
    if (!user) return;
    setActionLoading('activate');
    try {
      if (user.isActive) {
        await adminApiClient.deactivateUser(accessToken, user.id, opts(refreshSession));
      } else {
        await adminApiClient.activateUser(accessToken, user.id, opts(refreshSession));
      }
      void load();
      onSuccess();
    } catch {
      /* empty */
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!user || !confirm(d.confirmDelete)) return;
    setActionLoading('delete');
    try {
      await adminApiClient.deleteUser(accessToken, user.id, opts(refreshSession));
      onSuccess();
      onClose();
    } catch {
      /* empty */
    } finally {
      setActionLoading(null);
    }
  };

  const userInitials = useMemo(() => {
    if (!user) return 'U';
    const parts = user.displayName.split(' ').filter(Boolean);
    if (parts.length === 0) return 'U';
    return parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }, [user]);

  if (!userId) return null;

  return (
    <div className="admin-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="admin-modal admin-modal--profile"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        {loading ? (
          <p className="admin-empty">{dictionary.admin.loading}</p>
        ) : !user ? (
          <p className="admin-empty">{d.noUsers}</p>
        ) : (
          <>
            <header className="admin-user-modal-header">
              <div className="admin-user-modal-identity">
                <span className="admin-user-modal-avatar" aria-hidden>
                  {userInitials}
                </span>
                <div>
                  <h2 className="admin-modal-title">{user.displayName}</h2>
                  <p className="admin-user-modal-subtitle">{user.email}</p>
                  <div className="admin-user-modal-chips">
                    <span className="admin-badge">{user.primaryRole}</span>
                    {user.isAdmin && <span className="admin-badge admin-badge--admin">Admin</span>}
                    <span
                      className={`admin-badge ${user.isActive ? 'admin-badge--active' : 'admin-badge--inactive'}`}
                    >
                      {user.isActive ? d.active : d.inactive}
                    </span>
                    <span className="admin-badge">
                      {ud.emailVerified}: {user.emailVerifiedAt ? ud.yes : ud.no}
                    </span>
                  </div>
                </div>
              </div>
              <button type="button" className="admin-btn admin-btn--small" onClick={onClose}>
                {dictionary.common.back}
              </button>
            </header>

            <div className="admin-user-modal-layout">
              <div className="admin-user-modal-main">
                <section className="admin-user-card">
                  <h3 className="admin-user-card-title">{ud.basicInfo}</h3>
                  <div className="admin-user-field-grid">
                    <div className="admin-user-field">
                      <span className="admin-user-field-label">{ud.phone}</span>
                      <span className="admin-user-field-value">{user.phone ?? '-'}</span>
                    </div>
                    <div className="admin-user-field">
                      <span className="admin-user-field-label">{ud.nationality}</span>
                      <span className="admin-user-field-value">{user.nationality ?? '-'}</span>
                    </div>
                    <div className="admin-user-field">
                      <span className="admin-user-field-label">{ud.dateOfBirth}</span>
                      <span className="admin-user-field-value">{formatDate(user.dateOfBirth)}</span>
                    </div>
                    <div className="admin-user-field">
                      <span className="admin-user-field-label">{ud.createdAt}</span>
                      <span className="admin-user-field-value">{formatDate(user.createdAt)}</span>
                    </div>
                    <div className="admin-user-field">
                      <span className="admin-user-field-label">{ud.lastLogin}</span>
                      <span className="admin-user-field-value">{formatDateTime(user.lastLoginAt)}</span>
                    </div>
                    <div className="admin-user-field">
                      <span className="admin-user-field-label">{d.plan}</span>
                      <span className="admin-user-field-value">{user.planName ?? '-'}</span>
                    </div>
                  </div>
                </section>

                <section className="admin-user-card">
                  <h3 className="admin-user-card-title">
                    {d.role} / {d.plan}
                  </h3>

                  <div className="admin-user-control-row">
                    <span className="admin-user-field-label">{d.role}</span>
                    {editRole !== null ? (
                      <div className="admin-inline-edit">
                        <select
                          className="admin-form-select admin-form-select--inline"
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value)}
                        >
                          <option value="customer">Customer</option>
                          <option value="expert">Expert</option>
                          <option value="business">Business</option>
                        </select>
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-btn--primary"
                          onClick={() => void handleUpdateRole()}
                          disabled={actionLoading === 'role'}
                        >
                          {dictionary.common.save}
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn--small"
                          onClick={() => setEditRole(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="admin-inline-edit">
                        <span className="admin-badge">{user.primaryRole}</span>
                        <button
                          type="button"
                          className="admin-btn admin-btn--small"
                          onClick={() => setEditRole(user.primaryRole)}
                        >
                          {ud.changeRole}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="admin-user-control-row">
                    <span className="admin-user-field-label">{ud.adminFlag}</span>
                    {editAdmin !== null ? (
                      <div className="admin-inline-edit" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <label className="admin-inline-checkbox">
                            <input
                              type="checkbox"
                              checked={editAdmin}
                              onChange={(e) => setEditAdmin(e.target.checked)}
                            />
                            {editAdmin ? ud.yes : ud.no}
                          </label>
                          <button
                            type="button"
                            className="admin-btn admin-btn--small admin-btn--primary"
                            onClick={() => void handleUpdateAdmin()}
                            disabled={actionLoading === 'admin'}
                          >
                            {dictionary.common.save}
                          </button>
                          <button
                            type="button"
                            className="admin-btn admin-btn--small"
                            onClick={() => {
                              setEditAdmin(null);
                              setEditAdminPermissions(null);
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                        {editAdmin && (
                          <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: '#f5f5f5', borderRadius: '4px' }}>
                            <p style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem' }}>Permissions</p>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                              {availablePermissions.map(p => (
                                <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}>
                                  <input
                                    type="checkbox"
                                    checked={editAdminPermissions?.includes(p.id) || false}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setEditAdminPermissions([...(editAdminPermissions || []), p.id]);
                                      } else {
                                        setEditAdminPermissions((editAdminPermissions || []).filter(id => id !== p.id));
                                      }
                                    }}
                                  />
                                  {p.label}
                                </label>
                              ))}
                            </div>
                            <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}>If none selected, full access is granted.</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="admin-inline-edit" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <span className={`admin-badge ${user.isAdmin ? 'admin-badge--admin' : ''}`}>
                            {user.isAdmin ? ud.yes : ud.no}
                          </span>
                          <button
                            type="button"
                            className="admin-btn admin-btn--small"
                            onClick={() => {
                              setEditAdmin(Boolean(user.isAdmin));
                              setEditAdminPermissions(user.adminPermissions || []);
                            }}
                          >
                            {ud.changeAdmin}
                          </button>
                        </div>
                        {user.isAdmin && user.adminPermissions && user.adminPermissions.length > 0 && (
                          <div style={{ fontSize: '0.85rem', color: '#555' }}>
                            Permissions: {user.adminPermissions.map(p => availablePermissions.find(ap => ap.id === p)?.label || p).join(', ')}
                          </div>
                        )}
                        {user.isAdmin && (!user.adminPermissions || user.adminPermissions.length === 0) && (
                          <div style={{ fontSize: '0.85rem', color: '#555' }}>
                            Permissions: Full Access
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="admin-user-control-row">
                    <span className="admin-user-field-label">{d.plan}</span>
                    {editPlanId !== null ? (
                      <div className="admin-inline-edit">
                        <select
                          className="admin-form-select admin-form-select--inline"
                          value={editPlanId}
                          onChange={(e) => setEditPlanId(e.target.value)}
                        >
                          <option value="">- None -</option>
                          {plans.map((plan) => (
                            <option key={plan.id} value={plan.id}>
                              {plan.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-btn--primary"
                          onClick={() => void handleUpdatePlan()}
                          disabled={actionLoading === 'plan'}
                        >
                          {dictionary.common.save}
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn--small"
                          onClick={() => setEditPlanId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="admin-inline-edit">
                        <span className="admin-user-field-value">{user.planName ?? '-'}</span>
                        <button
                          type="button"
                          className="admin-btn admin-btn--small"
                          onClick={() =>
                            setEditPlanId(plans.find((plan) => plan.slug === user.planSlug)?.id ?? '')
                          }
                        >
                          {ud.changePlan}
                        </button>
                      </div>
                    )}
                  </div>
                </section>

                <section className="admin-user-card">
                  <h3 className="admin-user-card-title">{ud.wallet}</h3>
                  <div className="admin-user-wallet-balance">
                    {user.walletBalance != null
                      ? `${user.walletBalance.toFixed(2)} ${user.walletCurrency ?? 'EGP'}`
                      : '-'}
                  </div>

                  {showAdjust ? (
                    <div className="admin-user-wallet-form">
                      <select
                        className="admin-form-select"
                        value={adjustForm.type}
                        onChange={(e) => setAdjustForm((f) => ({ ...f, type: e.target.value }))}
                      >
                        <option value="deposit">Deposit</option>
                        <option value="withdrawal">Withdrawal</option>
                        <option value="adjustment">Adjustment</option>
                        <option value="bonus">Bonus</option>
                      </select>
                      <input
                        type="number"
                        className="admin-form-input"
                        placeholder="Amount"
                        value={adjustForm.amount || ''}
                        onChange={(e) =>
                          setAdjustForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))
                        }
                      />
                      <input
                        type="text"
                        className="admin-form-input"
                        placeholder="Description"
                        value={adjustForm.description}
                        onChange={(e) =>
                          setAdjustForm((f) => ({ ...f, description: e.target.value }))
                        }
                      />
                      <div className="admin-inline-edit">
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-btn--primary"
                          onClick={() => void handleAdjust()}
                          disabled={actionLoading === 'adjust' || adjustForm.amount <= 0}
                        >
                          {dictionary.common.save}
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn--small"
                          onClick={() => setShowAdjust(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="admin-btn admin-btn--small"
                      onClick={() => setShowAdjust(true)}
                    >
                      {ud.adjustBalance}
                    </button>
                  )}
                </section>
              </div>

              <aside className="admin-user-modal-side">
                <section className="admin-user-card">
                  <h3 className="admin-user-card-title">{ud.actions}</h3>
                  <div className="admin-actions-row admin-actions-row--column">
                    {!user.emailVerifiedAt && (
                      <>
                        <button
                          type="button"
                          className="admin-btn admin-btn--small"
                          onClick={() => void handleSendVerification()}
                          disabled={!!actionLoading}
                        >
                          {ud.sendVerificationEmail}
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-btn--success"
                          onClick={() => void handleVerifyEmail()}
                          disabled={!!actionLoading}
                        >
                          {ud.verifyEmail}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className={`admin-btn admin-btn--small ${user.isActive ? '' : 'admin-btn--success'}`}
                      onClick={() => void handleActivateDeactivate()}
                      disabled={!!actionLoading}
                    >
                      {user.isActive ? d.deactivate : d.activate}
                    </button>
                  </div>
                </section>

                <section className="admin-user-card admin-user-card--danger">
                  <h3 className="admin-user-card-title">{d.delete}</h3>
                  <button
                    type="button"
                    className="admin-btn admin-btn--small admin-btn--danger"
                    onClick={() => void handleDelete()}
                    disabled={!!actionLoading}
                  >
                    {d.delete}
                  </button>
                </section>
              </aside>
            </div>
          </>
        )}

        <div className="admin-user-modal-footer">
          <button type="button" className="admin-btn" onClick={onClose}>
            {dictionary.common.back}
          </button>
        </div>
      </div>
    </div>
  );
};
