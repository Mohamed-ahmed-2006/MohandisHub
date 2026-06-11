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

  const isArabic = /[\u0600-\u06FF]/.test(dictionary.admin.title);
  const tr = (en: string, ar: string) => (isArabic ? ar : en);
  const tabsLabel = dictionary.admin?.tabs?.notifications ?? tr('Notifications', 'الإشعارات');
  const sendLabel = dictionary.common?.submit ?? tr('Submit', 'إرسال');

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
          setError(
            tr(
              'Enter at least one user ID when targeting specific users.',
              'أدخل معرف مستخدم واحدًا على الأقل عند الاستهداف بمستخدمين محددين.',
            ),
          );
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
        setError(tr('Title and message are required.', 'العنوان والرسالة مطلوبان.'));
        return;
      }

      setSending(true);
      try {
        const result = await adminApiClient.sendNotification(accessToken, body, { refreshSession });
        setSuccess(
          isArabic
            ? `تم إرسال الإشعار إلى ${result.created} مستخدم.`
            : `Notification sent to ${result.created} user(s).`,
        );
        setTitle('');
        setMessage('');
        setUserIdsText('');
      } catch (err: unknown) {
        setError(
          isApiClientError(err)
            ? err.message
            : tr('Failed to send notification.', 'فشل إرسال الإشعار.'),
        );
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
        {tr(
          'Send an in-app notification to all users, users in a role, or specific user IDs.',
          'أرسل إشعارًا داخل التطبيق إلى جميع المستخدمين، أو حسب الدور، أو لمعرفات مستخدمين محددة.',
        )}
      </p>

      <form onSubmit={(e) => void handleSubmit(e)} className="admin-notifications-form">
        <div className="admin-form-group">
          <label className="admin-form-label">{tr('Target', 'الاستهداف')}</label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as Target)}
            className="admin-form-select"
          >
            <option value="all">{tr('All active users', 'كل المستخدمين النشطين')}</option>
            <option value="role">{tr('By role', 'حسب الدور')}</option>
            <option value="users">{tr('Specific user IDs', 'معرفات مستخدمين محددة')}</option>
          </select>
        </div>

        {target === 'role' && (
          <div className="admin-form-group">
            <label className="admin-form-label">{tr('Role', 'الدور')}</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="admin-form-select"
            >
              <option value="customer">{dictionary.auth.roles.customer}</option>
              <option value="expert">{dictionary.auth.roles.expert}</option>
              <option value="craftsman">{dictionary.auth.roles.craftsman}</option>
              <option value="business">{dictionary.auth.roles.business}</option>
            </select>
          </div>
        )}

        {target === 'users' && (
          <div className="admin-form-group">
            <label className="admin-form-label">
              {tr(
                'User IDs (one per line or comma-separated)',
                'معرفات المستخدم (واحد بكل سطر أو مفصولة بفاصلة)',
              )}
            </label>
            <textarea
              value={userIdsText}
              onChange={(e) => setUserIdsText(e.target.value)}
              className="admin-form-textarea"
              rows={4}
              placeholder={tr(
                'e.g. 550e8400-e29b-41d4-a716-446655440000',
                'مثال: 550e8400-e29b-41d4-a716-446655440000',
              )}
            />
          </div>
        )}

        <div className="admin-form-group">
          <label className="admin-form-label">{tr('Title', 'العنوان')}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="admin-form-input"
            maxLength={200}
            placeholder={tr('Notification title', 'عنوان الإشعار')}
            required
          />
        </div>

        <div className="admin-form-group">
          <label className="admin-form-label">{tr('Message', 'الرسالة')}</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="admin-form-textarea"
            rows={3}
            maxLength={2000}
            placeholder={tr('Notification message', 'نص الإشعار')}
            required
          />
        </div>

        {error && (
          <div className="admin-form-error" role="alert">
            {error}
          </div>
        )}
        {success && (
          <div className="admin-form-success" role="status">
            {success}
          </div>
        )}

        <button type="submit" className="admin-btn admin-btn-primary" disabled={sending}>
          {sending ? tr('Sending...', 'جارٍ الإرسال...') : sendLabel}
        </button>
      </form>
    </div>
  );
};
