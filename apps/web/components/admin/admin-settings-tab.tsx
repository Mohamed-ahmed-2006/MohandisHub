'use client';

import type { AppSettings, UpdateAppSettingsBody } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import { adminApiClient } from '@/lib/admin/client';
import { isApiClientError } from '@/lib/auth/client';
import type { Dictionary } from '@/lib/i18n/types';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  refreshSession: () => Promise<string | null>;
};

const getErrorMessage = (error: unknown, dictionary: Dictionary): string => {
  if (isApiClientError(error)) return error.message;
  return dictionary.admin.settingsMgmt.saveError;
};

function Toggle({
  label,
  desc,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="admin-settings-row">
      <div className="admin-settings-label-wrap">
        <label className="admin-settings-label">{label}</label>
        <span className="admin-settings-desc">{desc}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`admin-settings-toggle ${checked ? 'admin-settings-toggle--on' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
      >
        <span className="admin-settings-toggle-thumb" />
      </button>
    </div>
  );
}

export const AdminSettingsTab = ({ dictionary, accessToken, refreshSession }: Props) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const d = dictionary.admin.settingsMgmt;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApiClient.getSettings(accessToken, { refreshSession });
      setSettings(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, dictionary));
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, dictionary, refreshSession]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback(
    async (partial: UpdateAppSettingsBody) => {
      if (!settings) return;
      setSaving(true);
      setError(null);
      setSuccess(false);
      try {
        const updated = await adminApiClient.updateSettings(accessToken, partial, {
          refreshSession,
        });
        setSettings(updated);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 2000);
      } catch (err: unknown) {
        setError(getErrorMessage(err, dictionary));
      } finally {
        setSaving(false);
      }
    },
    [accessToken, dictionary, refreshSession, settings],
  );

  const handleToggle = useCallback(
    (key: keyof UpdateAppSettingsBody, value: boolean) => {
      void update({ [key]: value });
    },
    [update],
  );

  const handleTextChange = useCallback(
    (key: keyof UpdateAppSettingsBody, value: string | null) => {
      void update({ [key]: value || null });
    },
    [update],
  );

  const handleNumberChange = useCallback(
    (key: keyof UpdateAppSettingsBody, value: number | null) => {
      void update({ [key]: value });
    },
    [update],
  );

  if (loading || !settings) {
    return <p className="admin-empty">{dictionary.admin.loading}</p>;
  }

  return (
    <div className="admin-settings-tab">
      <h2 className="admin-settings-title">{d.title}</h2>

      {error && <p className="admin-settings-error">{error}</p>}
      {success && <p className="admin-settings-success">{d.saveSuccess}</p>}

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.availability}</h3>
        <Toggle
          label={d.maintenanceMode}
          desc={d.maintenanceModeDesc}
          checked={settings.maintenanceMode}
          onChange={(v) => handleToggle('maintenanceMode', v)}
          disabled={saving}
        />
        <div className="admin-settings-row">
          <label className="admin-settings-label">{d.maintenanceMessage}</label>
          <input
            type="text"
            className="admin-settings-input"
            placeholder={d.maintenanceMessagePlaceholder}
            defaultValue={settings.maintenanceMessage ?? ''}
            onBlur={(e) => handleTextChange('maintenanceMessage', e.target.value || null)}
          />
        </div>
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.signups}</h3>
        <Toggle
          label={d.signupsLocked}
          desc={d.signupsLockedDesc}
          checked={settings.signupsLocked}
          onChange={(v) => handleToggle('signupsLocked', v)}
          disabled={saving}
        />
        <Toggle
          label={d.lockLogins}
          desc={d.lockLoginsDesc}
          checked={settings.lockLogins}
          onChange={(v) => handleToggle('lockLogins', v)}
          disabled={saving}
        />
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.wallet}</h3>
        <Toggle
          label={d.depositsPaused}
          desc={d.depositsPausedDesc}
          checked={settings.depositsPaused}
          onChange={(v) => handleToggle('depositsPaused', v)}
          disabled={saving}
        />
        <Toggle
          label={d.moneyMovementsPaused}
          desc={d.moneyMovementsPausedDesc}
          checked={settings.moneyMovementsPaused}
          onChange={(v) => handleToggle('moneyMovementsPaused', v)}
          disabled={saving}
        />
        <Toggle
          label={d.disableCryptoDeposits}
          desc={d.disableCryptoDepositsDesc}
          checked={settings.disableCryptoDeposits}
          onChange={(v) => handleToggle('disableCryptoDeposits', v)}
          disabled={saving}
        />
        <Toggle
          label={d.disableCardDeposits}
          desc={d.disableCardDepositsDesc}
          checked={settings.disableCardDeposits}
          onChange={(v) => handleToggle('disableCardDeposits', v)}
          disabled={saving}
        />
        <div className="admin-settings-row">
          <label className="admin-settings-label">{d.minDepositAmount}</label>
          <input
            type="number"
            min={0}
            step={0.01}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.minDepositAmount ?? ''}
            onBlur={(e) =>
              handleNumberChange(
                'minDepositAmount',
                e.target.value === '' ? null : parseFloat(e.target.value) || 0,
              )
            }
          />
        </div>
        <div className="admin-settings-row">
          <label className="admin-settings-label">{d.maxDepositAmount}</label>
          <input
            type="number"
            min={0}
            step={0.01}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.maxDepositAmount ?? ''}
            onBlur={(e) =>
              handleNumberChange(
                'maxDepositAmount',
                e.target.value === '' ? null : parseFloat(e.target.value) || 0,
              )
            }
          />
        </div>
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.commission}</h3>
        <div className="admin-settings-row">
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">{d.commissionPercent}</label>
            <span className="admin-settings-desc">{d.commissionPercentDesc}</span>
          </div>
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.commissionPercent}
            onBlur={(e) =>
              handleNumberChange(
                'commissionPercent',
                e.target.value === '' ? 0 : parseFloat(e.target.value) ?? 0,
              )
            }
          />
        </div>
        <div className="admin-settings-row">
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">{d.commissionMinEgp}</label>
            <span className="admin-settings-desc">{d.commissionMinEgpDesc}</span>
          </div>
          <input
            type="number"
            min={0}
            step={0.01}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.commissionMinEgp}
            onBlur={(e) =>
              handleNumberChange(
                'commissionMinEgp',
                e.target.value === '' ? 0 : parseFloat(e.target.value) ?? 0,
              )
            }
          />
        </div>
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.plans}</h3>
        <Toggle
          label={d.pausePlanSubscriptions}
          desc={d.pausePlanSubscriptionsDesc}
          checked={settings.pausePlanSubscriptions}
          onChange={(v) => handleToggle('pausePlanSubscriptions', v)}
          disabled={saving}
        />
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.needs}</h3>
        <Toggle
          label={d.pauseNeeds}
          desc=""
          checked={settings.pauseNeeds}
          onChange={(v) => handleToggle('pauseNeeds', v)}
          disabled={saving}
        />
        <Toggle
          label={d.pauseBids}
          desc=""
          checked={settings.pauseBids}
          onChange={(v) => handleToggle('pauseBids', v)}
          disabled={saving}
        />
        <Toggle
          label={d.pauseAwardBids}
          desc=""
          checked={settings.pauseAwardBids}
          onChange={(v) => handleToggle('pauseAwardBids', v)}
          disabled={saving}
        />
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.content}</h3>
        <Toggle
          label={d.pauseUploads}
          desc=""
          checked={settings.pauseUploads}
          onChange={(v) => handleToggle('pauseUploads', v)}
          disabled={saving}
        />
        <Toggle
          label={d.pauseVerificationSubmissions}
          desc=""
          checked={settings.pauseVerificationSubmissions}
          onChange={(v) => handleToggle('pauseVerificationSubmissions', v)}
          disabled={saving}
        />
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.communication}</h3>
        <Toggle
          label={d.pauseChat}
          desc=""
          checked={settings.pauseChat}
          onChange={(v) => handleToggle('pauseChat', v)}
          disabled={saving}
        />
        <Toggle
          label={d.pauseOtpEmails}
          desc=""
          checked={settings.pauseOtpEmails}
          onChange={(v) => handleToggle('pauseOtpEmails', v)}
          disabled={saving}
        />
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.features}</h3>
        <Toggle
          label={d.featureNeedsEnabled}
          desc=""
          checked={settings.featureNeedsEnabled}
          onChange={(v) => handleToggle('featureNeedsEnabled', v)}
          disabled={saving}
        />
        <Toggle
          label={d.featurePlansEnabled}
          desc=""
          checked={settings.featurePlansEnabled}
          onChange={(v) => handleToggle('featurePlansEnabled', v)}
          disabled={saving}
        />
        <Toggle
          label={d.featureWalletEnabled}
          desc=""
          checked={settings.featureWalletEnabled}
          onChange={(v) => handleToggle('featureWalletEnabled', v)}
          disabled={saving}
        />
        <div className="admin-settings-row">
          <label className="admin-settings-label">{d.globalAnnouncement}</label>
          <input
            type="text"
            className="admin-settings-input"
            placeholder={d.globalAnnouncementPlaceholder}
            defaultValue={settings.globalAnnouncement ?? ''}
            onBlur={(e) => handleTextChange('globalAnnouncement', e.target.value || null)}
          />
        </div>
      </section>
    </div>
  );
};
