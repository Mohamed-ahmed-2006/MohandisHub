'use client';

import type { AdminUserDetail, Plan } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

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
  }, [accessToken, userId]);

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
        { primaryRole: editRole as 'customer' | 'expert' | 'business' | 'admin' },
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

  const handleUpdatePlan = async () => {
    if (!user || editPlanId === undefined) return;
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

  if (!userId) return null;

  return (
    <div className="admin-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="admin-modal admin-modal--wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <h2 className="admin-modal-title">{ud.title}</h2>

        {loading ? (
          <p className="admin-empty">{dictionary.admin.loading}</p>
        ) : !user ? (
          <p className="admin-empty">{d.noUsers}</p>
        ) : (
          <>
            <div className="admin-user-detail-grid">
              <section className="admin-user-detail-section">
                <h3 className="admin-user-detail-section-title">{ud.basicInfo}</h3>
                <dl className="admin-user-detail-dl">
                  <dt>{d.name}</dt>
                  <dd>{user.displayName}</dd>
                  <dt>{d.email}</dt>
                  <dd>{user.email}</dd>
                  <dt>{ud.phone}</dt>
                  <dd>{user.phone ?? '—'}</dd>
                  <dt>{ud.nationality}</dt>
                  <dd>{user.nationality ?? '—'}</dd>
                  <dt>{ud.dateOfBirth}</dt>
                  <dd>
                    {user.dateOfBirth ? new Date(user.dateOfBirth).toLocaleDateString() : '—'}
                  </dd>
                  <dt>{ud.emailVerified}</dt>
                  <dd>{user.emailVerifiedAt ? ud.yes : ud.no}</dd>
                  <dt>{ud.lastLogin}</dt>
                  <dd>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}</dd>
                  <dt>{ud.createdAt}</dt>
                  <dd>{new Date(user.createdAt).toLocaleDateString()}</dd>
                  <dt>{d.role}</dt>
                  <dd>
                    {editRole !== null ? (
                      <span className="admin-inline-edit">
                        <select
                          className="admin-form-select admin-form-select--inline"
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value)}
                        >
                          <option value="customer">Customer</option>
                          <option value="expert">Expert</option>
                          <option value="business">Business</option>
                          <option value="admin">Admin</option>
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
                      </span>
                    ) : (
                      <span>
                        <span className="admin-badge">{user.primaryRole}</span>
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-inline-action-btn"
                          onClick={() => setEditRole(user.primaryRole)}
                        >
                          {ud.changeRole}
                        </button>
                      </span>
                    )}
                  </dd>
                  <dt>{d.plan}</dt>
                  <dd>
                    {editPlanId !== null ? (
                      <span className="admin-inline-edit">
                        <select
                          className="admin-form-select admin-form-select--inline"
                          value={editPlanId}
                          onChange={(e) => setEditPlanId(e.target.value)}
                        >
                          <option value="">— None —</option>
                          {plans.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
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
                      </span>
                    ) : (
                      <span>
                        {user.planName ?? '—'}
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-inline-action-btn"
                          onClick={() =>
                            setEditPlanId(plans.find((p) => p.slug === user.planSlug)?.id ?? '')
                          }
                        >
                          {ud.changePlan}
                        </button>
                      </span>
                    )}
                  </dd>
                  <dt>{d.status}</dt>
                  <dd>
                    <span
                      className={`admin-badge ${user.isActive ? 'admin-badge--active' : 'admin-badge--inactive'}`}
                    >
                      {user.isActive ? d.active : d.inactive}
                    </span>
                  </dd>
                </dl>
              </section>

              <section className="admin-user-detail-section">
                <h3 className="admin-user-detail-section-title">{ud.wallet}</h3>
                <dl className="admin-user-detail-dl">
                  <dt>{ud.balance}</dt>
                  <dd>
                    {user.walletBalance != null
                      ? `${user.walletBalance.toFixed(2)} ${user.walletCurrency ?? 'EGP'}`
                      : '—'}
                  </dd>
                </dl>
                {showAdjust ? (
                  <div className="admin-form-group">
                    <label className="admin-form-label">{ud.adjustBalance}</label>
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
                    <div className="admin-modal-actions">
                      <button
                        type="button"
                        className="admin-btn admin-btn--primary"
                        onClick={() => void handleAdjust()}
                        disabled={actionLoading === 'adjust' || adjustForm.amount <= 0}
                      >
                        {dictionary.common.save}
                      </button>
                      <button
                        type="button"
                        className="admin-btn"
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

              <section className="admin-user-detail-section admin-user-detail-actions">
                <h3 className="admin-user-detail-section-title">{ud.actions}</h3>
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
                  <button
                    type="button"
                    className="admin-btn admin-btn--small admin-btn--danger"
                    onClick={() => void handleDelete()}
                    disabled={!!actionLoading}
                  >
                    {d.delete}
                  </button>
                </div>
              </section>
            </div>
          </>
        )}

        <div className="admin-modal-actions" style={{ marginTop: '1rem' }}>
          <button type="button" className="admin-btn" onClick={onClose}>
            {dictionary.common.back}
          </button>
        </div>
      </div>
    </div>
  );
};
