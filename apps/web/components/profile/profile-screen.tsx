'use client';

import type {
  AcademicRecord,
  AcademicRecordBody,
  AuthUser,
  BusinessProfile,
  CraftsmanProfile,
  ExpertProfile,
  IdentityDocumentType,
  IdentityDocument,
  Review,
  UpdateBusinessProfileBody,
  UpdateCraftsmanProfileBody,
  UpdateExpertProfileBody,
  NotificationPreferenceGroup,
} from '@mohandishub/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { getVisibleProfileSections, type ProfileSectionId } from './profile-screen-sections';

import { useAppStatus } from '@/components/app-status-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { LanguageToggle } from '@/components/language-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { CityCountrySelect } from '@/components/ui/city-country-select';
import { Container } from '@/components/ui/container';
import { ImageUploadOrCapture } from '@/components/ui/image-upload-or-capture';
import { IndustrySelect } from '@/components/ui/industry-select';
import { LanguagesCheckboxes } from '@/components/ui/languages-checkboxes';
import { SkeletonForm } from '@/components/ui/skeleton';
import { resolvePublicAssetUrl, toAbsoluteAssetUrl } from '@/lib/asset-url';
import { COUNTRIES } from '@/lib/data/countries';
import { getApiBaseUrl } from '@/lib/env';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { notificationsApiClient } from '@/lib/notifications/client';
import { profilesApiClient } from '@/lib/profiles/client';
import { recommendationsApiClient } from '@/lib/recommendations/client';
import { reviewsApiClient } from '@/lib/reviews/client';
import { uploadFile, uploadPrivateFile } from '@/lib/upload/client';
import { usersApiClient } from '@/lib/users/client';
import { formatApiError } from '@/lib/utils/format-api-error';

import './profile-screen.css';

function nonEmpty(val: string | null | undefined): string | undefined {
  return val && val.trim().length > 0 ? val.trim() : undefined;
}

function pickDefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function profileImageDisplaySrc(url: string): string {
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  return resolvePublicAssetUrl(url) ?? url;
}

function readFilePreview(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Could not preview image.'));
    reader.readAsDataURL(file);
  });
}

type ProfileScreenProps = {
  locale: Locale;
  dictionary: Dictionary;
};

const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '500+'] as const;
type RoleProfileKind = 'expert' | 'craftsman' | 'business';

type AccountPreferencesProps = {
  locale: Locale;
  dictionary: Dictionary;
  accessToken: string;
};

const AccountPreferences = ({ locale, dictionary, accessToken }: AccountPreferencesProps) => {
  const [groups, setGroups] = useState<NotificationPreferenceGroup[]>([]);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [preferencesMessage, setPreferencesMessage] = useState<string | null>(null);
  const [pushReady, setPushReady] = useState<{ enabled: boolean; publicKey: string | null } | null>(
    null,
  );
  const [personalized, setPersonalized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setPreferencesLoading(true);
      try {
        const [prefs, push, consent] = await Promise.all([
          notificationsApiClient.getPreferences(accessToken),
          notificationsApiClient.getPushReadiness(accessToken),
          recommendationsApiClient.getConsent(accessToken),
        ]);
        if (cancelled) return;
        setGroups(prefs.groups);
        setPushReady(push);
        setPersonalized(consent.personalizedRecommendationsEnabled);
      } catch {
        if (!cancelled) setPreferencesMessage('Could not load notification preferences.');
      } finally {
        if (!cancelled) setPreferencesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const savePreference = async (groupIndex: number, preferenceIndex: number, enabled: boolean) => {
    const pref = groups[groupIndex]?.preferences[preferenceIndex];
    if (!pref || pref.required) return;
    const nextGroups = groups.map((group, gi) =>
      gi !== groupIndex
        ? group
        : {
            ...group,
            preferences: group.preferences.map((p, pi) =>
              pi === preferenceIndex ? { ...p, enabled } : p,
            ),
          },
    );
    setGroups(nextGroups);
    setPreferencesSaving(true);
    setPreferencesMessage(null);
    try {
      const flattened = nextGroups.flatMap((group) =>
        group.preferences.map((p) => ({
          notificationType: p.notificationType,
          channel: p.channel,
          enabled: p.enabled,
        })),
      );
      const saved = await notificationsApiClient.updatePreferences(accessToken, {
        preferences: flattened,
      });
      setGroups(saved.groups);
      setPreferencesMessage('Preferences saved.');
    } catch {
      setPreferencesMessage('Could not save notification preferences.');
    } finally {
      setPreferencesSaving(false);
    }
  };

  const togglePersonalized = async (enabled: boolean) => {
    setPersonalized(enabled);
    try {
      const saved = await recommendationsApiClient.setConsent(accessToken, enabled);
      setPersonalized(saved.personalizedRecommendationsEnabled);
    } catch {
      setPreferencesMessage('Could not update recommendation consent.');
    }
  };

  const enablePush = async () => {
    setPreferencesMessage(null);
    try {
      const readiness = pushReady ?? (await notificationsApiClient.getPushReadiness(accessToken));
      setPushReady(readiness);
      if (!readiness.enabled || !readiness.publicKey) {
        setPreferencesMessage('Push is not configured on the server yet.');
        return;
      }
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setPreferencesMessage('This browser does not support push notifications.');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPreferencesMessage('Push permission was not granted.');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      const key = Uint8Array.from(
        atob(readiness.publicKey.replace(/-/g, '+').replace(/_/g, '/')),
        (char) => char.charCodeAt(0),
      );
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
        setPreferencesMessage('Browser did not return a complete push subscription.');
        return;
      }
      await notificationsApiClient.savePushSubscription(accessToken, {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        userAgent: navigator.userAgent,
      });
      setPreferencesMessage('Push notifications enabled on this device.');
    } catch {
      setPreferencesMessage('Could not enable push notifications.');
    }
  };

  const categoryLabel = (category: string) =>
    ({
      security: locale === 'ar' ? 'الأمان والحساب' : 'Security and account',
      reservations: locale === 'ar' ? 'الحجوزات' : 'Reservations',
      disputes: locale === 'ar' ? 'النزاعات' : 'Disputes',
      wallet: locale === 'ar' ? 'المحفظة والمدفوعات' : 'Wallet and payments',
      withdrawals: locale === 'ar' ? 'السحب' : 'Withdrawals',
      messages: locale === 'ar' ? 'الرسائل' : 'Messages',
      jobs: locale === 'ar' ? 'الوظائف' : 'Jobs',
      services: locale === 'ar' ? 'الخدمات' : 'Services',
      reviews: locale === 'ar' ? 'التقييمات' : 'Reviews',
      admin: locale === 'ar' ? 'النظام والإدارة' : 'System and admin',
      marketing: locale === 'ar' ? 'العروض والنمو' : 'Marketing',
    })[category] ?? category;

  const channelLabel = (channel: string) =>
    ({
      in_app: locale === 'ar' ? 'داخل التطبيق' : 'In-app',
      email: locale === 'ar' ? 'البريد' : 'Email',
      push: locale === 'ar' ? 'تنبيهات الجهاز' : 'Push',
    })[channel] ?? channel;

  return (
    <div className="profile-screen-subsection">
      <div className="profile-screen-subsection-header">
        <h3 className="profile-screen-subsection-title">
          {dictionary.profile.preferencesTab ?? 'Preferences'}
        </h3>
      </div>
      <div className="profile-screen-pref-grid">
        <div className="profile-screen-pref-card">
          <span className="profile-screen-label">{dictionary.language.switchLabel}</span>
          <LanguageToggle
            locale={locale}
            targetLabel={dictionary.language.target}
            ariaLabel={dictionary.language.switchLabel}
          />
        </div>
        <div className="profile-screen-pref-card">
          <span className="profile-screen-label">
            {dictionary.theme.darkLabel} / {dictionary.theme.lightLabel}
          </span>
          <ThemeToggle
            switchToLightLabel={dictionary.theme.switchToLight}
            switchToDarkLabel={dictionary.theme.switchToDark}
            darkLabel={dictionary.theme.darkLabel}
            lightLabel={dictionary.theme.lightLabel}
          />
        </div>
      </div>
      <div className="profile-screen-pref-panel">
        <div className="profile-screen-subsection-header">
          <h4 className="profile-screen-subsection-title">
            {locale === 'ar' ? 'تفضيلات التنبيهات' : 'Notification preferences'}
          </h4>
          {preferencesSaving && (
            <span className="profile-screen-label">
              {locale === 'ar' ? 'جار الحفظ...' : 'Saving...'}
            </span>
          )}
        </div>
        <p className="profile-screen-muted">
          {locale === 'ar'
            ? 'تنبيهات الأمان والأموال والحجوزات المهمة لا يمكن إيقافها بالكامل.'
            : 'Security, money, dispute, and critical reservation notices cannot be fully disabled.'}
        </p>
        {pushReady && !pushReady.enabled && (
          <p className="profile-screen-muted">
            {locale === 'ar'
              ? 'تنبيهات الجهاز جاهزة في الواجهة، لكنها تحتاج مفاتيح VAPID في env.'
              : 'Push controls are ready, but VAPID env keys are required before delivery works.'}
          </p>
        )}
        <button
          type="button"
          className="profile-screen-button profile-screen-button--secondary"
          onClick={() => void enablePush()}
        >
          {locale === 'ar' ? 'تفعيل تنبيهات الجهاز' : 'Enable push on this device'}
        </button>
        {preferencesMessage && <p className="profile-screen-muted">{preferencesMessage}</p>}
        {preferencesLoading ? (
          <p className="profile-screen-muted">{dictionary.admin?.loading ?? 'Loading...'}</p>
        ) : (
          <div className="profile-screen-notification-grid">
            {groups.map((group, groupIndex) => (
              <section key={group.category} className="profile-screen-pref-card">
                <h5 className="profile-screen-label">{categoryLabel(group.category)}</h5>
                {group.preferences.map((pref, preferenceIndex) => (
                  <label
                    key={`${pref.notificationType}-${pref.channel}`}
                    className="profile-screen-toggle-row"
                  >
                    <span>
                      {pref.notificationType.replaceAll('_', ' ')} / {channelLabel(pref.channel)}
                      {pref.required ? (locale === 'ar' ? ' - مطلوب' : ' - required') : ''}
                    </span>
                    <input
                      type="checkbox"
                      checked={pref.enabled}
                      disabled={pref.required || preferencesSaving}
                      onChange={(event) =>
                        void savePreference(groupIndex, preferenceIndex, event.target.checked)
                      }
                    />
                  </label>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
      <div className="profile-screen-pref-panel">
        <label className="profile-screen-toggle-row">
          <span>
            {locale === 'ar'
              ? 'استخدام نشاطي لتحسين الاقتراحات'
              : 'Use my activity for personalized recommendations'}
          </span>
          <input
            type="checkbox"
            checked={personalized}
            onChange={(event) => void togglePersonalized(event.target.checked)}
          />
        </label>
      </div>
    </div>
  );
};

function getSectionLabel(
  sectionId: ProfileSectionId,
  dictionary: Dictionary,
  roleProfileKind: RoleProfileKind | null,
): string {
  if (sectionId === 'account') return dictionary.profile.accountTab;
  if (sectionId === 'profile') {
    if (roleProfileKind === 'business') return dictionary.profile.businessTab;
    if (roleProfileKind === 'craftsman') return dictionary.profile.craftsmanTab;
    return dictionary.profile.expertTab;
  }

  return dictionary.profile.verificationSection ?? 'Verification';
}

// ── Account Form (all roles) ─────────────────────────────────────────────

type AccountFormProps = {
  authUser: AuthUser;
  accessToken: string;
  locale: Locale;
  dictionary: Dictionary;
  onUserUpdated: () => Promise<void>;
};

const AccountForm = ({
  authUser,
  accessToken,
  locale,
  dictionary,
  onUserUpdated,
}: AccountFormProps) => {
  const countryNameKey = locale === 'ar' ? 'nameAr' : 'nameEn';
  const labels = dictionary.profile.account;
  const allowsAvatarUpload = authUser.role === 'expert' || authUser.role === 'craftsman';
  const avatarHint =
    authUser.role === 'craftsman'
      ? 'Required for craftsman verification and the platform verified badge.'
      : 'Required for expert verification and the platform verified badge.';
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Email change state
  const [emailChangeStep, setEmailChangeStep] = useState<'idle' | 'input' | 'verify'>('idle');
  const [newEmail, setNewEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailChangeBusy, setEmailChangeBusy] = useState(false);
  const [emailChangeMsg, setEmailChangeMsg] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(authUser.avatarUrl);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [avatarPreviewFailed, setAvatarPreviewFailed] = useState(false);

  useEffect(() => {
    setAvatarPreviewUrl(authUser.avatarUrl);
    setAvatarFile(null);
    setAvatarRemoved(false);
    setAvatarPreviewFailed(false);
  }, [authUser.avatarUrl]);

  const handleAvatarSelected = useCallback(async (file: File) => {
    setAvatarFile(file);
    setAvatarRemoved(false);
    setAvatarPreviewFailed(false);
    setAvatarPreviewUrl(await readFilePreview(file));
  }, []);

  const handleSaveAccount = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const val = (name: string) =>
      nonEmpty((form.elements.namedItem(name) as HTMLInputElement)?.value);

    setSaving(true);
    setSaveMessage(null);
    try {
      let avatarUrl: string | null | undefined;
      if (allowsAvatarUpload) {
        if (avatarRemoved) {
          avatarUrl = null;
        } else if (avatarFile) {
          const uploaded = await uploadFile(accessToken, avatarFile);
          avatarUrl = toAbsoluteAssetUrl(uploaded.url);
        }
      }

      const body = pickDefined({
        displayName: val('displayName'),
        phone: (form.elements.namedItem('phone') as HTMLInputElement)?.value?.trim() || null,
        phoneCode: (form.elements.namedItem('phoneCode') as HTMLSelectElement)?.value || null,
        nationality: (form.elements.namedItem('nationality') as HTMLSelectElement)?.value || null,
        avatarUrl,
        dateOfBirth: (form.elements.namedItem('dateOfBirth') as HTMLInputElement)?.value || null,
      });

      await usersApiClient.updateAccount(
        accessToken,
        body as Parameters<typeof usersApiClient.updateAccount>[1],
      );
      await onUserUpdated();
      setSaveMessage({ type: 'success', text: dictionary.profile.saveSuccess });
    } catch (err) {
      setSaveMessage({ type: 'error', text: formatApiError(err, dictionary.profile.saveError) });
    } finally {
      setSaving(false);
    }
  };

  const handleRequestEmailChange = async () => {
    if (!newEmail.trim()) return;
    setEmailChangeBusy(true);
    setEmailChangeMsg(null);
    try {
      await usersApiClient.requestEmailChange(accessToken, newEmail.trim());
      setEmailChangeStep('verify');
      setEmailChangeMsg({ type: 'info', text: labels.emailChangePending });
    } catch (err) {
      const msg = err instanceof Error ? err.message : labels.emailChangeError;
      setEmailChangeMsg({ type: 'error', text: msg });
    } finally {
      setEmailChangeBusy(false);
    }
  };

  const handleConfirmEmailChange = async () => {
    if (!emailCode.trim()) return;
    setEmailChangeBusy(true);
    setEmailChangeMsg(null);
    try {
      await usersApiClient.confirmEmailChange(accessToken, emailCode.trim());
      await onUserUpdated();
      setEmailChangeStep('idle');
      setNewEmail('');
      setEmailCode('');
      setEmailChangeMsg(null);
      setSaveMessage({ type: 'success', text: labels.emailChangeSuccess });
    } catch (err) {
      const msg = err instanceof Error ? err.message : labels.emailChangeError;
      setEmailChangeMsg({ type: 'error', text: msg });
    } finally {
      setEmailChangeBusy(false);
    }
  };

  const cancelEmailChange = () => {
    setEmailChangeStep('idle');
    setNewEmail('');
    setEmailCode('');
    setEmailChangeMsg(null);
  };

  return (
    <section id="account-settings" className="profile-screen-card profile-screen-section-card">
      <h2 className="profile-screen-sectionTitle">{labels.sectionTitle}</h2>
      <form onSubmit={(e) => void handleSaveAccount(e)} className="profile-screen-form">
        <div className="profile-screen-field">
          <label className="profile-screen-label">{labels.displayNameLabel}</label>
          <input
            name="displayName"
            className="profile-screen-input"
            defaultValue={authUser.displayName}
          />
        </div>

        {/* Email — read-only with change flow */}
        <div className="profile-screen-email-row">
          <div className="profile-screen-field">
            <label className="profile-screen-label">{labels.emailLabel}</label>
            <input className="profile-screen-input" value={authUser.email} readOnly disabled />
          </div>
          {emailChangeStep === 'idle' && (
            <button
              type="button"
              className="profile-screen-email-change-btn"
              onClick={() => setEmailChangeStep('input')}
            >
              {labels.emailChangeButton}
            </button>
          )}
        </div>

        {emailChangeStep === 'input' && (
          <div className="profile-screen-email-change-box">
            <p className="profile-screen-email-change-title">{labels.emailChangeTitle}</p>
            <p className="profile-screen-email-change-desc">{labels.emailChangeDescription}</p>
            <div className="profile-screen-field">
              <label className="profile-screen-label">{labels.newEmailLabel}</label>
              <input
                type="email"
                className="profile-screen-input"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder={labels.newEmailPlaceholder}
              />
            </div>
            {emailChangeMsg && (
              <p
                className={
                  emailChangeMsg.type === 'error'
                    ? 'profile-screen-save-error'
                    : 'profile-screen-save-success'
                }
              >
                {emailChangeMsg.text}
              </p>
            )}
            <div className="profile-screen-email-change-actions">
              <button
                type="button"
                className="profile-screen-submit-button"
                disabled={emailChangeBusy || !newEmail.trim()}
                onClick={() => void handleRequestEmailChange()}
              >
                {labels.sendCodeButton}
              </button>
              <button
                type="button"
                className="profile-screen-cancel-btn"
                onClick={cancelEmailChange}
              >
                {labels.cancelButton}
              </button>
            </div>
          </div>
        )}

        {emailChangeStep === 'verify' && (
          <div className="profile-screen-email-change-box">
            <p className="profile-screen-email-change-pending">{labels.emailChangePending}</p>
            <div className="profile-screen-field">
              <label className="profile-screen-label">{labels.codeLabel}</label>
              <input
                className="profile-screen-input"
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value)}
                placeholder={labels.codePlaceholder}
                maxLength={6}
              />
            </div>
            {emailChangeMsg && emailChangeMsg.type === 'error' && (
              <p className="profile-screen-save-error">{emailChangeMsg.text}</p>
            )}
            <div className="profile-screen-email-change-actions">
              <button
                type="button"
                className="profile-screen-submit-button"
                disabled={emailChangeBusy || emailCode.trim().length !== 6}
                onClick={() => void handleConfirmEmailChange()}
              >
                {labels.confirmCodeButton}
              </button>
              <button
                type="button"
                className="profile-screen-cancel-btn"
                onClick={cancelEmailChange}
              >
                {labels.cancelButton}
              </button>
            </div>
          </div>
        )}

        <div className="profile-screen-row">
          <div className="profile-screen-field">
            <label className="profile-screen-label">{labels.phoneCodeLabel}</label>
            <select
              name="phoneCode"
              className="profile-screen-select"
              defaultValue={authUser.phoneCode ?? ''}
            >
              <option value="">—</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.dialCode}>
                  {c.dialCode} {c[countryNameKey]}
                </option>
              ))}
            </select>
          </div>
          <div className="profile-screen-field">
            <label className="profile-screen-label">{labels.phoneLabel}</label>
            <input
              name="phone"
              className="profile-screen-input"
              defaultValue={authUser.phone ?? ''}
              maxLength={15}
            />
          </div>
        </div>

        <div className="profile-screen-row">
          <div className="profile-screen-field">
            <label className="profile-screen-label">{labels.nationalityLabel}</label>
            <select
              name="nationality"
              className="profile-screen-select"
              defaultValue={authUser.nationality ?? ''}
            >
              <option value="">—</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c[countryNameKey]}
                </option>
              ))}
            </select>
          </div>
          <div className="profile-screen-field">
            <label className="profile-screen-label">{labels.dateOfBirthLabel}</label>
            <input
              name="dateOfBirth"
              type="date"
              className="profile-screen-input"
              defaultValue={authUser.dateOfBirth ?? ''}
            />
          </div>
        </div>

        {allowsAvatarUpload && (
          <div className="profile-screen-field">
            <label className="profile-screen-label">
              {(labels as { avatarLabel?: string }).avatarLabel ?? 'Profile picture'}
            </label>
            <p className="profile-screen-hint">
              {(labels as { avatarHint?: string }).avatarHint ?? avatarHint}
            </p>
            {avatarPreviewUrl && !avatarRemoved && (
              <div className="profile-screen-image-preview">
                {avatarPreviewFailed ? (
                  <div className="profile-screen-image-preview-img profile-screen-image-preview-fallback">
                    {authUser.displayName.charAt(0).toUpperCase()}
                  </div>
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={profileImageDisplaySrc(avatarPreviewUrl)}
                      alt={(labels as { avatarLabel?: string }).avatarLabel ?? 'Profile picture'}
                      className="profile-screen-image-preview-img"
                      onError={() => setAvatarPreviewFailed(true)}
                    />
                  </>
                )}
              </div>
            )}
            <ImageUploadOrCapture
              label={
                (labels as { avatarUploadLabel?: string }).avatarUploadLabel ??
                'Upload profile picture'
              }
              onImage={(file) => void handleAvatarSelected(file)}
              onClear={() => {
                setAvatarFile(null);
                setAvatarPreviewUrl(authUser.avatarUrl);
                setAvatarPreviewFailed(false);
              }}
              onError={(message) => setSaveMessage({ type: 'error', text: message })}
              disabled={saving}
            />
            {(avatarPreviewUrl || authUser.avatarUrl) && !avatarRemoved && (
              <button
                type="button"
                className="profile-screen-cancel-btn profile-screen-inline-action"
                onClick={() => {
                  setAvatarFile(null);
                  setAvatarPreviewUrl(null);
                  setAvatarRemoved(true);
                }}
              >
                {(labels as { avatarRemoveButton?: string }).avatarRemoveButton ?? 'Remove picture'}
              </button>
            )}
          </div>
        )}

        {saveMessage && (
          <p
            className={
              saveMessage.type === 'success'
                ? 'profile-screen-save-success'
                : 'profile-screen-save-error'
            }
          >
            {saveMessage.text}
          </p>
        )}
        <button type="submit" className="profile-screen-submit-button" disabled={saving}>
          {saving ? dictionary.common.continue : dictionary.common.save}
        </button>
      </form>
      <AccountPreferences locale={locale} dictionary={dictionary} accessToken={accessToken} />
    </section>
  );
};

// ── Main Profile Screen ──────────────────────────────────────────────────

export const ProfileScreen = ({ locale, dictionary }: ProfileScreenProps) => {
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard, updateAuthUser } = useAuth();
  const { status } = useAppStatus();
  const hourlyPricingEnabled = status?.featureHourlyPricingEnabled === true;
  const [expertProfile, setExpertProfile] = useState<ExpertProfile | null>(null);
  const [craftsmanProfile, setCraftsmanProfile] = useState<CraftsmanProfile | null>(null);
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsPage, _setReviewsPage] = useState(1);
  const [_reviewsTotal, setReviewsTotal] = useState(0);
  const [reportModalReviewId, setReportModalReviewId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<'inappropriate' | 'fake' | 'spam' | 'other'>(
    'inappropriate',
  );
  const [reportComment, setReportComment] = useState('');
  const [disputeModalReviewId, setDisputeModalReviewId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [identityDocuments, setIdentityDocuments] = useState<IdentityDocument[]>([]);
  const [academicRecords, setAcademicRecords] = useState<AcademicRecord[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [withdrawingDocId, setWithdrawingDocId] = useState<string | null>(null);
  const [editAcademicRecord, setEditAcademicRecord] = useState<AcademicRecord | null>(null);
  const [addIdentityOpen, setAddIdentityOpen] = useState(false);
  const [addAcademicOpen, setAddAcademicOpen] = useState(false);
  const [identitySubmitting, setIdentitySubmitting] = useState(false);
  const [academicSubmitting, setAcademicSubmitting] = useState(false);
  const [identitySubmitError, setIdentitySubmitError] = useState<string | null>(null);
  const [academicSubmitError, setAcademicSubmitError] = useState<string | null>(null);
  const [identityDocType, setIdentityDocType] = useState<IdentityDocumentType>('national_id');
  const [identityFullNameOnDoc, setIdentityFullNameOnDoc] = useState('');
  const [identityFrontFile, setIdentityFrontFile] = useState<File | null>(null);
  const [identityBackFile, setIdentityBackFile] = useState<File | null>(null);
  const [identitySelfieFile, setIdentitySelfieFile] = useState<File | null>(null);
  const [academicRecordType, setAcademicRecordType] = useState<
    'degree' | 'diploma' | 'certificate' | 'license'
  >('degree');
  const [academicTitle, setAcademicTitle] = useState('');
  const [academicInstitution, setAcademicInstitution] = useState('');
  const [academicFieldOfStudy, setAcademicFieldOfStudy] = useState('');
  const [academicGraduationYear, setAcademicGraduationYear] = useState('');
  const [academicGrade, setAcademicGrade] = useState('');
  const [academicCertificateFile, setAcademicCertificateFile] = useState<File | null>(null);
  const [academicTranscriptFile, setAcademicTranscriptFile] = useState<File | null>(null);
  const [academicEditSaving, setAcademicEditSaving] = useState(false);
  const [academicEditError, setAcademicEditError] = useState<string | null>(null);
  const [businessLogoFile, setBusinessLogoFile] = useState<File | null>(null);
  const [businessLogoPreviewUrl, setBusinessLogoPreviewUrl] = useState<string | null>(null);
  const [businessLogoRemoved, setBusinessLogoRemoved] = useState(false);

  const role = authUser?.role;
  const isExpert = role === 'expert';
  const isCraftsman = role === 'craftsman';
  const isBusiness = role === 'business';
  const roleProfileKind: RoleProfileKind | null = isExpert
    ? 'expert'
    : isCraftsman
      ? 'craftsman'
      : isBusiness
        ? 'business'
        : null;
  const hasRoleProfile = roleProfileKind !== null;
  const expertImageMissing = (isExpert || isCraftsman) && !authUser?.avatarUrl;
  const businessImageMissing = isBusiness && !businessProfile?.logoUrl;

  useEffect(() => {
    setBusinessLogoPreviewUrl(businessProfile?.logoUrl ?? null);
    setBusinessLogoFile(null);
    setBusinessLogoRemoved(false);
  }, [businessProfile?.logoUrl]);

  const loadProfile = useCallback(async () => {
    if (!accessToken) return;
    if (!hasRoleProfile) {
      setExpertProfile(null);
      setCraftsmanProfile(null);
      setBusinessProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      if (isExpert) {
        const profile = await profilesApiClient.getExpertProfile(accessToken);
        setExpertProfile(profile);
        setCraftsmanProfile(null);
        setBusinessProfile(null);
      } else if (isCraftsman) {
        const profile = await profilesApiClient.getCraftsmanProfile(accessToken);
        setCraftsmanProfile(profile);
        setExpertProfile(null);
        setBusinessProfile(null);
      } else if (isBusiness) {
        const profile = await profilesApiClient.getBusinessProfile(accessToken);
        setBusinessProfile(profile);
        setExpertProfile(null);
        setCraftsmanProfile(null);
      }
    } catch {
      setExpertProfile(null);
      setCraftsmanProfile(null);
      setBusinessProfile(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, hasRoleProfile, isCraftsman, isExpert, isBusiness]);

  useEffect(() => {
    if (!isReady || !isAuthenticated || !authUser) {
      router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
      return;
    }
    if (!authGuard.emailVerified) {
      router.replace(buildLocalePath(locale, '/verify-email'));
      return;
    }
    void loadProfile();
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router, loadProfile]);

  const targetUserId = isExpert
    ? expertProfile?.userId
    : isCraftsman
      ? craftsmanProfile?.userId
      : isBusiness
        ? businessProfile?.userId
        : null;
  const targetType = isExpert
    ? 'expert'
    : isCraftsman
      ? 'craftsman'
      : isBusiness
        ? 'business'
        : null;
  const loadReviews = useCallback(async () => {
    if (!accessToken || !targetUserId || !targetType) return;
    setReviewsLoading(true);
    try {
      const data = await reviewsApiClient.list(accessToken, {
        targetUserId,
        targetType,
        page: reviewsPage,
        limit: 10,
      });
      setReviews(data.items);
      setReviewsTotal(data.total);
    } catch {
      setReviews([]);
    } finally {
      setReviewsLoading(false);
    }
  }, [accessToken, targetUserId, targetType, reviewsPage]);

  useEffect(() => {
    if (targetUserId && targetType) {
      void loadReviews();
      return;
    }

    setReviews([]);
    setReviewsTotal(0);
  }, [targetUserId, targetType, loadReviews]);

  const loadDocuments = useCallback(async () => {
    if (!accessToken || !hasRoleProfile) return;
    setDocumentsLoading(true);
    try {
      const idsPromise = profilesApiClient.getIdentityDocuments(accessToken);
      const acadsPromise = isExpert
        ? profilesApiClient.getAcademicRecords(accessToken)
        : Promise.resolve<AcademicRecord[]>([]);
      const [ids, acads] = await Promise.all([idsPromise, acadsPromise]);
      const resolvedIds = Array.isArray(ids) ? ids : [];
      const resolvedAcads = Array.isArray(acads) ? acads : [];
      setIdentityDocuments(resolvedIds);
      setAcademicRecords(resolvedAcads);
    } catch {
      setIdentityDocuments([]);
      setAcademicRecords([]);
    } finally {
      setDocumentsLoading(false);
    }
  }, [accessToken, hasRoleProfile, isExpert]);

  const toFullUploadUrl = useCallback((url: string) => {
    if (url.startsWith('http')) return url;
    const base = (getApiBaseUrl() || '').replace(/\/$/, '');
    return base ? `${base}${url.startsWith('/') ? '' : '/'}${url}` : url;
  }, []);

  useEffect(() => {
    if (hasRoleProfile) {
      void loadDocuments();
      return;
    }

    setIdentityDocuments([]);
    setAcademicRecords([]);
  }, [hasRoleProfile, loadDocuments]);

  const handleWithdrawIdentityDocument = useCallback(
    async (docId: string) => {
      if (!accessToken) return;
      setWithdrawingDocId(docId);
      setSaveMessage(null);
      try {
        await profilesApiClient.withdrawIdentityDocument(accessToken, docId);
        await loadDocuments();
        await loadProfile();
        await updateAuthUser();
        setSaveMessage({
          type: 'success',
          text:
            dictionary.profile.documents.withdrawSuccess ??
            'Submission removed. You can send a new verification when you are ready.',
        });
      } catch (err) {
        setSaveMessage({
          type: 'error',
          text: formatApiError(err, dictionary.profile.saveError),
        });
      } finally {
        setWithdrawingDocId(null);
      }
    },
    [accessToken, dictionary.profile, loadDocuments, loadProfile, updateAuthUser],
  );

  const handleSaveAcademicEdit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!accessToken || !editAcademicRecord) return;
      setAcademicEditError(null);
      setAcademicEditSaving(true);
      const form = e.currentTarget;
      const getVal = (name: string) =>
        (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement)?.value?.trim();
      const body = pickDefined({
        recordType: getVal('recordType') as AcademicRecord['recordType'],
        title: getVal('title') ?? editAcademicRecord.title,
        institution: getVal('institution') ?? editAcademicRecord.institution,
        fieldOfStudy: getVal('fieldOfStudy') || undefined,
        graduationYear: (() => {
          const y = parseInt(getVal('graduationYear') ?? '', 10);
          return Number.isFinite(y) ? y : undefined;
        })(),
        grade: getVal('grade') || undefined,
      });
      try {
        await profilesApiClient.updateAcademicRecord(
          accessToken,
          editAcademicRecord.id,
          body as Partial<AcademicRecordBody>,
        );
        setEditAcademicRecord(null);
        void loadDocuments();
      } catch (err) {
        setAcademicEditError(formatApiError(err, dictionary.profile.saveError));
      } finally {
        setAcademicEditSaving(false);
      }
    },
    [accessToken, editAcademicRecord, dictionary.profile, loadDocuments],
  );

  const handleAddIdentityDocument = useCallback(async () => {
    if (!accessToken) return;
    const needsBack = identityDocType === 'national_id' || identityDocType === 'driving_license';
    if (
      !identityFullNameOnDoc.trim() ||
      !identityFrontFile ||
      !identitySelfieFile ||
      (needsBack && !identityBackFile)
    ) {
      setIdentitySubmitError(
        'Please provide full name, document front, live selfie, and back image when required.',
      );
      return;
    }

    setIdentitySubmitting(true);
    setIdentitySubmitError(null);
    setSaveMessage(null);
    try {
      const [frontRes, backRes, selfieRes] = await Promise.all([
        uploadPrivateFile(accessToken, identityFrontFile),
        identityBackFile ? uploadPrivateFile(accessToken, identityBackFile) : Promise.resolve(null),
        uploadPrivateFile(accessToken, identitySelfieFile),
      ]);

      const frontFullUrl = toFullUploadUrl(frontRes.url);
      const selfieFullUrl = toFullUploadUrl(selfieRes.url);
      const backFullUrl = backRes ? toFullUploadUrl(backRes.url) : null;

      await profilesApiClient.submitIdentityDocument(accessToken, {
        documentType: identityDocType,
        fullNameOnDoc: identityFullNameOnDoc.trim(),
        frontImageUrl: frontFullUrl,
        selfieImageUrl: selfieFullUrl,
        ...(backFullUrl ? { backImageUrl: backFullUrl } : {}),
      });

      setAddIdentityOpen(false);
      setIdentityFullNameOnDoc('');
      setIdentityFrontFile(null);
      setIdentityBackFile(null);
      setIdentitySelfieFile(null);
      await loadDocuments();
      setSaveMessage({
        type: 'success',
        text:
          dictionary.profile.documents.identitySubmitSuccess ??
          'Identity document submitted successfully.',
      });
    } catch (err) {
      setIdentitySubmitError(formatApiError(err, dictionary.profile.saveError));
    } finally {
      setIdentitySubmitting(false);
    }
  }, [
    accessToken,
    identityDocType,
    identityFullNameOnDoc,
    identityFrontFile,
    identitySelfieFile,
    identityBackFile,
    toFullUploadUrl,
    loadDocuments,
    dictionary.profile.documents.identitySubmitSuccess,
    dictionary.profile.saveError,
  ]);

  const handleAddAcademicRecord = useCallback(async () => {
    if (!accessToken) return;
    if (!academicTitle.trim() || !academicInstitution.trim() || !academicCertificateFile) {
      setAcademicSubmitError('Title, institution, and certificate image are required.');
      return;
    }

    setAcademicSubmitting(true);
    setAcademicSubmitError(null);
    setSaveMessage(null);
    try {
      const [certRes, transcriptRes] = await Promise.all([
        uploadPrivateFile(accessToken, academicCertificateFile),
        academicTranscriptFile
          ? uploadPrivateFile(accessToken, academicTranscriptFile)
          : Promise.resolve(null),
      ]);

      await profilesApiClient.submitAcademicRecord(accessToken, {
        recordType: academicRecordType,
        title: academicTitle.trim(),
        institution: academicInstitution.trim(),
        certificateImageUrl: toFullUploadUrl(certRes.url),
        ...(academicTranscriptFile
          ? { transcriptImageUrl: toFullUploadUrl(transcriptRes!.url) }
          : {}),
        ...(academicFieldOfStudy.trim() ? { fieldOfStudy: academicFieldOfStudy.trim() } : {}),
        ...(academicGraduationYear.trim()
          ? { graduationYear: Number.parseInt(academicGraduationYear, 10) }
          : {}),
        ...(academicGrade.trim() ? { grade: academicGrade.trim() } : {}),
      });

      setAddAcademicOpen(false);
      setAcademicRecordType('degree');
      setAcademicTitle('');
      setAcademicInstitution('');
      setAcademicFieldOfStudy('');
      setAcademicGraduationYear('');
      setAcademicGrade('');
      setAcademicCertificateFile(null);
      setAcademicTranscriptFile(null);
      await loadDocuments();
      setSaveMessage({
        type: 'success',
        text:
          dictionary.profile.documents.academicSubmitSuccess ??
          'Academic record submitted successfully.',
      });
    } catch (err) {
      setAcademicSubmitError(formatApiError(err, dictionary.profile.saveError));
    } finally {
      setAcademicSubmitting(false);
    }
  }, [
    accessToken,
    academicTitle,
    academicInstitution,
    academicCertificateFile,
    academicTranscriptFile,
    academicRecordType,
    academicFieldOfStudy,
    academicGraduationYear,
    academicGrade,
    toFullUploadUrl,
    loadDocuments,
    dictionary.profile.documents.academicSubmitSuccess,
    dictionary.profile.saveError,
  ]);

  const submitReport = useCallback(async () => {
    if (!accessToken || !reportModalReviewId || reportSubmitting) return;
    setReportSubmitting(true);
    try {
      await reviewsApiClient.report(accessToken, reportModalReviewId, {
        reason: reportReason,
        ...(reportComment.trim() ? { comment: reportComment.trim() } : {}),
      });
      setReportModalReviewId(null);
      setReportComment('');
    } finally {
      setReportSubmitting(false);
    }
  }, [accessToken, reportModalReviewId, reportReason, reportComment, reportSubmitting]);

  const submitDispute = useCallback(async () => {
    if (!accessToken || !disputeModalReviewId || !disputeReason.trim() || disputeSubmitting) return;
    setDisputeSubmitting(true);
    try {
      await reviewsApiClient.dispute(accessToken, disputeModalReviewId, {
        reason: disputeReason.trim(),
      });
      setDisputeModalReviewId(null);
      setDisputeReason('');
    } finally {
      setDisputeSubmitting(false);
    }
  }, [accessToken, disputeModalReviewId, disputeReason, disputeSubmitting]);

  const handleSaveExpert = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken || !expertProfile) return;
    const form = e.currentTarget;
    const val = (name: string) =>
      nonEmpty((form.elements.namedItem(name) as HTMLInputElement)?.value);
    const numVal = (name: string) => {
      const n = parseFloat((form.elements.namedItem(name) as HTMLInputElement)?.value || '');
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const titleVal = val('title');
    const body = pickDefined({
      title: titleVal,
      headline: titleVal,
      bio: val('bio'),
      specializations: (
        (form.elements.namedItem('specializations') as HTMLInputElement)?.value || ''
      )
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      yearsOfExperience: numVal('yearsOfExperience'),
      hourlyRate: numVal('hourlyRate'),
      city: val('city'),
      country: val('country'),
      availabilityStatus: nonEmpty(
        (form.elements.namedItem('availabilityStatus') as HTMLSelectElement)?.value,
      ) as 'available' | 'busy' | 'offline' | undefined,
      employer: val('employer'),
      jobTitle: val('jobTitle'),
      linkedinUrl: val('linkedinUrl'),
      portfolioUrl: val('portfolioUrl'),
      languages: Array.from(
        form.querySelectorAll<HTMLInputElement>('input[name="languages"]:checked'),
      ).map((el) => el.value),
      educationSummary: val('educationSummary'),
    });
    setSaving(true);
    setSaveMessage(null);
    try {
      const updated = await profilesApiClient.updateExpertProfile(
        accessToken,
        body as UpdateExpertProfileBody,
      );
      setExpertProfile(updated);
      setSaveMessage({ type: 'success', text: dictionary.profile.saveSuccess });
    } catch (err) {
      setSaveMessage({ type: 'error', text: formatApiError(err, dictionary.profile.saveError) });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCraftsman = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken || !craftsmanProfile) return;
    const form = e.currentTarget;
    const val = (name: string) =>
      nonEmpty((form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement)?.value);
    const numVal = (name: string) => {
      const n = parseFloat((form.elements.namedItem(name) as HTMLInputElement)?.value || '');
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const titleVal = val('title');
    const tradeVal = val('trade');
    const body = pickDefined({
      trade: tradeVal,
      title: titleVal,
      headline: titleVal,
      bio: val('bio'),
      specializations: (
        (form.elements.namedItem('specializations') as HTMLInputElement)?.value || ''
      )
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      yearsOfExperience: numVal('yearsOfExperience'),
      hourlyRate: numVal('hourlyRate'),
      city: val('city'),
      country: val('country'),
      availabilityStatus: nonEmpty(
        (form.elements.namedItem('availabilityStatus') as HTMLSelectElement)?.value,
      ) as 'available' | 'busy' | 'offline' | undefined,
      workshopName: val('workshopName'),
      workshopAddress: val('workshopAddress'),
    });
    setSaving(true);
    setSaveMessage(null);
    try {
      const updated = await profilesApiClient.updateCraftsmanProfile(
        accessToken,
        body as UpdateCraftsmanProfileBody,
      );
      setCraftsmanProfile(updated);
      setSaveMessage({ type: 'success', text: dictionary.profile.saveSuccess });
    } catch (err) {
      setSaveMessage({ type: 'error', text: formatApiError(err, dictionary.profile.saveError) });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBusiness = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken || !businessProfile) return;
    const form = e.currentTarget;
    const val = (name: string) =>
      nonEmpty((form.elements.namedItem(name) as HTMLInputElement)?.value);
    const numVal = (name: string) => {
      const n = parseInt((form.elements.namedItem(name) as HTMLInputElement)?.value || '', 10);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const sizeVal = nonEmpty((form.elements.namedItem('companySize') as HTMLSelectElement)?.value);
    const industryVal = nonEmpty((form.elements.namedItem('industry') as HTMLSelectElement)?.value);
    const subIndustryVal = nonEmpty(
      (form.elements.namedItem('subIndustry') as HTMLSelectElement)?.value,
    );
    const industryDisplay =
      industryVal && subIndustryVal ? `${industryVal} — ${subIndustryVal}` : industryVal;
    let logoUrl: string | null | undefined;
    if (businessLogoRemoved) {
      logoUrl = null;
    } else if (businessLogoFile) {
      const uploaded = await uploadFile(accessToken, businessLogoFile);
      logoUrl = toAbsoluteAssetUrl(uploaded.url);
    }

    const body = pickDefined({
      companyName: val('companyName'),
      tradeLicenseNumber: val('tradeLicenseNumber'),
      taxId: val('taxId'),
      commercialRegister: val('commercialRegister'),
      industry: industryDisplay,
      companySize: sizeVal as UpdateBusinessProfileBody['companySize'],
      website: val('website'),
      companyEmail: val('companyEmail'),
      companyPhone: val('companyPhone'),
      address: val('address'),
      logoUrl,
      city: val('city'),
      country: val('country'),
      description: val('description'),
      ownerFullName: val('ownerFullName'),
      ownerTitle: val('ownerTitle'),
      ownerEmail: val('ownerEmail'),
      ownerPhone: val('ownerPhone'),
      foundedYear: numVal('foundedYear'),
    });
    setSaving(true);
    setSaveMessage(null);
    try {
      const updated = await profilesApiClient.updateBusinessProfile(
        accessToken,
        body as UpdateBusinessProfileBody,
      );
      setBusinessProfile(updated);
      setSaveMessage({ type: 'success', text: dictionary.profile.saveSuccess });
    } catch (err) {
      setSaveMessage({ type: 'error', text: formatApiError(err, dictionary.profile.saveError) });
    } finally {
      setSaving(false);
    }
  };

  if (!isReady || !authUser || !accessToken) {
    return (
      <main className="profile-screen-main">
        <Container className="profile-screen-container">
          <div className="skeleton-card" style={{ marginBottom: '1rem' }}>
            <SkeletonForm fields={6} />
          </div>
        </Container>
      </main>
    );
  }

  const expertForm = dictionary.onboarding.expert.profileForm;
  const craftsmanForm = dictionary.onboarding.craftsman.profileForm;
  const businessForm = dictionary.onboarding.business.companyForm;
  const verLabels = dictionary.verification.statusLabels;
  const roleVerificationStatus =
    (isExpert
      ? expertProfile?.verificationStatus
      : isCraftsman
        ? craftsmanProfile?.verificationStatus
        : isBusiness
          ? businessProfile?.verificationStatus
          : authUser.verificationStatus) ?? 'unverified';
  const verificationCompletedOrInReview =
    roleVerificationStatus === 'verified' ||
    roleVerificationStatus === 'pending' ||
    roleVerificationStatus === 'under_review';
  const visibleSections = getVisibleProfileSections(role);

  return (
    <main className="profile-screen-main">
      <Container className="profile-screen-container">
        <div className="app-page-header">
          <h1 className="app-page-title">{dictionary.nav.settings}</h1>
        </div>

        <nav className="profile-screen-jump-nav" aria-label={dictionary.nav.settings}>
          {visibleSections.map((section) => (
            <a key={section.id} href={`#${section.anchorId}`} className="profile-screen-jump-link">
              {getSectionLabel(section.id, dictionary, roleProfileKind)}
            </a>
          ))}
        </nav>

        {/* Account tab — all roles */}
        <AccountForm
          authUser={authUser}
          accessToken={accessToken}
          locale={locale}
          dictionary={dictionary}
          onUserUpdated={updateAuthUser}
        />

        {/* Role-specific profile tab */}
        {hasRoleProfile && loading && (
          <section
            id="profile-settings"
            className="profile-screen-card profile-screen-section-card"
          >
            <h2 className="profile-screen-sectionTitle">
              {getSectionLabel('profile', dictionary, roleProfileKind)}
            </h2>
            <div className="profile-screen-skeleton">
              <SkeletonForm fields={5} />
            </div>
          </section>
        )}

        {hasRoleProfile && !loading && isExpert && !expertProfile && (
          <section
            id="profile-settings"
            className="profile-screen-card profile-screen-section-card"
          >
            <h2 className="profile-screen-sectionTitle">
              {getSectionLabel('profile', dictionary, roleProfileKind)}
            </h2>
            <p className="profile-screen-no-profile">
              Expert profile not found. Please complete onboarding first.
            </p>
          </section>
        )}

        {!loading && isExpert && expertProfile && (
          <section
            id="profile-settings"
            className="profile-screen-card profile-screen-section-card"
          >
            <h2 className="profile-screen-sectionTitle">
              {getSectionLabel('profile', dictionary, roleProfileKind)}
            </h2>
            <span
              className={`profile-screen-badge profile-screen-badge_${expertProfile.verificationStatus}`}
            >
              {verLabels[expertProfile.verificationStatus as keyof typeof verLabels] ??
                expertProfile.verificationStatus}
            </span>
            {dictionary.verification?.verificationTimeNote && (
              <p className="profile-screen-verification-note">
                {dictionary.verification.verificationTimeNote}
              </p>
            )}
            {expertImageMissing && (
              <p className="profile-screen-save-error">
                {(dictionary.profile.account as { avatarRequiredHint?: string })
                  .avatarRequiredHint ??
                  'Add a profile picture in settings before you can complete verification or earn the badge.'}
              </p>
            )}
            {expertProfile.verificationBadgeEarned && (
              <span
                className="profile-screen-badge profile-screen-badge_verified"
                title="Complete profile and 1000 EGP total deposits."
              >
                Platform verified
              </span>
            )}
            {(expertProfile.averageRating != null || (expertProfile.reviewCount ?? 0) > 0) && (
              <p className="profile-screen-rating-row">
                <span
                  className="profile-screen-stars"
                  aria-label={
                    (dictionary.profile as { reviews?: { averageRating?: string } }).reviews
                      ?.averageRating ?? 'Average rating'
                  }
                >
                  {'★'.repeat(Math.round(expertProfile.averageRating ?? 0))}
                  {'☆'.repeat(5 - Math.round(expertProfile.averageRating ?? 0))}
                </span>
                <span className="profile-screen-review-count">
                  {expertProfile.averageRating != null &&
                    `${Number(expertProfile.averageRating).toFixed(1)} · `}
                  {expertProfile.reviewCount ?? 0}{' '}
                  {(dictionary.profile as { reviews?: { reviewCount?: string } }).reviews
                    ?.reviewCount ?? 'reviews'}
                </span>
              </p>
            )}
            <form onSubmit={(e) => void handleSaveExpert(e)} className="profile-screen-form">
              <div className="profile-screen-field">
                <label className="profile-screen-label">{expertForm.titleLabel}</label>
                <input
                  name="title"
                  className="profile-screen-input"
                  defaultValue={expertProfile.title ?? ''}
                  placeholder={expertForm.titlePlaceholder}
                />
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{expertForm.bioLabel}</label>
                <textarea
                  name="bio"
                  className="profile-screen-textarea"
                  rows={4}
                  defaultValue={expertProfile.bio ?? ''}
                />
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{expertForm.specializationsLabel}</label>
                <input
                  name="specializations"
                  className="profile-screen-input"
                  defaultValue={expertProfile.specializations?.join(', ') ?? ''}
                  placeholder={expertForm.specializationsHint}
                />
              </div>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">
                    {expertForm.yearsOfExperienceLabel}
                  </label>
                  <input
                    name="yearsOfExperience"
                    type="number"
                    className="profile-screen-input"
                    defaultValue={expertProfile.yearsOfExperience ?? ''}
                    min={0}
                  />
                </div>
                {hourlyPricingEnabled ? (
                  <div className="profile-screen-field">
                    <label className="profile-screen-label">{expertForm.hourlyRateLabel}</label>
                    <input
                      name="hourlyRate"
                      type="number"
                      className="profile-screen-input"
                      defaultValue={expertProfile.hourlyRate ?? ''}
                      min={0}
                      step="0.01"
                    />
                  </div>
                ) : null}
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">
                  {(dictionary.admin?.settingsMgmt?.sections as Record<string, string>)
                    ?.availability ?? 'Availability'}
                </label>
                <select
                  name="availabilityStatus"
                  className="profile-screen-select"
                  defaultValue={expertProfile.availabilityStatus ?? 'available'}
                >
                  <option value="available">Available</option>
                  <option value="busy">Busy</option>
                  <option value="offline">Offline</option>
                </select>
              </div>
              <CityCountrySelect
                name="city"
                countryName="country"
                locale={locale}
                cityLabel={expertForm.cityLabel}
                countryLabel={expertForm.countryLabel}
                className="profile-screen-field"
                selectClassName="profile-screen-select"
                defaultValue={expertProfile.city ?? ''}
                defaultCountry={expertProfile.country ?? ''}
              />
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{expertForm.employerLabel}</label>
                  <input
                    name="employer"
                    className="profile-screen-input"
                    defaultValue={expertProfile.employer ?? ''}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{expertForm.jobTitleLabel}</label>
                  <input
                    name="jobTitle"
                    className="profile-screen-input"
                    defaultValue={expertProfile.jobTitle ?? ''}
                  />
                </div>
              </div>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{expertForm.linkedinLabel}</label>
                  <input
                    name="linkedinUrl"
                    type="text"
                    className="profile-screen-input"
                    defaultValue={expertProfile.linkedinUrl ?? ''}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{expertForm.portfolioLabel}</label>
                  <input
                    name="portfolioUrl"
                    type="text"
                    className="profile-screen-input"
                    defaultValue={expertProfile.portfolioUrl ?? ''}
                  />
                </div>
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{expertForm.languagesLabel}</label>
                <LanguagesCheckboxes
                  name="languages"
                  locale={locale}
                  defaultValue={expertProfile.languages ?? []}
                  className="profile-screen-languages"
                />
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{expertForm.educationSummaryLabel}</label>
                <textarea
                  name="educationSummary"
                  className="profile-screen-textarea"
                  rows={3}
                  defaultValue={expertProfile.educationSummary ?? ''}
                />
              </div>
              {saveMessage && (
                <p
                  className={
                    saveMessage.type === 'success'
                      ? 'profile-screen-save-success'
                      : 'profile-screen-save-error'
                  }
                >
                  {saveMessage.text}
                </p>
              )}
              <button type="submit" className="profile-screen-submit-button" disabled={saving}>
                {saving ? dictionary.common.continue : dictionary.common.save}
              </button>
            </form>
            {hasRoleProfile && (
              <div className="profile-screen-reviews-section">
                <h3 className="profile-screen-reviews-title">
                  {(dictionary.profile as { reviews?: { sectionTitle?: string } }).reviews
                    ?.sectionTitle ?? 'Reviews'}
                </h3>
                {reviewsLoading ? (
                  <p className="profile-screen-muted">
                    {(dictionary.profile as { loading?: string }).loading ?? 'Loading...'}
                  </p>
                ) : reviews.length === 0 ? (
                  <p className="profile-screen-muted">
                    {(dictionary.profile as { reviews?: { noReviews?: string } }).reviews
                      ?.noReviews ?? 'No reviews yet.'}
                  </p>
                ) : (
                  <ul className="profile-screen-reviews-list">
                    {reviews.map((r) => (
                      <li key={r.id} className="profile-screen-review-item">
                        <span className="profile-screen-stars small">
                          {'★'.repeat(r.rating)}
                          {'☆'.repeat(5 - r.rating)}
                        </span>
                        {r.comment && <p className="profile-screen-review-comment">{r.comment}</p>}
                        <p className="profile-screen-review-meta">
                          {r.reviewerName ?? 'Anonymous'} ·{' '}
                          {new Date(r.createdAt).toLocaleDateString(locale)}
                        </p>
                        <div className="profile-screen-review-actions">
                          {r.reviewerId !== authUser?.id && (
                            <>
                              {reportModalReviewId !== r.id ? (
                                <button
                                  type="button"
                                  className="profile-screen-review-action-btn"
                                  onClick={() => setReportModalReviewId(r.id)}
                                >
                                  Report
                                </button>
                              ) : (
                                <div className="profile-screen-report-form">
                                  <select
                                    value={reportReason}
                                    onChange={(e) =>
                                      setReportReason(
                                        e.target.value as
                                          | 'inappropriate'
                                          | 'fake'
                                          | 'spam'
                                          | 'other',
                                      )
                                    }
                                    className="profile-screen-select"
                                  >
                                    <option value="inappropriate">Inappropriate</option>
                                    <option value="fake">Fake</option>
                                    <option value="spam">Spam</option>
                                    <option value="other">Other</option>
                                  </select>
                                  <input
                                    type="text"
                                    className="profile-screen-input"
                                    placeholder={
                                      (
                                        dictionary.profile as {
                                          reviews?: { commentPlaceholder?: string };
                                        }
                                      ).reviews?.commentPlaceholder ?? 'Optional comment'
                                    }
                                    value={reportComment}
                                    onChange={(e) => setReportComment(e.target.value)}
                                  />
                                  <div className="profile-screen-review-form-actions">
                                    <button
                                      type="button"
                                      className="profile-screen-cancel-btn"
                                      onClick={() => {
                                        setReportModalReviewId(null);
                                        setReportComment('');
                                      }}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="profile-screen-submit-button"
                                      disabled={reportSubmitting}
                                      onClick={() => void submitReport()}
                                    >
                                      {reportSubmitting ? '...' : 'Submit'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                          {r.targetUserId === authUser?.id && (
                            <>
                              {disputeModalReviewId !== r.id ? (
                                <button
                                  type="button"
                                  className="profile-screen-review-action-btn"
                                  onClick={() => setDisputeModalReviewId(r.id)}
                                >
                                  Dispute
                                </button>
                              ) : (
                                <div className="profile-screen-report-form">
                                  <textarea
                                    className="profile-screen-textarea"
                                    rows={2}
                                    placeholder="Reason for disputing"
                                    value={disputeReason}
                                    onChange={(e) => setDisputeReason(e.target.value)}
                                  />
                                  <div className="profile-screen-review-form-actions">
                                    <button
                                      type="button"
                                      className="profile-screen-cancel-btn"
                                      onClick={() => {
                                        setDisputeModalReviewId(null);
                                        setDisputeReason('');
                                      }}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="profile-screen-submit-button"
                                      disabled={disputeSubmitting || !disputeReason.trim()}
                                      onClick={() => void submitDispute()}
                                    >
                                      {disputeSubmitting ? '...' : 'Submit'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        )}

        {hasRoleProfile && !loading && isCraftsman && !craftsmanProfile && (
          <section
            id="profile-settings"
            className="profile-screen-card profile-screen-section-card"
          >
            <h2 className="profile-screen-sectionTitle">
              {getSectionLabel('profile', dictionary, roleProfileKind)}
            </h2>
            <p className="profile-screen-no-profile">
              Craftsman profile not found. Please complete onboarding first.
            </p>
          </section>
        )}

        {!loading && isCraftsman && craftsmanProfile && (
          <section
            id="profile-settings"
            className="profile-screen-card profile-screen-section-card"
          >
            <h2 className="profile-screen-sectionTitle">
              {getSectionLabel('profile', dictionary, roleProfileKind)}
            </h2>
            <span
              className={`profile-screen-badge profile-screen-badge_${craftsmanProfile.verificationStatus}`}
            >
              {verLabels[craftsmanProfile.verificationStatus as keyof typeof verLabels] ??
                craftsmanProfile.verificationStatus}
            </span>
            {dictionary.verification?.verificationTimeNote && (
              <p className="profile-screen-verification-note">
                {dictionary.verification.verificationTimeNote}
              </p>
            )}
            {expertImageMissing && (
              <p className="profile-screen-save-error">
                {(dictionary.profile.account as { avatarRequiredHint?: string })
                  .avatarRequiredHint ??
                  'Add a profile picture in settings before you can complete verification or earn the badge.'}
              </p>
            )}
            {craftsmanProfile.verificationBadgeEarned && (
              <span
                className="profile-screen-badge profile-screen-badge_verified"
                title="Complete profile and 1000 EGP total deposits."
              >
                Platform verified
              </span>
            )}
            {(craftsmanProfile.averageRating != null ||
              (craftsmanProfile.reviewCount ?? 0) > 0) && (
              <p className="profile-screen-rating-row">
                <span
                  className="profile-screen-stars"
                  aria-label={
                    (dictionary.profile as { reviews?: { averageRating?: string } }).reviews
                      ?.averageRating ?? 'Average rating'
                  }
                >
                  {'★'.repeat(Math.round(craftsmanProfile.averageRating ?? 0))}
                  {'☆'.repeat(5 - Math.round(craftsmanProfile.averageRating ?? 0))}
                </span>
                <span className="profile-screen-review-count">
                  {craftsmanProfile.averageRating != null &&
                    `${Number(craftsmanProfile.averageRating).toFixed(1)} · `}
                  {craftsmanProfile.reviewCount ?? 0}{' '}
                  {(dictionary.profile as { reviews?: { reviewCount?: string } }).reviews
                    ?.reviewCount ?? 'reviews'}
                </span>
              </p>
            )}
            <form onSubmit={(e) => void handleSaveCraftsman(e)} className="profile-screen-form">
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{craftsmanForm.tradeLabel}</label>
                  <input
                    name="trade"
                    className="profile-screen-input"
                    defaultValue={craftsmanProfile.trade ?? ''}
                    placeholder={craftsmanForm.tradePlaceholder}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{craftsmanForm.titleLabel}</label>
                  <input
                    name="title"
                    className="profile-screen-input"
                    defaultValue={craftsmanProfile.title ?? ''}
                    placeholder={craftsmanForm.titlePlaceholder}
                  />
                </div>
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{craftsmanForm.bioLabel}</label>
                <textarea
                  name="bio"
                  className="profile-screen-textarea"
                  rows={4}
                  defaultValue={craftsmanProfile.bio ?? ''}
                />
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{craftsmanForm.specializationsLabel}</label>
                <input
                  name="specializations"
                  className="profile-screen-input"
                  defaultValue={craftsmanProfile.specializations?.join(', ') ?? ''}
                  placeholder={craftsmanForm.specializationsHint}
                />
              </div>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">
                    {craftsmanForm.yearsOfExperienceLabel}
                  </label>
                  <input
                    name="yearsOfExperience"
                    type="number"
                    className="profile-screen-input"
                    defaultValue={craftsmanProfile.yearsOfExperience ?? ''}
                    min={0}
                  />
                </div>
                {hourlyPricingEnabled ? (
                  <div className="profile-screen-field">
                    <label className="profile-screen-label">{craftsmanForm.hourlyRateLabel}</label>
                    <input
                      name="hourlyRate"
                      type="number"
                      className="profile-screen-input"
                      defaultValue={craftsmanProfile.hourlyRate ?? ''}
                      min={0}
                      step="0.01"
                    />
                  </div>
                ) : null}
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{craftsmanForm.availabilityLabel}</label>
                <select
                  name="availabilityStatus"
                  className="profile-screen-select"
                  defaultValue={craftsmanProfile.availabilityStatus ?? 'available'}
                >
                  <option value="available">Available</option>
                  <option value="busy">Busy</option>
                  <option value="offline">Offline</option>
                </select>
              </div>
              <CityCountrySelect
                name="city"
                countryName="country"
                locale={locale}
                cityLabel={craftsmanForm.cityLabel}
                countryLabel={craftsmanForm.countryLabel}
                className="profile-screen-field"
                selectClassName="profile-screen-select"
                defaultValue={craftsmanProfile.city ?? ''}
                defaultCountry={craftsmanProfile.country ?? ''}
              />
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{craftsmanForm.workshopNameLabel}</label>
                  <input
                    name="workshopName"
                    className="profile-screen-input"
                    defaultValue={craftsmanProfile.workshopName ?? ''}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">
                    {craftsmanForm.workshopAddressLabel}
                  </label>
                  <input
                    name="workshopAddress"
                    className="profile-screen-input"
                    defaultValue={craftsmanProfile.workshopAddress ?? ''}
                    placeholder={craftsmanForm.workshopAddressHint}
                  />
                </div>
              </div>
              {saveMessage && (
                <p
                  className={
                    saveMessage.type === 'success'
                      ? 'profile-screen-save-success'
                      : 'profile-screen-save-error'
                  }
                >
                  {saveMessage.text}
                </p>
              )}
              <button type="submit" className="profile-screen-submit-button" disabled={saving}>
                {saving ? dictionary.common.continue : dictionary.common.save}
              </button>
            </form>
            {hasRoleProfile && (
              <div className="profile-screen-reviews-section">
                <h3 className="profile-screen-reviews-title">
                  {(dictionary.profile as { reviews?: { sectionTitle?: string } }).reviews
                    ?.sectionTitle ?? 'Reviews'}
                </h3>
                {reviewsLoading ? (
                  <p className="profile-screen-muted">
                    {(dictionary.profile as { loading?: string }).loading ?? 'Loading...'}
                  </p>
                ) : reviews.length === 0 ? (
                  <p className="profile-screen-muted">
                    {(dictionary.profile as { reviews?: { noReviews?: string } }).reviews
                      ?.noReviews ?? 'No reviews yet.'}
                  </p>
                ) : (
                  <ul className="profile-screen-reviews-list">
                    {reviews.map((r) => (
                      <li key={r.id} className="profile-screen-review-item">
                        <span className="profile-screen-stars small">
                          {'★'.repeat(r.rating)}
                          {'☆'.repeat(5 - r.rating)}
                        </span>
                        {r.comment && <p className="profile-screen-review-comment">{r.comment}</p>}
                        <p className="profile-screen-review-meta">
                          {r.reviewerName ?? 'Anonymous'} ·{' '}
                          {new Date(r.createdAt).toLocaleDateString(locale)}
                        </p>
                        <div className="profile-screen-review-actions">
                          {r.reviewerId !== authUser?.id && (
                            <>
                              {reportModalReviewId !== r.id ? (
                                <button
                                  type="button"
                                  className="profile-screen-review-action-btn"
                                  onClick={() => setReportModalReviewId(r.id)}
                                >
                                  Report
                                </button>
                              ) : (
                                <div className="profile-screen-report-form">
                                  <select
                                    value={reportReason}
                                    onChange={(e) =>
                                      setReportReason(
                                        e.target.value as
                                          | 'inappropriate'
                                          | 'fake'
                                          | 'spam'
                                          | 'other',
                                      )
                                    }
                                    className="profile-screen-select"
                                  >
                                    <option value="inappropriate">Inappropriate</option>
                                    <option value="fake">Fake</option>
                                    <option value="spam">Spam</option>
                                    <option value="other">Other</option>
                                  </select>
                                  <input
                                    type="text"
                                    className="profile-screen-input"
                                    placeholder={
                                      (
                                        dictionary.profile as {
                                          reviews?: { commentPlaceholder?: string };
                                        }
                                      ).reviews?.commentPlaceholder ?? 'Optional comment'
                                    }
                                    value={reportComment}
                                    onChange={(e) => setReportComment(e.target.value)}
                                  />
                                  <div className="profile-screen-review-form-actions">
                                    <button
                                      type="button"
                                      className="profile-screen-cancel-btn"
                                      onClick={() => {
                                        setReportModalReviewId(null);
                                        setReportComment('');
                                      }}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="profile-screen-submit-button"
                                      disabled={reportSubmitting}
                                      onClick={() => void submitReport()}
                                    >
                                      {reportSubmitting ? '...' : 'Submit'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                          {r.targetUserId === authUser?.id && (
                            <>
                              {disputeModalReviewId !== r.id ? (
                                <button
                                  type="button"
                                  className="profile-screen-review-action-btn"
                                  onClick={() => setDisputeModalReviewId(r.id)}
                                >
                                  Dispute
                                </button>
                              ) : (
                                <div className="profile-screen-report-form">
                                  <textarea
                                    className="profile-screen-textarea"
                                    rows={2}
                                    placeholder="Reason for disputing"
                                    value={disputeReason}
                                    onChange={(e) => setDisputeReason(e.target.value)}
                                  />
                                  <div className="profile-screen-review-form-actions">
                                    <button
                                      type="button"
                                      className="profile-screen-cancel-btn"
                                      onClick={() => {
                                        setDisputeModalReviewId(null);
                                        setDisputeReason('');
                                      }}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="profile-screen-submit-button"
                                      disabled={disputeSubmitting || !disputeReason.trim()}
                                      onClick={() => void submitDispute()}
                                    >
                                      {disputeSubmitting ? '...' : 'Submit'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        )}

        {hasRoleProfile && !loading && isBusiness && !businessProfile && (
          <section
            id="profile-settings"
            className="profile-screen-card profile-screen-section-card"
          >
            <h2 className="profile-screen-sectionTitle">
              {getSectionLabel('profile', dictionary, roleProfileKind)}
            </h2>
            <p className="profile-screen-no-profile">
              Business profile not found. Please complete onboarding first.
            </p>
          </section>
        )}

        {!loading && isBusiness && businessProfile && (
          <section
            id="profile-settings"
            className="profile-screen-card profile-screen-section-card"
          >
            <h2 className="profile-screen-sectionTitle">
              {getSectionLabel('profile', dictionary, roleProfileKind)}
            </h2>
            <span
              className={`profile-screen-badge profile-screen-badge_${businessProfile.verificationStatus}`}
            >
              {verLabels[businessProfile.verificationStatus as keyof typeof verLabels] ??
                businessProfile.verificationStatus}
            </span>
            {dictionary.verification?.verificationTimeNote && (
              <p className="profile-screen-verification-note">
                {dictionary.verification.verificationTimeNote}
              </p>
            )}
            {businessImageMissing && (
              <p className="profile-screen-save-error">
                {(dictionary.profile as { businessLogoRequiredHint?: string })
                  .businessLogoRequiredHint ??
                  'Add a company logo before you can complete verification or earn the badge.'}
              </p>
            )}
            {businessProfile.verificationBadgeEarned && (
              <span
                className="profile-screen-badge profile-screen-badge_verified"
                title="Complete profile and 1000 EGP total deposits."
              >
                Platform verified
              </span>
            )}
            {(businessProfile.averageRating != null || (businessProfile.reviewCount ?? 0) > 0) && (
              <p className="profile-screen-rating-row">
                <span
                  className="profile-screen-stars"
                  aria-label={
                    (dictionary.profile as { reviews?: { averageRating?: string } }).reviews
                      ?.averageRating ?? 'Average rating'
                  }
                >
                  {'★'.repeat(Math.round(businessProfile.averageRating ?? 0))}
                  {'☆'.repeat(5 - Math.round(businessProfile.averageRating ?? 0))}
                </span>
                <span className="profile-screen-review-count">
                  {businessProfile.averageRating != null &&
                    `${Number(businessProfile.averageRating).toFixed(1)} · `}
                  {businessProfile.reviewCount ?? 0}{' '}
                  {(dictionary.profile as { reviews?: { reviewCount?: string } }).reviews
                    ?.reviewCount ?? 'reviews'}
                </span>
              </p>
            )}
            <form onSubmit={(e) => void handleSaveBusiness(e)} className="profile-screen-form">
              <div className="profile-screen-field">
                <label className="profile-screen-label">{businessForm.companyNameLabel}</label>
                <input
                  name="companyName"
                  className="profile-screen-input"
                  defaultValue={businessProfile.companyName}
                  required
                />
              </div>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{businessForm.tradeLicenseLabel}</label>
                  <input
                    name="tradeLicenseNumber"
                    className="profile-screen-input"
                    defaultValue={businessProfile.tradeLicenseNumber ?? ''}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{businessForm.taxIdLabel}</label>
                  <input
                    name="taxId"
                    className="profile-screen-input"
                    defaultValue={businessProfile.taxId ?? ''}
                  />
                </div>
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">
                  {businessForm.commercialRegisterLabel}
                </label>
                <input
                  name="commercialRegister"
                  className="profile-screen-input"
                  defaultValue={businessProfile.commercialRegister ?? ''}
                />
              </div>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{businessForm.industryLabel}</label>
                  <IndustrySelect
                    locale={locale}
                    name="industry"
                    subName="subIndustry"
                    selectClassName="profile-screen-select"
                    defaultValue={businessProfile.industry ?? ''}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{businessForm.companySizeLabel}</label>
                  <select
                    name="companySize"
                    className="profile-screen-select"
                    defaultValue={businessProfile.companySize ?? ''}
                  >
                    <option value="">—</option>
                    {COMPANY_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {dictionary.verification.companySizes[s]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{businessForm.websiteLabel}</label>
                  <input
                    name="website"
                    type="text"
                    className="profile-screen-input"
                    defaultValue={businessProfile.website ?? ''}
                    placeholder="example.com or full URL"
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{businessForm.companyEmailLabel}</label>
                  <input
                    name="companyEmail"
                    type="email"
                    className="profile-screen-input"
                    defaultValue={businessProfile.companyEmail ?? ''}
                  />
                </div>
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{businessForm.companyPhoneLabel}</label>
                <input
                  name="companyPhone"
                  className="profile-screen-input"
                  defaultValue={businessProfile.companyPhone ?? ''}
                  maxLength={15}
                />
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">
                  {(businessForm as { logoLabel?: string }).logoLabel ?? 'Company logo'}
                </label>
                <p className="profile-screen-hint">
                  {(businessForm as { logoHint?: string }).logoHint ??
                    'Required for business verification and the platform verified badge.'}
                </p>
                {businessLogoPreviewUrl && !businessLogoRemoved && (
                  <div className="profile-screen-image-preview">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={profileImageDisplaySrc(businessLogoPreviewUrl)}
                      alt={(businessForm as { logoLabel?: string }).logoLabel ?? 'Company logo'}
                      className="profile-screen-image-preview-img"
                    />
                  </div>
                )}
                <ImageUploadOrCapture
                  label={
                    (businessForm as { logoUploadLabel?: string }).logoUploadLabel ??
                    'Upload company logo'
                  }
                  onImage={(file) => {
                    void (async () => {
                      setBusinessLogoFile(file);
                      setBusinessLogoRemoved(false);
                      setBusinessLogoPreviewUrl(await readFilePreview(file));
                    })();
                  }}
                  onClear={() => {
                    setBusinessLogoFile(null);
                    setBusinessLogoPreviewUrl(businessProfile.logoUrl ?? null);
                  }}
                  onError={(message) => setSaveMessage({ type: 'error', text: message })}
                  disabled={saving}
                />
                {(businessLogoPreviewUrl || businessProfile.logoUrl) && !businessLogoRemoved && (
                  <button
                    type="button"
                    className="profile-screen-cancel-btn profile-screen-inline-action"
                    onClick={() => {
                      setBusinessLogoFile(null);
                      setBusinessLogoPreviewUrl(null);
                      setBusinessLogoRemoved(true);
                    }}
                  >
                    {(businessForm as { logoRemoveButton?: string }).logoRemoveButton ??
                      'Remove logo'}
                  </button>
                )}
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{businessForm.addressLabel}</label>
                <textarea
                  name="address"
                  className="profile-screen-textarea"
                  rows={2}
                  defaultValue={businessProfile.address ?? ''}
                  placeholder="Paste a Google Maps link or enter address"
                />
              </div>
              <CityCountrySelect
                name="city"
                countryName="country"
                locale={locale}
                cityLabel={businessForm.cityLabel}
                countryLabel={businessForm.countryLabel}
                className="profile-screen-field"
                selectClassName="profile-screen-select"
                defaultValue={businessProfile.city ?? ''}
                defaultCountry={businessProfile.country ?? ''}
              />
              <div className="profile-screen-field">
                <label className="profile-screen-label">{businessForm.descriptionLabel}</label>
                <textarea
                  name="description"
                  className="profile-screen-textarea"
                  rows={4}
                  defaultValue={businessProfile.description ?? ''}
                />
              </div>
              <h3 className="profile-screen-sectionTitle">Owner</h3>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{businessForm.ownerNameLabel}</label>
                  <input
                    name="ownerFullName"
                    className="profile-screen-input"
                    defaultValue={businessProfile.ownerFullName ?? ''}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{businessForm.ownerTitleLabel}</label>
                  <input
                    name="ownerTitle"
                    className="profile-screen-input"
                    defaultValue={businessProfile.ownerTitle ?? ''}
                  />
                </div>
              </div>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{businessForm.ownerEmailLabel}</label>
                  <input
                    name="ownerEmail"
                    type="email"
                    className="profile-screen-input"
                    defaultValue={businessProfile.ownerEmail ?? ''}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{businessForm.ownerPhoneLabel}</label>
                  <input
                    name="ownerPhone"
                    className="profile-screen-input"
                    defaultValue={businessProfile.ownerPhone ?? ''}
                    maxLength={15}
                  />
                </div>
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{businessForm.foundedYearLabel}</label>
                <input
                  name="foundedYear"
                  type="number"
                  className="profile-screen-input"
                  defaultValue={businessProfile.foundedYear ?? ''}
                  min={1900}
                />
              </div>
              {saveMessage && (
                <p
                  className={
                    saveMessage.type === 'success'
                      ? 'profile-screen-save-success'
                      : 'profile-screen-save-error'
                  }
                >
                  {saveMessage.text}
                </p>
              )}
              <button type="submit" className="profile-screen-submit-button" disabled={saving}>
                {saving ? dictionary.common.continue : dictionary.common.save}
              </button>
            </form>
            {hasRoleProfile && (
              <div className="profile-screen-reviews-section">
                <h3 className="profile-screen-reviews-title">
                  {(dictionary.profile as { reviews?: { sectionTitle?: string } }).reviews
                    ?.sectionTitle ?? 'Reviews'}
                </h3>
                {reviewsLoading ? (
                  <p className="profile-screen-muted">
                    {(dictionary.profile as { loading?: string }).loading ?? 'Loading...'}
                  </p>
                ) : reviews.length === 0 ? (
                  <p className="profile-screen-muted">
                    {(dictionary.profile as { reviews?: { noReviews?: string } }).reviews
                      ?.noReviews ?? 'No reviews yet.'}
                  </p>
                ) : (
                  <ul className="profile-screen-reviews-list">
                    {reviews.map((r) => (
                      <li key={r.id} className="profile-screen-review-item">
                        <span className="profile-screen-stars small">
                          {'★'.repeat(r.rating)}
                          {'☆'.repeat(5 - r.rating)}
                        </span>
                        {r.comment && <p className="profile-screen-review-comment">{r.comment}</p>}
                        <p className="profile-screen-review-meta">
                          {r.reviewerName ?? 'Anonymous'} ·{' '}
                          {new Date(r.createdAt).toLocaleDateString(locale)}
                        </p>
                        <div className="profile-screen-review-actions">
                          {r.reviewerId !== authUser?.id && (
                            <>
                              {reportModalReviewId !== r.id ? (
                                <button
                                  type="button"
                                  className="profile-screen-review-action-btn"
                                  onClick={() => setReportModalReviewId(r.id)}
                                >
                                  Report
                                </button>
                              ) : (
                                <div className="profile-screen-report-form">
                                  <select
                                    value={reportReason}
                                    onChange={(e) =>
                                      setReportReason(
                                        e.target.value as
                                          | 'inappropriate'
                                          | 'fake'
                                          | 'spam'
                                          | 'other',
                                      )
                                    }
                                    className="profile-screen-select"
                                  >
                                    <option value="inappropriate">Inappropriate</option>
                                    <option value="fake">Fake</option>
                                    <option value="spam">Spam</option>
                                    <option value="other">Other</option>
                                  </select>
                                  <input
                                    type="text"
                                    className="profile-screen-input"
                                    placeholder="Optional comment"
                                    value={reportComment}
                                    onChange={(e) => setReportComment(e.target.value)}
                                  />
                                  <div className="profile-screen-review-form-actions">
                                    <button
                                      type="button"
                                      className="profile-screen-cancel-btn"
                                      onClick={() => {
                                        setReportModalReviewId(null);
                                        setReportComment('');
                                      }}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="profile-screen-submit-button"
                                      disabled={reportSubmitting}
                                      onClick={() => void submitReport()}
                                    >
                                      {reportSubmitting ? '...' : 'Submit'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                          {r.targetUserId === authUser?.id && (
                            <>
                              {disputeModalReviewId !== r.id ? (
                                <button
                                  type="button"
                                  className="profile-screen-review-action-btn"
                                  onClick={() => setDisputeModalReviewId(r.id)}
                                >
                                  Dispute
                                </button>
                              ) : (
                                <div className="profile-screen-report-form">
                                  <textarea
                                    className="profile-screen-textarea"
                                    rows={2}
                                    placeholder="Reason for disputing"
                                    value={disputeReason}
                                    onChange={(e) => setDisputeReason(e.target.value)}
                                  />
                                  <div className="profile-screen-review-form-actions">
                                    <button
                                      type="button"
                                      className="profile-screen-cancel-btn"
                                      onClick={() => {
                                        setDisputeModalReviewId(null);
                                        setDisputeReason('');
                                      }}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="profile-screen-submit-button"
                                      disabled={disputeSubmitting || !disputeReason.trim()}
                                      onClick={() => void submitDispute()}
                                    >
                                      {disputeSubmitting ? '...' : 'Submit'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        )}

        {hasRoleProfile && (
          <section
            id="verification-settings"
            className="profile-screen-card profile-screen-documents-card profile-screen-section-card"
          >
            <h2 className="profile-screen-sectionTitle">
              {getSectionLabel('verification', dictionary, roleProfileKind)}
            </h2>
            {documentsLoading ? (
              <div className="profile-screen-skeleton">
                <SkeletonForm fields={4} />
              </div>
            ) : (
              <>
                <h3 className="profile-screen-sectionTitle">
                  {dictionary.profile.documents.identityTitle}
                </h3>
                <p className="profile-screen-hint">
                  {dictionary.profile.documents.identityDescription}
                </p>
                {(isExpert || isCraftsman) && expertImageMissing && (
                  <p className="profile-screen-save-error">
                    {(dictionary.profile.account as { avatarRequiredHint?: string })
                      .avatarRequiredHint ??
                      'Add a profile picture in settings before you can complete verification or earn the badge.'}
                  </p>
                )}
                {isBusiness && businessImageMissing && (
                  <p className="profile-screen-save-error">
                    {(dictionary.profile as { businessLogoRequiredHint?: string })
                      .businessLogoRequiredHint ??
                      'Add a company logo before you can complete verification or earn the badge.'}
                  </p>
                )}
                {isBusiness && businessProfile && (
                  <>
                    <h3 className="profile-screen-sectionTitle profile-screen-sectionTitle--spaced">
                      {dictionary.profile.documents.companyDetailsTitle ?? 'Company details'}
                    </h3>
                    <p className="profile-screen-hint">
                      {dictionary.profile.documents.companyDetailsHint ??
                        'Registration details submitted with your business profile. Admin may use these for verification.'}
                    </p>
                    <p className="profile-screen-hint profile-screen-hint--muted">
                      {dictionary.profile.documents.companyUploadNote ??
                        'Upload of company document files (e.g. trade license scan) will be available here in a future update.'}
                    </p>
                    <ul className="profile-screen-doc-list" aria-label="Company details">
                      <li className="profile-screen-doc-item">
                        <span className="profile-screen-doc-type">
                          {dictionary.profile.documents.tradeLicense ?? 'Trade license'}
                        </span>
                        <span className="profile-screen-doc-meta">
                          {businessProfile.tradeLicenseNumber ||
                            (dictionary.profile.documents.notSubmitted ?? 'Not submitted')}
                        </span>
                      </li>
                      <li className="profile-screen-doc-item">
                        <span className="profile-screen-doc-type">
                          {dictionary.profile.documents.taxId ?? 'Tax ID'}
                        </span>
                        <span className="profile-screen-doc-meta">
                          {businessProfile.taxId ||
                            (dictionary.profile.documents.notSubmitted ?? 'Not submitted')}
                        </span>
                      </li>
                      <li className="profile-screen-doc-item">
                        <span className="profile-screen-doc-type">
                          {dictionary.profile.documents.commercialRegister ?? 'Commercial register'}
                        </span>
                        <span className="profile-screen-doc-meta">
                          {businessProfile.commercialRegister ||
                            (dictionary.profile.documents.notSubmitted ?? 'Not submitted')}
                        </span>
                      </li>
                      <li className="profile-screen-doc-item">
                        <span className="profile-screen-doc-type">
                          {dictionary.profile.documents.status}
                        </span>
                        <span
                          className={`profile-screen-doc-status profile-screen-doc-status--${businessProfile.verificationStatus ?? 'unverified'}`}
                        >
                          {businessProfile.verificationStatus === 'verified'
                            ? 'Verified'
                            : businessProfile.verificationStatus === 'pending'
                              ? 'Pending'
                              : businessProfile.verificationStatus === 'rejected'
                                ? 'Rejected'
                                : 'Unverified'}
                        </span>
                      </li>
                    </ul>
                  </>
                )}

                {identityDocuments.length === 0 ? (
                  <>
                    <p className="profile-screen-noDocuments">
                      {dictionary.profile.documents.noDocuments}
                    </p>
                    {verificationCompletedOrInReview ? (
                      <span
                        className={`profile-screen-doc-status profile-screen-doc-status--${roleVerificationStatus}`}
                      >
                        {dictionary.profile.documents.status}:{' '}
                        {verLabels[roleVerificationStatus as keyof typeof verLabels] ??
                          roleVerificationStatus}
                      </span>
                    ) : hasRoleProfile ? (
                      <button
                        type="button"
                        onClick={() => setAddIdentityOpen(true)}
                        className="profile-screen-cta-link"
                      >
                        {dictionary.profile.documents.addIdentityDocument ??
                          'Add identity document'}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <ul className="profile-screen-doc-list" aria-label="Identity documents">
                    {identityDocuments.map((doc) => (
                      <li key={doc.id} className="profile-screen-doc-item">
                        <span className="profile-screen-doc-type">
                          {doc.documentType === 'national_id'
                            ? 'National ID'
                            : doc.documentType === 'passport'
                              ? 'Passport'
                              : 'Driving license'}
                        </span>
                        <span
                          className={`profile-screen-doc-status profile-screen-doc-status--${doc.status}`}
                        >
                          {dictionary.profile.documents.status}:{' '}
                          {doc.status === 'pending'
                            ? 'Pending'
                            : doc.status === 'under_review'
                              ? 'Under review'
                              : doc.status === 'approved'
                                ? 'Approved'
                                : 'Rejected'}
                        </span>
                        {doc.reviewedAt && (
                          <span className="profile-screen-doc-meta">
                            {dictionary.profile.documents.reviewedAt}:{' '}
                            {new Date(doc.reviewedAt).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        )}
                        {doc.rejectionReason && (
                          <p className="profile-screen-doc-rejection">
                            {dictionary.profile.documents.rejectionReason}: {doc.rejectionReason}
                          </p>
                        )}
                        {(doc.status === 'pending' || doc.status === 'under_review') && (
                          <div className="profile-screen-doc-actions">
                            <button
                              type="button"
                              className="profile-screen-doc-edit-btn"
                              disabled={withdrawingDocId === doc.id || documentsLoading}
                              onClick={() => void handleWithdrawIdentityDocument(doc.id)}
                            >
                              {withdrawingDocId === doc.id
                                ? dictionary.auth.common.loading
                                : (dictionary.profile.documents.withdrawPendingIdentity ??
                                  'Remove submission')}
                            </button>
                          </div>
                        )}
                        {doc.status === 'rejected' && (
                          <button
                            type="button"
                            onClick={() => setAddIdentityOpen(true)}
                            className="profile-screen-doc-resubmit"
                          >
                            {dictionary.profile.documents.resubmit}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {isExpert && (
                  <>
                    <h3 className="profile-screen-sectionTitle" style={{ marginTop: '1.5rem' }}>
                      {dictionary.profile.documents.academicTitle}
                    </h3>
                    <p className="profile-screen-hint">
                      {dictionary.profile.documents.academicDescription}
                    </p>
                    {academicRecords.length === 0 ? (
                      <>
                        <p className="profile-screen-noDocuments">
                          {dictionary.profile.documents.noDocuments}
                        </p>
                        <button
                          type="button"
                          onClick={() => setAddAcademicOpen(true)}
                          className="profile-screen-cta-link"
                        >
                          {dictionary.profile.documents.addAcademicRecord ?? 'Add academic record'}
                        </button>
                      </>
                    ) : (
                      <>
                        <ul className="profile-screen-doc-list" aria-label="Academic records">
                          {academicRecords.map((rec) => (
                            <li
                              key={rec.id}
                              className="profile-screen-doc-item profile-screen-doc-item--with-actions"
                            >
                              <span className="profile-screen-doc-type">
                                {rec.title} — {rec.institution}
                              </span>
                              <span
                                className={`profile-screen-doc-status profile-screen-doc-status--${rec.status}`}
                              >
                                {dictionary.profile.documents.status}:{' '}
                                {rec.status === 'pending'
                                  ? 'Pending'
                                  : rec.status === 'under_review'
                                    ? 'Under review'
                                    : rec.status === 'approved'
                                      ? 'Approved'
                                      : 'Rejected'}
                              </span>
                              {rec.reviewedAt && (
                                <span className="profile-screen-doc-meta">
                                  {dictionary.profile.documents.reviewedAt}:{' '}
                                  {new Date(rec.reviewedAt).toLocaleDateString(undefined, {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </span>
                              )}
                              {rec.rejectionReason && (
                                <p className="profile-screen-doc-rejection">
                                  {dictionary.profile.documents.rejectionReason}:{' '}
                                  {rec.rejectionReason}
                                </p>
                              )}
                              <div className="profile-screen-doc-actions">
                                <button
                                  type="button"
                                  className="profile-screen-doc-edit-btn"
                                  onClick={() => setEditAcademicRecord(rec)}
                                >
                                  {dictionary.profile.documents.editAcademicRecord ?? 'Edit'}
                                </button>
                                {rec.status === 'rejected' && (
                                  <button
                                    type="button"
                                    onClick={() => setAddAcademicOpen(true)}
                                    className="profile-screen-doc-resubmit"
                                  >
                                    {dictionary.profile.documents.resubmit}
                                  </button>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          onClick={() => setAddAcademicOpen(true)}
                          className="profile-screen-cta-link profile-screen-cta-link--secondary"
                        >
                          {dictionary.profile.documents.addAnotherAcademicRecord ??
                            'Add another academic record'}
                        </button>
                      </>
                    )}
                  </>
                )}

                {identityDocuments.length === 0 &&
                  (!isExpert || academicRecords.length === 0) &&
                  !verificationCompletedOrInReview && (
                    <button
                      type="button"
                      onClick={() => setAddIdentityOpen(true)}
                      className="profile-screen-cta-link"
                    >
                      {dictionary.profile.documents.goToVerification}
                    </button>
                  )}
              </>
            )}
          </section>
        )}

        {addIdentityOpen && (
          <div
            className="profile-screen-modal-backdrop"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.target === e.currentTarget && setAddIdentityOpen(false)}
          >
            <div className="profile-screen-modal" onClick={(e) => e.stopPropagation()}>
              <h2 className="profile-screen-sectionTitle">
                {dictionary.profile.documents.addIdentityDocument ?? 'Add identity document'}
              </h2>
              {identitySubmitError && (
                <p className="profile-screen-save-error">{identitySubmitError}</p>
              )}
              <div className="profile-screen-form">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">Document type</label>
                  <select
                    className="profile-screen-input"
                    value={identityDocType}
                    onChange={(e) => setIdentityDocType(e.target.value as IdentityDocumentType)}
                  >
                    <option value="national_id">National ID</option>
                    <option value="passport">Passport</option>
                    <option value="driving_license">Driving License</option>
                  </select>
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">Full name on document</label>
                  <input
                    className="profile-screen-input"
                    value={identityFullNameOnDoc}
                    onChange={(e) => setIdentityFullNameOnDoc(e.target.value)}
                  />
                </div>
                <ImageUploadOrCapture
                  label="Document front"
                  onImage={(f) => setIdentityFrontFile(f)}
                  onClear={() => setIdentityFrontFile(null)}
                  onError={setIdentitySubmitError}
                  required
                  disabled={identitySubmitting}
                />
                <ImageUploadOrCapture
                  label="Document back (required for National ID/Driving License)"
                  onImage={(f) => setIdentityBackFile(f)}
                  onClear={() => setIdentityBackFile(null)}
                  onError={setIdentitySubmitError}
                  required={false}
                  disabled={identitySubmitting}
                />
                <ImageUploadOrCapture
                  label="Live selfie"
                  onImage={(f) => setIdentitySelfieFile(f)}
                  onClear={() => setIdentitySelfieFile(null)}
                  onError={setIdentitySubmitError}
                  required
                  disabled={identitySubmitting}
                />
                <div className="profile-screen-actions">
                  <button
                    type="button"
                    className="profile-screen-cancel-btn"
                    onClick={() => setAddIdentityOpen(false)}
                    disabled={identitySubmitting}
                  >
                    {dictionary.common.cancel}
                  </button>
                  <button
                    type="button"
                    className="profile-screen-submit-button"
                    onClick={() => void handleAddIdentityDocument()}
                    disabled={identitySubmitting}
                  >
                    {identitySubmitting ? dictionary.auth.common.loading : dictionary.common.submit}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {addAcademicOpen && (
          <div
            className="profile-screen-modal-backdrop"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.target === e.currentTarget && setAddAcademicOpen(false)}
          >
            <div className="profile-screen-modal" onClick={(e) => e.stopPropagation()}>
              <h2 className="profile-screen-sectionTitle">
                {dictionary.profile.documents.addAcademicRecord ?? 'Add academic record'}
              </h2>
              {academicSubmitError && (
                <p className="profile-screen-save-error">{academicSubmitError}</p>
              )}
              <div className="profile-screen-form">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">Record type</label>
                  <select
                    className="profile-screen-input"
                    value={academicRecordType}
                    onChange={(e) =>
                      setAcademicRecordType(
                        e.target.value as 'degree' | 'diploma' | 'certificate' | 'license',
                      )
                    }
                  >
                    <option value="degree">Degree</option>
                    <option value="diploma">Diploma</option>
                    <option value="certificate">Certificate</option>
                    <option value="license">License</option>
                  </select>
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">Title</label>
                  <input
                    className="profile-screen-input"
                    value={academicTitle}
                    onChange={(e) => setAcademicTitle(e.target.value)}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">Institution</label>
                  <input
                    className="profile-screen-input"
                    value={academicInstitution}
                    onChange={(e) => setAcademicInstitution(e.target.value)}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">Field of study (optional)</label>
                  <input
                    className="profile-screen-input"
                    value={academicFieldOfStudy}
                    onChange={(e) => setAcademicFieldOfStudy(e.target.value)}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">Graduation year (optional)</label>
                  <input
                    className="profile-screen-input"
                    type="number"
                    value={academicGraduationYear}
                    onChange={(e) => setAcademicGraduationYear(e.target.value)}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">Grade (optional)</label>
                  <input
                    className="profile-screen-input"
                    value={academicGrade}
                    onChange={(e) => setAcademicGrade(e.target.value)}
                  />
                </div>
                <ImageUploadOrCapture
                  label="Certificate image"
                  onImage={(f) => setAcademicCertificateFile(f)}
                  onClear={() => setAcademicCertificateFile(null)}
                  onError={setAcademicSubmitError}
                  required
                  disabled={academicSubmitting}
                />
                <ImageUploadOrCapture
                  label="Transcript image (optional)"
                  onImage={(f) => setAcademicTranscriptFile(f)}
                  onClear={() => setAcademicTranscriptFile(null)}
                  onError={setAcademicSubmitError}
                  required={false}
                  disabled={academicSubmitting}
                />
                <div className="profile-screen-actions">
                  <button
                    type="button"
                    className="profile-screen-cancel-btn"
                    onClick={() => setAddAcademicOpen(false)}
                    disabled={academicSubmitting}
                  >
                    {dictionary.common.cancel}
                  </button>
                  <button
                    type="button"
                    className="profile-screen-submit-button"
                    onClick={() => void handleAddAcademicRecord()}
                    disabled={academicSubmitting}
                  >
                    {academicSubmitting ? dictionary.auth.common.loading : dictionary.common.submit}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {editAcademicRecord && (
          <div
            className="profile-screen-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-academic-record-title"
            onClick={(e) => e.target === e.currentTarget && setEditAcademicRecord(null)}
            onKeyDown={(e) => e.key === 'Escape' && setEditAcademicRecord(null)}
          >
            <div className="profile-screen-modal" onClick={(e) => e.stopPropagation()}>
              <h2 id="edit-academic-record-title" className="profile-screen-sectionTitle">
                {dictionary.profile.documents.editAcademicRecord ?? 'Edit'} —{' '}
                {editAcademicRecord.title}
              </h2>
              {academicEditError && (
                <p className="profile-screen-save-error" role="alert">
                  {academicEditError}
                </p>
              )}
              <form
                onSubmit={(e) => void handleSaveAcademicEdit(e)}
                className="profile-screen-form"
              >
                <div className="profile-screen-field">
                  <label htmlFor="edit-recordType" className="profile-screen-label">
                    Record type
                  </label>
                  <select
                    id="edit-recordType"
                    name="recordType"
                    className="profile-screen-input"
                    defaultValue={editAcademicRecord.recordType}
                    required
                  >
                    <option value="degree">
                      {(dictionary.verification as { academicRecordTypes?: Record<string, string> })
                        ?.academicRecordTypes?.degree ?? 'Degree'}
                    </option>
                    <option value="diploma">
                      {(dictionary.verification as { academicRecordTypes?: Record<string, string> })
                        ?.academicRecordTypes?.diploma ?? 'Diploma'}
                    </option>
                    <option value="certificate">
                      {(dictionary.verification as { academicRecordTypes?: Record<string, string> })
                        ?.academicRecordTypes?.certificate ?? 'Certificate'}
                    </option>
                    <option value="license">
                      {(dictionary.verification as { academicRecordTypes?: Record<string, string> })
                        ?.academicRecordTypes?.license ?? 'License'}
                    </option>
                  </select>
                </div>
                <div className="profile-screen-field">
                  <label htmlFor="edit-title" className="profile-screen-label">
                    Title
                  </label>
                  <input
                    id="edit-title"
                    name="title"
                    type="text"
                    className="profile-screen-input"
                    defaultValue={editAcademicRecord.title}
                    required
                    minLength={2}
                    maxLength={300}
                  />
                </div>
                <div className="profile-screen-field">
                  <label htmlFor="edit-institution" className="profile-screen-label">
                    Institution
                  </label>
                  <input
                    id="edit-institution"
                    name="institution"
                    type="text"
                    className="profile-screen-input"
                    defaultValue={editAcademicRecord.institution}
                    required
                    minLength={2}
                    maxLength={300}
                  />
                </div>
                <div className="profile-screen-field">
                  <label htmlFor="edit-fieldOfStudy" className="profile-screen-label">
                    Field of study
                  </label>
                  <input
                    id="edit-fieldOfStudy"
                    name="fieldOfStudy"
                    type="text"
                    className="profile-screen-input"
                    defaultValue={editAcademicRecord.fieldOfStudy ?? ''}
                    maxLength={200}
                  />
                </div>
                <div className="profile-screen-field">
                  <label htmlFor="edit-graduationYear" className="profile-screen-label">
                    Graduation year
                  </label>
                  <input
                    id="edit-graduationYear"
                    name="graduationYear"
                    type="number"
                    className="profile-screen-input"
                    defaultValue={editAcademicRecord.graduationYear ?? ''}
                    min={1950}
                    max={new Date().getFullYear()}
                  />
                </div>
                <div className="profile-screen-field">
                  <label htmlFor="edit-grade" className="profile-screen-label">
                    Grade
                  </label>
                  <input
                    id="edit-grade"
                    name="grade"
                    type="text"
                    className="profile-screen-input"
                    defaultValue={editAcademicRecord.grade ?? ''}
                    maxLength={50}
                  />
                </div>
                <div className="profile-screen-form-actions">
                  <button
                    type="button"
                    className="profile-screen-button profile-screen-button--secondary"
                    onClick={() => {
                      setEditAcademicRecord(null);
                      setAcademicEditError(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="profile-screen-button profile-screen-button--primary"
                    disabled={academicEditSaving}
                  >
                    {academicEditSaving
                      ? (dictionary.common?.saving ?? 'Saving...')
                      : (dictionary.common?.save ?? 'Save')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </Container>
    </main>
  );
};
