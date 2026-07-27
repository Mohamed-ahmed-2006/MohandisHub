'use client';

import type {
  AdminBulkUserAction,
  AdminBulkUserActionResult,
  AdminPermission,
  AdminUserListItem,
  PaginatedResponse,
  Plan,
} from '@mohandishub/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { AdminUserDetailModal } from './admin-user-detail-modal';

import { adminApiClient } from '@/lib/admin/client';
import type { Dictionary } from '@/lib/i18n/types';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  refreshSession: () => Promise<string | null>;
  adminPermissions: AdminPermission[];
};

export const AdminUsersTab = ({
  dictionary,
  accessToken,
  refreshSession,
  adminPermissions,
}: Props) => {
  const [data, setData] = useState<PaginatedResponse<AdminUserListItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [incompleteBusinessOnly, setIncompleteBusinessOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<AdminBulkUserAction | ''>('');
  const [bulkPlanId, setBulkPlanId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<AdminBulkUserActionResult | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);

  const d = dictionary.admin.users;
  const b = d.bulk;
  const canManageUsers =
    adminPermissions.includes('manage_users') || adminPermissions.includes('super_admin');
  const canManageTransactions =
    adminPermissions.includes('manage_transactions') || adminPermissions.includes('super_admin');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: {
        page: number;
        limit: number;
        role?: string;
        isActive?: string;
        search?: string;
        incompleteBusinessSignup?: string;
      } = { page, limit: 20 };
      if (incompleteBusinessOnly) {
        params.incompleteBusinessSignup = 'true';
      } else if (roleFilter) {
        params.role = roleFilter;
      }
      if (statusFilter) params.isActive = statusFilter;
      if (search) params.search = search;
      const result = await adminApiClient.getUsers(accessToken, params, { refreshSession });
      setData(result);
    } catch {
      /* empty */
    } finally {
      setLoading(false);
    }
  }, [accessToken, refreshSession, page, roleFilter, statusFilter, search, incompleteBusinessOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canManageUsers) return;
    void adminApiClient
      .getPlans(accessToken, { refreshSession })
      .then(setPlans)
      .catch(() => setPlans([]));
  }, [accessToken, canManageUsers, refreshSession]);

  const toggleUserSelection = (userId: string, checked: boolean) => {
    setBulkResult(null);
    setSelectedUserIds((current) => {
      if (!checked) return current.filter((id) => id !== userId);
      if (current.includes(userId) || current.length >= 100) return current;
      return [...current, userId];
    });
  };

  const toggleCurrentPage = (checked: boolean) => {
    if (!data) return;
    const pageIds = data.items.map((user) => user.id);
    setSelectedUserIds((current) => {
      if (!checked) return current.filter((id) => !pageIds.includes(id));
      return [...new Set([...current, ...pageIds])].slice(0, 100);
    });
  };

  const handleBulkAction = async () => {
    if (!bulkAction || selectedUserIds.length === 0) return;
    if (bulkAction === 'assign_plan' && !bulkPlanId) return;
    const count = selectedUserIds.length;
    const actionLabel: Record<AdminBulkUserAction, string> = {
      activate: b.activate,
      deactivate: b.deactivate,
      soft_delete: b.softDelete,
      force_logout: b.forceLogout,
      send_verification_email: b.sendVerification,
      verify_email: b.verifyEmail,
      freeze_wallet: b.freezeWallet,
      unfreeze_wallet: b.unfreezeWallet,
      assign_plan: b.assignPlan,
    };
    if (bulkAction === 'soft_delete') {
      const expected = `DELETE ${count}`;
      if (
        prompt(
          b.deletePrompt.replace('{expected}', expected).replace('{count}', String(count)),
        ) !== expected
      )
        return;
    } else if (
      !confirm(
        b.confirm
          .replace('{action}', actionLabel[bulkAction])
          .replace('{count}', String(count)),
      )
    ) {
      return;
    }

    setBulkBusy(true);
    setBulkResult(null);
    setBulkError(null);
    try {
      const result = await adminApiClient.bulkUserAction(
        accessToken,
        {
          operationId: crypto.randomUUID(),
          userIds: selectedUserIds,
          action: bulkAction,
          ...(bulkAction === 'assign_plan'
            ? { planId: bulkPlanId === '__none__' ? null : bulkPlanId }
            : {}),
        },
        { refreshSession },
      );
      setBulkResult(result);
      setSelectedUserIds([]);
      await load();
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : 'Bulk action failed.');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleAction = async (userId: string, action: 'activate' | 'deactivate' | 'delete') => {
    try {
      if (action === 'activate')
        await adminApiClient.activateUser(accessToken, userId, { refreshSession });
      else if (action === 'deactivate')
        await adminApiClient.deactivateUser(accessToken, userId, { refreshSession });
      else if (action === 'delete') {
        if (!confirm(d.confirmDelete)) return;
        await adminApiClient.deleteUser(accessToken, userId, { refreshSession });
      }
      void load();
    } catch {
      /* empty */
    }
  };

  return (
    <>
      <div className="admin-toolbar">
        <input
          className="admin-toolbar-search"
          type="text"
          placeholder={d.search}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="admin-toolbar-select"
          value={roleFilter}
          disabled={incompleteBusinessOnly}
          onChange={(e) => {
            setRoleFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{d.allRoles}</option>
          <option value="customer">Customer</option>
          <option value="expert">Expert</option>
          <option value="craftsman">Craftsman</option>
          <option value="business">Business</option>
          <option value="admin">Admin</option>
        </select>
        <select
          className="admin-toolbar-select"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{d.all}</option>
          <option value="true">{d.active}</option>
          <option value="false">{d.inactive}</option>
        </select>
        <label className="admin-toolbar-checkbox">
          <input
            type="checkbox"
            checked={incompleteBusinessOnly}
            onChange={(e) => {
              setIncompleteBusinessOnly(e.target.checked);
              if (e.target.checked) setRoleFilter('');
              setPage(1);
            }}
          />
          {d.filterIncompleteBusiness}
        </label>
      </div>

      {selectedUserIds.length > 0 && (
        <div className="admin-bulk-toolbar" role="region" aria-label={b.regionLabel}>
          <strong>
            {selectedUserIds.length} {b.selected}
          </strong>
          <select
            className="admin-toolbar-select"
            value={bulkAction}
            onChange={(event) => {
              setBulkAction(event.target.value as AdminBulkUserAction | '');
              setBulkResult(null);
            }}
            aria-label="Bulk action"
          >
            <option value="">{b.chooseAction}</option>
            {canManageUsers && (
              <>
                <option value="activate">{b.activate}</option>
                <option value="deactivate">{b.deactivate}</option>
                <option value="force_logout">{b.forceLogout}</option>
                <option value="send_verification_email">{b.sendVerification}</option>
                <option value="verify_email">{b.verifyEmail}</option>
                <option value="assign_plan">{b.assignPlan}</option>
                <option value="soft_delete">{b.softDelete}</option>
              </>
            )}
            {canManageTransactions && (
              <>
                <option value="freeze_wallet">{b.freezeWallet}</option>
                <option value="unfreeze_wallet">{b.unfreezeWallet}</option>
              </>
            )}
          </select>
          {bulkAction === 'assign_plan' && (
            <select
              className="admin-toolbar-select"
              value={bulkPlanId}
              onChange={(event) => setBulkPlanId(event.target.value)}
              aria-label="Plan to assign"
            >
              <option value="">{b.choosePlan}</option>
              <option value="__none__">{b.removePlan}</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            disabled={
              bulkBusy || !bulkAction || (bulkAction === 'assign_plan' && !bulkPlanId)
            }
            onClick={() => void handleBulkAction()}
          >
            {bulkBusy ? b.applying : b.apply}
          </button>
          <button
            type="button"
            className="admin-btn"
            disabled={bulkBusy}
            onClick={() => setSelectedUserIds([])}
          >
            {b.clear}
          </button>
          <span className="admin-bulk-limit">{b.limit}</span>
        </div>
      )}

      {bulkResult && (
        <div
          className={`admin-bulk-result ${bulkResult.failedCount > 0 ? 'admin-bulk-result--warning' : ''}`}
          role="status"
        >
          {b.completed
            .replace('{succeeded}', String(bulkResult.succeededCount))
            .replace('{skipped}', String(bulkResult.skippedCount))
            .replace('{failed}', String(bulkResult.failedCount))}
          {bulkResult.items.some((item) => item.status === 'failed') && (
            <ul>
              {bulkResult.items
                .filter((item) => item.status === 'failed')
                .slice(0, 10)
                .map((item) => (
                  <li key={item.userId}>
                    {item.userId}: {item.message ?? item.code ?? 'Failed'}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
      {bulkError && <p className="admin-error-banner">{bulkError}</p>}

      {loading ? (
        <p className="admin-empty">{dictionary.admin.loading}</p>
      ) : !data || data.items.length === 0 ? (
        <p className="admin-empty">{d.noUsers}</p>
      ) : (
        <>
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={
                        data.items.length > 0 &&
                        data.items.every((user) => selectedUserIds.includes(user.id))
                      }
                      onChange={(event) => toggleCurrentPage(event.target.checked)}
                      aria-label={b.selectPage}
                    />
                  </th>
                  <th>{d.name}</th>
                  <th>{d.email}</th>
                  <th>{d.role}</th>
                  <th>{d.status}</th>
                  <th>{d.plan}</th>
                  <th>{d.joined}</th>
                  <th>{d.actions}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(user.id)}
                        disabled={
                          !selectedUserIds.includes(user.id) && selectedUserIds.length >= 100
                        }
                        onChange={(event) => toggleUserSelection(user.id, event.target.checked)}
                        aria-label={`Select ${user.displayName}`}
                      />
                    </td>
                    <td>{user.displayName}</td>
                    <td>{user.email}</td>
                    <td>
                      <span className="admin-badge">{user.primaryRole}</span>
                      {user.incompleteBusinessSignup ? (
                        <span
                          className="admin-badge admin-badge--warn"
                          title={d.badgeIncompleteBusiness}
                        >
                          {d.badgeIncompleteBusiness}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={`admin-badge ${user.isActive ? 'admin-badge--active' : 'admin-badge--inactive'}`}
                      >
                        {user.isActive ? d.active : d.inactive}
                      </span>
                    </td>
                    <td>{user.planName ?? '—'}</td>
                    <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div className="admin-actions-row">
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-btn--primary"
                          onClick={() => setSelectedUserId(user.id)}
                        >
                          {d.view}
                        </button>
                        {user.isActive ? (
                          <button
                            type="button"
                            className="admin-btn admin-btn--small"
                            onClick={() => void handleAction(user.id, 'deactivate')}
                          >
                            {d.deactivate}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="admin-btn admin-btn--small admin-btn--success"
                            onClick={() => void handleAction(user.id, 'activate')}
                          >
                            {d.activate}
                          </button>
                        )}
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-btn--danger"
                          onClick={() => void handleAction(user.id, 'delete')}
                        >
                          {d.delete}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.totalPages > 1 && (
            <div className="admin-pagination">
              <button
                type="button"
                className="admin-btn admin-btn--small"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} aria-hidden />
              </button>
              <span className="admin-pagination-info">
                {page} / {data.totalPages}
              </span>
              <button
                type="button"
                className="admin-btn admin-btn--small"
                disabled={page >= data.totalPages}
                onClick={() => setPage(page + 1)}
                aria-label="Next page"
              >
                <ChevronRight size={16} aria-hidden />
              </button>
            </div>
          )}
        </>
      )}

      {selectedUserId && (
        <AdminUserDetailModal
          dictionary={dictionary}
          accessToken={accessToken}
          refreshSession={refreshSession}
          adminPermissions={adminPermissions}
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
          onSuccess={() => void load()}
        />
      )}
    </>
  );
};
