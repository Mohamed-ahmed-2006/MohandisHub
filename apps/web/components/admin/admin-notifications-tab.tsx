'use client';

import { useCallback, useState } from 'react';

import { adminApiClient } from '@/lib/admin/client';
import { isApiClientError } from '@/lib/auth/client';
import type { Dictionary } from '@/lib/i18n/types';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  refreshSession: () => Promise<string | null>;
};

type Target = 'all' | 'users' | 'role';

export const AdminNotificationsTab = ({ dictionary, accessToken, refreshSession }: Props) => {
  const [target, setTarget] = useState<Target>('all');
  const [userIdsText, setUserIdsText] = useState('');
  const [role, setRole] = useState<string>('customer');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const tabsLabel = dictionary.admin?.tabs?.notifications ?? 'Notifications';
  const sendLabel = dictionary.common?.submit ?? 'Submit';

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setSuccess(null);
      let userIds: string[] | undefined;
      if (target === 'users') {
        userIds = userIdsText
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (userIds.length === 0) {
          setError('Enter at least one user ID when targeting specific users.');
          return;
        }
      }
      const body: {
        target: 'all' | 'users' | 'role';
        userIds?: string[];
        role?: string;
        title: string;
        message: string;
      } = {
        target,
        title: title.trim(),
        message: message.trim(),
      };
      if (target === 'users' && userIds !== undefined) body.userIds = userIds;
      if (target === 'role') body.role = role;

      if (!body.title || !body.message) {
        setError('Title and message are required.');
        return;
      }

      setSending(true);
      try {
        const result = await adminApiClient.sendNotification(accessToken, body, { refreshSession });
        setSuccess(`Notification sent to ${result.created} user(s).`);
        setTitle('');
        setMessage('');
        setUserIdsText('');
      } catch (err: unknown) {
        setError(isApiClientError(err) ? err.message : 'Failed to send notification.');
      } finally {
        setSending(false);
      }
    },
    [target, userIdsText, role, title, message, accessToken, refreshSession],
  );

  return (
    <div className="admin-section">
      <h2 className="admin-section-title">{tabsLabel}</h2>
      <p className="admin-section-desc">
        Send an in-app notification to all users, users in a role, or specific user IDs.
      </p>

      <form onSubmit={(e) => void handleSubmit(e)} className="admin-notifications-form">
        <div className="admin-form-group">
          <label className="admin-form-label">Target</label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as Target)}
            className="admin-form-select"
          >
            <option value="all">All active users</option>
            <option value="role">By role</option>
            <option value="users">Specific user IDs</option>
          </select>
        </div>

        {target === 'role' && (
          <div className="admin-form-group">
            <label className="admin-form-label">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="admin-form-select"
            >
              <option value="customer">Customer</option>
              <option value="expert">Expert</option>
              <option value="craftsman">Craftsman</option>
              <option value="business">Business</option>
            </select>
          </div>
        )}

        {target === 'users' && (
          <div className="admin-form-group">
            <label className="admin-form-label">User IDs (one per line or comma-separated)</label>
            <textarea
              value={userIdsText}
              onChange={(e) => setUserIdsText(e.target.value)}
              className="admin-form-textarea"
              rows={4}
              placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
            />
          </div>
        )}

        <div className="admin-form-group">
          <label className="admin-form-label">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="admin-form-input"
            maxLength={200}
            placeholder="Notification title"
            required
          />
        </div>

        <div className="admin-form-group">
          <label className="admin-form-label">Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="admin-form-textarea"
            rows={3}
            maxLength={2000}
            placeholder="Notification message"
            required
          />
        </div>

        {error && <div className="admin-form-error" role="alert">{error}</div>}
        {success && <div className="admin-form-success" role="status">{success}</div>}

        <button type="submit" className="admin-btn admin-btn-primary" disabled={sending}>
          {sending ? 'Sending...' : sendLabel}
        </button>
      </form>
    </div>
  );
};
