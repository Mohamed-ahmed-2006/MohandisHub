'use client';

import type { AdminUserListItem, PaginatedResponse } from '@mohandishub/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { AdminUserDetailModal } from './admin-user-detail-modal';

import { adminApiClient } from '@/lib/admin/client';
import type { Dictionary } from '@/lib/i18n/types';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  refreshSession: () => Promise<string | null>;
  adminPermissions: string[];
};

export const AdminUsersTab = ({ dictionary, accessToken, refreshSession, adminPermissions }: Props) => {
  const [data, setData] = useState<PaginatedResponse<AdminUserListItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const d = dictionary.admin.users;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: {
        page: number;
        limit: number;
        role?: string;
        isActive?: string;
        search?: string;
      } = { page, limit: 20 };
      if (roleFilter) params.role = roleFilter;
      if (statusFilter) params.isActive = statusFilter;
      if (search) params.search = search;
      const result = await adminApiClient.getUsers(accessToken, params, { refreshSession });
      setData(result);
    } catch {
      /* empty */
    } finally {
      setLoading(false);
    }
  }, [accessToken, refreshSession, page, roleFilter, statusFilter, search]);

  useEffect(() => {
    void load();
  }, [load]);

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
      </div>

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
                    <td>{user.displayName}</td>
                    <td>{user.email}</td>
                    <td>
                      <span className="admin-badge">{user.primaryRole}</span>
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
