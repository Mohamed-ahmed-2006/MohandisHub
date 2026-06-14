'use client';

import type { BackupRestoreStatus } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import { adminApiClient } from '@/lib/admin/client';
import type { Dictionary } from '@/lib/i18n/types';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  refreshSession: () => Promise<string | null>;
};

export const AdminOperationsTab = ({ dictionary, accessToken, refreshSession }: Props) => {
  const [status, setStatus] = useState<BackupRestoreStatus | null>(null);
  const [backupReference, setBackupReference] = useState('');
  const [restoreId, setRestoreId] = useState('');
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isArabic = /[\u0600-\u06FF]/.test(dictionary.admin.title);
  const tr = (en: string, ar: string) => (isArabic ? ar : en);

  const load = useCallback(async () => {
    setError(null);
    try {
      setStatus(await adminApiClient.getBackupStatus(accessToken, { refreshSession }));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tr('Failed to load backup status.', 'تعذر تحميل حالة النسخ الاحتياطي.'),
      );
    }
  }, [accessToken, refreshSession]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: 'check' | 'dryRun' | 'request' | 'approve') => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (action === 'check') {
        await adminApiClient.runBackupCheck(accessToken, { refreshSession });
        setMessage(tr('Backup provider check recorded.', 'تم تسجيل فحص النسخ الاحتياطي.'));
      } else if (action === 'dryRun') {
        await adminApiClient.dryRunRestore(
          accessToken,
          { backupReference, typedConfirmation: 'RESTORE' },
          { refreshSession },
        );
        setMessage(tr('Restore dry-run completed.', 'تمت تجربة الاستعادة.'));
      } else if (action === 'request') {
        const result = await adminApiClient.requestRestore(
          accessToken,
          { backupReference, typedConfirmation: 'RESTORE' },
          { refreshSession },
        );
        setRestoreId(result.id);
        setMessage(
          result.status === 'approved'
            ? tr('Restore submitted to provider.', 'تم إرسال الاستعادة للمزود.')
            : tr(
                'Restore request is waiting for another super admin.',
                'طلب الاستعادة ينتظر مسؤولًا عامًا آخر.',
              ),
        );
      } else {
        await adminApiClient.approveRestore(accessToken, restoreId, { refreshSession });
        setMessage(tr('Restore approved and submitted.', 'تمت الموافقة على الاستعادة وإرسالها.'));
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('Operation failed.', 'فشلت العملية.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-settings-tab">
      <h2 className="admin-settings-title">{tr('Operations', 'العمليات')}</h2>
      {error && <p className="admin-settings-error">{error}</p>}
      {message && <p className="admin-settings-success">{message}</p>}

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">
          {tr('Backup readiness', 'جاهزية النسخ الاحتياطي')}
        </h3>
        <div className="admin-stats-grid">
          <div className="admin-stat-card">
            <p className="admin-stat-label">{tr('Provider', 'المزود')}</p>
            <p className="admin-stat-value">{status?.provider ?? '-'}</p>
          </div>
          <div className="admin-stat-card">
            <p className="admin-stat-label">{tr('Configured', 'مهيأ')}</p>
            <p className="admin-stat-value">
              {status?.providerConfigured ? tr('Yes', 'نعم') : tr('No', 'لا')}
            </p>
          </div>
          <div className="admin-stat-card">
            <p className="admin-stat-label">{tr('Restore mode', 'وضع الاستعادة')}</p>
            <p className="admin-stat-value">{status?.restoreMode ?? '-'}</p>
          </div>
          <div className="admin-stat-card">
            <p className="admin-stat-label">{tr('Pending restores', 'استعادات معلقة')}</p>
            <p className="admin-stat-value">{status?.pendingRestoreCount ?? 0}</p>
          </div>
        </div>
        <p className="admin-settings-desc">
          {tr('Latest backup', 'آخر نسخة')}: {status?.latestBackupReference ?? '-'}{' '}
          {status?.latestBackupAt ? `(${status.latestBackupAt})` : ''}
        </p>
        <p className="admin-settings-desc">
          {tr('Provider status', 'حالة المزود')}: {status?.providerStatus ?? '-'}
        </p>
        <button
          className="admin-btn"
          type="button"
          onClick={() => void run('check')}
          disabled={busy}
        >
          {tr('Run provider check', 'فحص المزود')}
        </button>
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">
          {tr('Restore controls', 'أدوات الاستعادة')}
        </h3>
        <p className="admin-error-banner">
          {tr(
            'Restore is destructive and may cause downtime. Type RESTORE before dry-run or request.',
            'الاستعادة عملية حساسة وقد تسبب توقفًا. اكتب RESTORE قبل التجربة أو الطلب.',
          )}
        </p>
        <div className="admin-toolbar">
          <input
            className="admin-toolbar-input"
            value={backupReference}
            onChange={(e) => setBackupReference(e.target.value)}
            placeholder={tr('Backup reference / Unix PITR timestamp', 'مرجع النسخة / توقيت Unix')}
          />
          <input
            className="admin-toolbar-input"
            value={typedConfirmation}
            onChange={(e) => setTypedConfirmation(e.target.value)}
            placeholder="RESTORE"
          />
          <button
            className="admin-btn"
            type="button"
            onClick={() => void run('dryRun')}
            disabled={busy || typedConfirmation !== 'RESTORE' || !backupReference}
          >
            {tr('Dry-run', 'تجربة')}
          </button>
          <button
            className="admin-btn admin-btn--danger"
            type="button"
            onClick={() => void run('request')}
            disabled={busy || typedConfirmation !== 'RESTORE' || !backupReference}
          >
            {tr('Request restore', 'طلب الاستعادة')}
          </button>
        </div>
        <div className="admin-toolbar">
          <input
            className="admin-toolbar-input"
            value={restoreId}
            onChange={(e) => setRestoreId(e.target.value)}
            placeholder={tr('Pending restore id', 'معرف طلب الاستعادة المعلق')}
          />
          <button
            className="admin-btn admin-btn--danger"
            type="button"
            onClick={() => void run('approve')}
            disabled={busy || !restoreId}
          >
            {tr('Approve pending restore', 'اعتماد الاستعادة المعلقة')}
          </button>
        </div>
      </section>
    </section>
  );
};
