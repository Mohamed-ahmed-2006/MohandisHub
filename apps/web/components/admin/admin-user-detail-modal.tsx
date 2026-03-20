
'use client';

import type {
  AdminChangeUserEmailBody,
  AdminUpdateUserBody,
  AdminUserActivityType,
  AdminUserOverview,
  Plan,
} from '@mohandishub/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ImagePreviewModal } from '@/components/ui/image-preview-modal';
import { adminApiClient } from '@/lib/admin/client';
import type { Dictionary } from '@/lib/i18n/types';

type TabId = 'overview' | 'account' | 'roleProfile' | 'verification' | 'activity' | 'security';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  refreshSession: () => Promise<string | null>;
  adminPermissions: string[];
  userId: string | null;
  onClose: () => void;
  onSuccess: () => void;
};

type AccountForm = {
  displayName: string;
  phone: string;
  phoneCode: string;
  nationality: string;
  dateOfBirth: string;
  primaryRole: 'customer' | 'expert' | 'craftsman' | 'business';
  isAdmin: boolean;
  adminPermissions: string[];
  planId: string;
};

type AdjustForm = {
  type: 'deposit' | 'withdrawal' | 'adjustment' | 'bonus';
  amount: number;
  description: string;
};

const opts = (refreshSession: () => Promise<string | null>) => ({ refreshSession });

const hasPermission = (permissions: string[], permission: string): boolean => {
  if (permissions.length === 0) return true;
  return permissions.includes(permission);
};

const formatDate = (value: string | null): string => {
  if (!value) return '-';
  return new Date(value).toLocaleDateString();
};

const formatDateTime = (value: string | null): string => {
  if (!value) return '-';
  return new Date(value).toLocaleString();
};

const formatPrimitive = (value: unknown, fallback = '-'): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return fallback;
};

const availablePermissions = [
  { id: 'manage_users', label: 'Manage Users' },
  { id: 'manage_plans', label: 'Manage Plans' },
  { id: 'manage_transactions', label: 'Manage Transactions' },
  { id: 'manage_services', label: 'Manage Services' },
  { id: 'manage_verifications', label: 'Manage Verifications' },
  { id: 'manage_settings', label: 'Manage App Settings' },
];

export const AdminUserDetailModal = ({
  dictionary,
  accessToken,
  refreshSession,
  adminPermissions,
  userId,
  onClose,
  onSuccess,
}: Props) => {
  const [overview, setOverview] = useState<AdminUserOverview | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const [account, setAccount] = useState<AccountForm>({
    displayName: '',
    phone: '',
    phoneCode: '',
    nationality: '',
    dateOfBirth: '',
    primaryRole: 'customer',
    isAdmin: false,
    adminPermissions: [],
    planId: '',
  });

  const [expertJson, setExpertJson] = useState('{}');
  const [craftsmanJson, setCraftsmanJson] = useState('{}');
  const [businessJson, setBusinessJson] = useState('{}');
  const [roleProfileError, setRoleProfileError] = useState<string | null>(null);

  const [changeEmail, setChangeEmail] = useState({ newEmail: '', sendVerificationEmail: true });
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustForm, setAdjustForm] = useState<AdjustForm>({
    type: 'deposit',
    amount: 0,
    description: '',
  });

  const [activityType, setActivityType] = useState<AdminUserActivityType>('needs');
  const [activityPage, setActivityPage] = useState(1);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityData, setActivityData] = useState<{
    items: Array<Record<string, unknown>>;
    page: number;
    totalPages: number;
  } | null>(null);

  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);

  const d = dictionary.admin.users;
  const ud = d.userDetail;
  const u360 = ud.user360;

  const canManageUsers = hasPermission(adminPermissions, 'manage_users');
  const canManagePlans = hasPermission(adminPermissions, 'manage_plans');
  const canManageTransactions = hasPermission(adminPermissions, 'manage_transactions');
  const canManageVerifications = hasPermission(adminPermissions, 'manage_verifications');

  const user = overview?.user ?? null;

  const activityTypes = useMemo(() => {
    const base: AdminUserActivityType[] = ['needs', 'bids', 'jobs', 'jobApplications', 'bookings'];
    if (canManageTransactions) base.push('transactions');
    return base;
  }, [canManageTransactions]);

  const loadOverview = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [overviewData, plansData] = await Promise.all([
        adminApiClient.getUserOverview(accessToken, userId, opts(refreshSession)),
        canManagePlans
          ? adminApiClient.getPlans(accessToken, opts(refreshSession))
          : Promise.resolve([] as Plan[]),
      ]);

      setOverview(overviewData);
      setPlans(plansData);

      const planId = plansData.find((plan) => plan.slug === overviewData.user.planSlug)?.id ?? '';

      setAccount({
        displayName: overviewData.user.displayName,
        phone: overviewData.user.phone ?? '',
        phoneCode: overviewData.user.phoneCode ?? '',
        nationality: overviewData.user.nationality ?? '',
        dateOfBirth: overviewData.user.dateOfBirth ?? '',
        primaryRole:
          overviewData.user.primaryRole === 'admin' ? 'customer' : overviewData.user.primaryRole,
        isAdmin: overviewData.user.isAdmin,
        adminPermissions: overviewData.user.adminPermissions ?? [],
        planId,
      });

      setExpertJson(JSON.stringify(overviewData.expertProfile ?? {}, null, 2));
      setCraftsmanJson(JSON.stringify(overviewData.craftsmanProfile ?? {}, null, 2));
      setBusinessJson(JSON.stringify(overviewData.businessProfile ?? {}, null, 2));
      setRoleProfileError(null);
    } catch {
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, canManagePlans, refreshSession, userId]);

  const loadActivity = useCallback(async () => {
    if (!userId) return;
    if (activityType === 'transactions' && !canManageTransactions) return;

    setActivityLoading(true);
    try {
      const result = await adminApiClient.getUserActivity(
        accessToken,
        userId,
        activityType,
        { page: activityPage, limit: 10 },
        opts(refreshSession),
      );

      setActivityData({
        items: result.items as Array<Record<string, unknown>>,
        page: result.page,
        totalPages: result.totalPages,
      });
    } catch {
      setActivityData(null);
    } finally {
      setActivityLoading(false);
    }
  }, [accessToken, activityPage, activityType, canManageTransactions, refreshSession, userId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (activeTab === 'activity') {
      void loadActivity();
    }
  }, [activeTab, loadActivity]);

  useEffect(() => {
    if (!activityTypes.includes(activityType)) {
      setActivityType(activityTypes[0] ?? 'needs');
      setActivityPage(1);
    }
  }, [activityType, activityTypes]);

  const handleSaveAccount = async () => {
    if (!user || !canManageUsers) return;

    setActionLoading('saveAccount');
    try {
      const body: AdminUpdateUserBody = {
        displayName: account.displayName.trim(),
        phone: account.phone.trim() || null,
        phoneCode: account.phoneCode.trim() || null,
        nationality: account.nationality.trim() || null,
        dateOfBirth: account.dateOfBirth.trim() || null,
        primaryRole: account.primaryRole,
        isAdmin: account.isAdmin,
        adminPermissions: account.isAdmin ? account.adminPermissions : [],
      };
      if (canManagePlans) body.planId = account.planId || null;

      await adminApiClient.updateUser(accessToken, user.id, body, opts(refreshSession));
      await loadOverview();
      onSuccess();
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveRoleProfile = async () => {
    if (!user || !canManageUsers) return;

    setActionLoading('saveRoleProfile');
    try {
      setRoleProfileError(null);
      if (account.primaryRole === 'expert') {
        const body = JSON.parse(expertJson) as Record<string, unknown>;
        await adminApiClient.updateExpertProfile(accessToken, user.id, body, opts(refreshSession));
      } else if (account.primaryRole === 'craftsman') {
        const body = JSON.parse(craftsmanJson) as Record<string, unknown>;
        await adminApiClient.updateCraftsmanProfile(
          accessToken,
          user.id,
          body,
          opts(refreshSession),
        );
      } else if (account.primaryRole === 'business') {
        const body = JSON.parse(businessJson) as Record<string, unknown>;
        await adminApiClient.updateBusinessProfile(accessToken, user.id, body, opts(refreshSession));
      }
      await loadOverview();
      onSuccess();
    } catch {
      setRoleProfileError(u360?.errors?.invalidJson ?? 'Invalid profile JSON.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleForceLogout = async () => {
    if (!user || !canManageUsers) return;
    setActionLoading('forceLogout');
    try {
      await adminApiClient.forceLogoutUser(accessToken, user.id, opts(refreshSession));
    } finally {
      setActionLoading(null);
    }
  };

  const handleChangeEmail = async () => {
    if (!user || !canManageUsers || !changeEmail.newEmail.trim()) return;

    setActionLoading('changeEmail');
    try {
      const body: AdminChangeUserEmailBody = {
        newEmail: changeEmail.newEmail.trim(),
        sendVerificationEmail: changeEmail.sendVerificationEmail,
      };
      await adminApiClient.changeUserEmail(accessToken, user.id, body, opts(refreshSession));
      setChangeEmail((prev) => ({ ...prev, newEmail: '' }));
      await loadOverview();
      onSuccess();
    } finally {
      setActionLoading(null);
    }
  };

  const handleWalletFreezeToggle = async () => {
    if (!user || !canManageTransactions) return;

    setActionLoading('freeze');
    try {
      if (user.walletFrozen) {
        await adminApiClient.unfreezeUserWallet(accessToken, user.id, opts(refreshSession));
      } else {
        await adminApiClient.freezeUserWallet(accessToken, user.id, opts(refreshSession));
      }
      await loadOverview();
      onSuccess();
    } finally {
      setActionLoading(null);
    }
  };

  const handleAdjustBalance = async () => {
    if (!user || !canManageTransactions || adjustForm.amount <= 0) return;

    setActionLoading('adjust');
    try {
      const body: {
        userId: string;
        type: 'deposit' | 'withdrawal' | 'adjustment' | 'bonus';
        amount: number;
        description?: string;
      } = {
        userId: user.id,
        type: adjustForm.type,
        amount: adjustForm.amount,
      };
      if (adjustForm.description.trim()) body.description = adjustForm.description.trim();
      await adminApiClient.adjustBalance(accessToken, body, opts(refreshSession));
      setAdjustForm({ type: 'deposit', amount: 0, description: '' });
      setShowAdjust(false);
      await loadOverview();
      onSuccess();
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendVerification = async () => {
    if (!user || !canManageUsers) return;
    setActionLoading('sendVerification');
    try {
      await adminApiClient.sendVerificationEmail(accessToken, user.id, opts(refreshSession));
      await loadOverview();
    } finally {
      setActionLoading(null);
    }
  };

  const handleVerifyEmail = async () => {
    if (!user || !canManageUsers) return;
    setActionLoading('verifyEmail');
    try {
      await adminApiClient.verifyEmail(accessToken, user.id, opts(refreshSession));
      await loadOverview();
    } finally {
      setActionLoading(null);
    }
  };

  const handleActivateDeactivate = async () => {
    if (!user || !canManageUsers) return;

    setActionLoading('activate');
    try {
      if (user.isActive) {
        await adminApiClient.deactivateUser(accessToken, user.id, opts(refreshSession));
      } else {
        await adminApiClient.activateUser(accessToken, user.id, opts(refreshSession));
      }
      await loadOverview();
      onSuccess();
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!user || !canManageUsers || !confirm(d.confirmDelete)) return;

    setActionLoading('delete');
    try {
      await adminApiClient.deleteUser(accessToken, user.id, opts(refreshSession));
      onSuccess();
      onClose();
    } finally {
      setActionLoading(null);
    }
  };

  const reviewIdentity = async (docId: string, decision: 'approved' | 'rejected') => {
    if (!canManageVerifications) return;
    const notes = decision === 'rejected' ? window.prompt('Rejection reason')?.trim() : undefined;
    if (decision === 'rejected' && !notes) return;

    setActionLoading(`identity-${docId}`);
    try {
      await adminApiClient.reviewIdentityDocument(
        accessToken,
        docId,
        { decision, ...(notes ? { notes } : {}) },
        opts(refreshSession),
      );
      await loadOverview();
      onSuccess();
    } finally {
      setActionLoading(null);
    }
  };

  const reviewAcademic = async (recordId: string, decision: 'approved' | 'rejected') => {
    if (!canManageVerifications) return;
    const notes = decision === 'rejected' ? window.prompt('Rejection reason')?.trim() : undefined;
    if (decision === 'rejected' && !notes) return;

    setActionLoading(`academic-${recordId}`);
    try {
      await adminApiClient.reviewAcademicRecord(
        accessToken,
        recordId,
        { decision, ...(notes ? { notes } : {}) },
        opts(refreshSession),
      );
      await loadOverview();
      onSuccess();
    } finally {
      setActionLoading(null);
    }
  };

  const reviewBusiness = async (decision: 'approved' | 'rejected') => {
    if (!user || !canManageVerifications) return;
    const notes = decision === 'rejected' ? window.prompt('Rejection reason')?.trim() : undefined;
    if (decision === 'rejected' && !notes) return;

    setActionLoading('business-review');
    try {
      await adminApiClient.reviewBusinessDocs(
        accessToken,
        user.id,
        { decision, ...(notes ? { notes } : {}) },
        opts(refreshSession),
      );
      await loadOverview();
      onSuccess();
    } finally {
      setActionLoading(null);
    }
  };

  const userInitials = useMemo(() => {
    if (!user) return 'U';
    const parts = user.displayName.split(' ').filter(Boolean);
    if (parts.length === 0) return 'U';
    return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
  }, [user]);

  if (!userId) return null;
  const currentOverview = overview as AdminUserOverview;

  return (
    <>
      {previewImage && (
        <ImagePreviewModal
          imageUrl={previewImage.url}
          title={previewImage.title}
          onClose={() => setPreviewImage(null)}
          accessToken={accessToken}
        />
      )}
      <div className="admin-modal-overlay" onClick={onClose} role="presentation">
        <div
          className="admin-modal admin-modal--profile admin-user360"
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
                    <span className={`admin-badge ${user.isActive ? 'admin-badge--active' : 'admin-badge--inactive'}`}>
                      {user.isActive ? d.active : d.inactive}
                    </span>
                    <span className="admin-badge">{ud.emailVerified}: {user.emailVerifiedAt ? ud.yes : ud.no}</span>
                    <span className="admin-badge">{u360?.labels?.walletFrozen ?? 'Wallet Frozen'}: {user.walletFrozen ? ud.yes : ud.no}</span>
                  </div>
                </div>
              </div>
              <button type="button" className="admin-btn admin-btn--small" onClick={onClose}>
                {dictionary.common.back}
              </button>
            </header>

            <div className="admin-user360-tabs">
              {[
                { id: 'overview' as const, label: u360?.tabs?.overview ?? 'Overview' },
                { id: 'account' as const, label: u360?.tabs?.account ?? 'Account' },
                { id: 'roleProfile' as const, label: u360?.tabs?.roleProfile ?? 'Role Profile' },
                { id: 'verification' as const, label: u360?.tabs?.verification ?? 'Verification' },
                { id: 'activity' as const, label: u360?.tabs?.activity ?? 'Activity' },
                { id: 'security' as const, label: u360?.tabs?.security ?? 'Security' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`admin-user360-tab ${activeTab === tab.id ? 'admin-user360-tab--active' : ''}`}
                  onClick={() => {
                    setActiveTab(tab.id);
                    if (tab.id === 'activity') setActivityPage(1);
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="admin-user360-content">
              {activeTab === 'overview' && (
                <div className="admin-user360-grid">
                  <section className="admin-user-card admin-user360-span-2">
                    <h3 className="admin-user-card-title">{ud.basicInfo}</h3>
                    <div className="admin-user-field-grid">
                      <div className="admin-user-field"><span className="admin-user-field-label">{ud.phone}</span><span className="admin-user-field-value">{user.phone ?? '-'}</span></div>
                      <div className="admin-user-field"><span className="admin-user-field-label">{u360?.labels?.phoneCode ?? 'Phone code'}</span><span className="admin-user-field-value">{user.phoneCode ?? '-'}</span></div>
                      <div className="admin-user-field"><span className="admin-user-field-label">{ud.nationality}</span><span className="admin-user-field-value">{user.nationality ?? '-'}</span></div>
                      <div className="admin-user-field"><span className="admin-user-field-label">{ud.dateOfBirth}</span><span className="admin-user-field-value">{formatDate(user.dateOfBirth)}</span></div>
                      <div className="admin-user-field"><span className="admin-user-field-label">{ud.lastLogin}</span><span className="admin-user-field-value">{formatDateTime(user.lastLoginAt)}</span></div>
                      <div className="admin-user-field"><span className="admin-user-field-label">{ud.createdAt}</span><span className="admin-user-field-value">{formatDate(user.createdAt)}</span></div>
                      <div className="admin-user-field"><span className="admin-user-field-label">{d.plan}</span><span className="admin-user-field-value">{user.planName ?? '-'}</span></div>
            <div className="admin-user-field"><span className="admin-user-field-label">{ud.wallet}</span><span className="admin-user-field-value">{user.walletBalance != null ? `${user.walletBalance.toFixed(2)} ${user.walletCurrency ?? 'USD'}` : '-'}</span></div>
                    </div>
                  </section>

                  <section className="admin-user-card admin-user360-span-2">
                    <h3 className="admin-user-card-title">{u360?.labels?.activityCounts ?? 'Activity Counts'}</h3>
                    <div className="admin-user360-counters">
                      <div className="admin-user360-counter"><span>Needs</span><strong>{currentOverview.activityCounts.needs}</strong></div>
                      <div className="admin-user360-counter"><span>Bids</span><strong>{currentOverview.activityCounts.bids}</strong></div>
                      <div className="admin-user360-counter"><span>Jobs</span><strong>{currentOverview.activityCounts.jobs}</strong></div>
                      <div className="admin-user360-counter"><span>Applications</span><strong>{currentOverview.activityCounts.jobApplications}</strong></div>
                      <div className="admin-user360-counter"><span>Bookings</span><strong>{currentOverview.activityCounts.bookings}</strong></div>
                      {canManageTransactions && <div className="admin-user360-counter"><span>Transactions</span><strong>{currentOverview.activityCounts.transactions}</strong></div>}
                    </div>
                  </section>
                </div>
              )}

              {activeTab === 'account' && (
                <section className="admin-user-card">
                  <h3 className="admin-user-card-title">{u360?.account?.title ?? 'Account Controls'}</h3>
                  <div className="admin-user360-form-grid">
                    <label className="admin-form-group"><span className="admin-form-label">{ud.displayName}</span><input className="admin-form-input" value={account.displayName} onChange={(e) => setAccount((prev) => ({ ...prev, displayName: e.target.value }))} /></label>
                    <label className="admin-form-group"><span className="admin-form-label">{ud.phone}</span><input className="admin-form-input" value={account.phone} onChange={(e) => setAccount((prev) => ({ ...prev, phone: e.target.value }))} /></label>
                    <label className="admin-form-group"><span className="admin-form-label">{u360?.labels?.phoneCode ?? 'Phone code'}</span><input className="admin-form-input" value={account.phoneCode} onChange={(e) => setAccount((prev) => ({ ...prev, phoneCode: e.target.value }))} /></label>
                    <label className="admin-form-group"><span className="admin-form-label">{ud.nationality}</span><input className="admin-form-input" value={account.nationality} onChange={(e) => setAccount((prev) => ({ ...prev, nationality: e.target.value }))} /></label>
                    <label className="admin-form-group"><span className="admin-form-label">{ud.dateOfBirth}</span><input type="date" className="admin-form-input" value={account.dateOfBirth} onChange={(e) => setAccount((prev) => ({ ...prev, dateOfBirth: e.target.value }))} /></label>
                    <label className="admin-form-group"><span className="admin-form-label">{d.role}</span><select className="admin-form-select" value={account.primaryRole} onChange={(e) => setAccount((prev) => ({ ...prev, primaryRole: e.target.value as AccountForm['primaryRole'] }))}><option value="customer">Customer</option><option value="expert">Expert</option><option value="craftsman">Craftsman</option><option value="business">Business</option></select></label>
                    <label className="admin-form-group"><span className="admin-form-label">{ud.adminFlag}</span><select className="admin-form-select" value={account.isAdmin ? 'yes' : 'no'} onChange={(e) => setAccount((prev) => ({ ...prev, isAdmin: e.target.value === 'yes' }))}><option value="no">{ud.no}</option><option value="yes">{ud.yes}</option></select></label>
                    {canManagePlans && <label className="admin-form-group"><span className="admin-form-label">{d.plan}</span><select className="admin-form-select" value={account.planId} onChange={(e) => setAccount((prev) => ({ ...prev, planId: e.target.value }))}><option value="">- None -</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>}
                  </div>

                  {account.isAdmin && (
                    <div className="admin-user360-permissions">
                      <p className="admin-form-label">{u360?.labels?.permissions ?? 'Permissions'}</p>
                      <div className="admin-user360-permissions-grid">
                        {availablePermissions.map((permission) => (
                          <label key={permission.id} className="admin-inline-checkbox">
                            <input type="checkbox" checked={account.adminPermissions.includes(permission.id)} onChange={(e) => setAccount((prev) => ({ ...prev, adminPermissions: e.target.checked ? [...prev.adminPermissions, permission.id] : prev.adminPermissions.filter((id) => id !== permission.id) }))} />
                            {permission.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="admin-modal-actions">
                    <button type="button" className="admin-btn admin-btn--primary" disabled={!canManageUsers || actionLoading === 'saveAccount'} onClick={() => void handleSaveAccount()}>{dictionary.common.save}</button>
                  </div>
                </section>
              )}

              {activeTab === 'roleProfile' && (
                <section className="admin-user-card">
                  <h3 className="admin-user-card-title">{u360?.roleProfile?.title ?? 'Role Profile'}</h3>
                  {account.primaryRole === 'customer' ? (
                    <p className="admin-empty">{u360?.roleProfile?.customerOnly ?? 'Customer account has no role profile.'}</p>
                  ) : (
                    <>
                      <p className="admin-user360-note">{u360?.roleProfile?.jsonHint ?? 'Edit all profile fields as JSON.'}</p>
                      <textarea className="admin-user360-json" value={account.primaryRole === 'expert' ? expertJson : account.primaryRole === 'craftsman' ? craftsmanJson : businessJson} onChange={(e) => (account.primaryRole === 'expert' ? setExpertJson(e.target.value) : account.primaryRole === 'craftsman' ? setCraftsmanJson(e.target.value) : setBusinessJson(e.target.value))} />
                      {roleProfileError && <p className="admin-error-banner">{roleProfileError}</p>}
                      <div className="admin-modal-actions">
                        <button type="button" className="admin-btn admin-btn--primary" disabled={!canManageUsers || actionLoading === 'saveRoleProfile'} onClick={() => void handleSaveRoleProfile()}>{dictionary.common.save}</button>
                      </div>
                    </>
                  )}
                </section>
              )}

              {activeTab === 'verification' && (
                <div className="admin-user360-grid">
                  {currentOverview.expertProfile && (
                    <section className="admin-user-card admin-user360-span-2">
                      <h3 className="admin-user-card-title">Expert verification</h3>
                      <p className="admin-user360-item-meta">
                        Status: <span className="admin-badge">{currentOverview.expertProfile.verificationStatus}</span>
                        {currentOverview.expertProfile.identityVerificationMethod != null && (
                          <> · Identity: {currentOverview.expertProfile.identityVerificationMethod === 'didit' ? 'Didit (KYC)' : 'Manual review'}</>
                        )}
                      </p>
                      <p className="admin-user360-item-meta" style={{ fontSize: '0.85rem', color: 'var(--text-soft)' }}>
                        {currentOverview.expertProfile.verificationStatus === 'under_review' && 'Under review = identity and/or academic submitted, awaiting admin approval.'}
                        {currentOverview.expertProfile.verificationStatus === 'verified' && 'Fully verified (identity + academic approved).'}
                      </p>
                    </section>
                  )}
                  {currentOverview.craftsmanProfile && (
                    <section className="admin-user-card admin-user360-span-2">
                      <h3 className="admin-user-card-title">Craftsman verification</h3>
                      <p className="admin-user360-item-meta">
                        Status: <span className="admin-badge">{currentOverview.craftsmanProfile.verificationStatus}</span>
                        {currentOverview.craftsmanProfile.identityVerificationMethod != null && (
                          <> · Identity: {currentOverview.craftsmanProfile.identityVerificationMethod === 'didit' ? 'Didit (KYC)' : 'Manual review'}</>
                        )}
                      </p>
                      <p className="admin-user360-item-meta" style={{ fontSize: '0.85rem', color: 'var(--text-soft)' }}>
                        {currentOverview.craftsmanProfile.verificationStatus === 'under_review' && 'Under review = identity submitted and awaiting admin approval.'}
                        {currentOverview.craftsmanProfile.verificationStatus === 'verified' && 'Identity verification approved.'}
                      </p>
                    </section>
                  )}
                  <section className="admin-user-card admin-user360-span-2">
                    <h3 className="admin-user-card-title">{u360?.verification?.identityTitle ?? 'Identity Documents'}</h3>
                    {currentOverview.identityDocuments.length === 0 ? <p className="admin-empty">{u360?.verification?.empty ?? 'No documents.'}</p> : (
                      <div className="admin-user360-list">
                        {currentOverview.identityDocuments.map((doc) => (
                          <article key={doc.id} className="admin-user360-item">
                            <div className="admin-user360-item-head"><strong>{doc.fullNameOnDoc}</strong><span className="admin-badge">{doc.status}</span></div>
                            <p className="admin-user360-item-meta">{doc.documentType} | {doc.documentNumber ?? '-'}</p>
                            <div className="admin-user360-links">
                              {doc.frontImageUrl && (
                                <button type="button" className="admin-link-btn" onClick={() => setPreviewImage({ url: doc.frontImageUrl!, title: 'Document front' })}>Front</button>
                              )}
                              {doc.backImageUrl && (
                                <button type="button" className="admin-link-btn" onClick={() => setPreviewImage({ url: doc.backImageUrl!, title: 'Document back' })}>Back</button>
                              )}
                              {doc.selfieImageUrl && (
                                <button type="button" className="admin-link-btn" onClick={() => setPreviewImage({ url: doc.selfieImageUrl!, title: 'Selfie' })}>Selfie</button>
                              )}
                            </div>
                            {canManageVerifications && (doc.status === 'pending' || doc.status === 'under_review') && <div className="admin-actions-row"><button type="button" className="admin-btn admin-btn--small admin-btn--success" disabled={actionLoading === `identity-${doc.id}`} onClick={() => void reviewIdentity(doc.id, 'approved')}>{dictionary.admin.approve}</button><button type="button" className="admin-btn admin-btn--small admin-btn--danger" disabled={actionLoading === `identity-${doc.id}`} onClick={() => void reviewIdentity(doc.id, 'rejected')}>{dictionary.admin.reject}</button></div>}
                          </article>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="admin-user-card admin-user360-span-2">
                    <h3 className="admin-user-card-title">{u360?.verification?.academicTitle ?? 'Academic Records'}</h3>
                    {currentOverview.academicRecords.length === 0 ? <p className="admin-empty">{u360?.verification?.empty ?? 'No records.'}</p> : (
                      <div className="admin-user360-list">
                        {currentOverview.academicRecords.map((record) => (
                          <article key={record.id} className="admin-user360-item">
                            <div className="admin-user360-item-head"><strong>{record.title}</strong><span className="admin-badge">{record.status}</span></div>
                            <p className="admin-user360-item-meta">{record.recordType} | {record.institution}</p>
                            <div className="admin-user360-links">
                              {record.certificateImageUrl && (
                                <button type="button" className="admin-link-btn" onClick={() => setPreviewImage({ url: record.certificateImageUrl!, title: 'Certificate' })}>Certificate</button>
                              )}
                              {record.transcriptImageUrl && (
                                <button type="button" className="admin-link-btn" onClick={() => setPreviewImage({ url: record.transcriptImageUrl!, title: 'Transcript' })}>Transcript</button>
                              )}
                            </div>
                            {canManageVerifications && (record.status === 'pending' || record.status === 'under_review') && <div className="admin-actions-row"><button type="button" className="admin-btn admin-btn--small admin-btn--success" disabled={actionLoading === `academic-${record.id}`} onClick={() => void reviewAcademic(record.id, 'approved')}>{dictionary.admin.approve}</button><button type="button" className="admin-btn admin-btn--small admin-btn--danger" disabled={actionLoading === `academic-${record.id}`} onClick={() => void reviewAcademic(record.id, 'rejected')}>{dictionary.admin.reject}</button></div>}
                          </article>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="admin-user-card admin-user360-span-2">
                    <h3 className="admin-user-card-title">{u360?.verification?.businessTitle ?? 'Business Verification'}</h3>
                    {!currentOverview.businessProfile ? <p className="admin-empty">{u360?.verification?.businessMissing ?? 'No business profile.'}</p> : (
                      <>
                        <p className="admin-user360-item-meta">{u360?.verification?.status ?? 'Status'}: {currentOverview.businessProfile.verificationStatus}</p>
                        {canManageVerifications && <div className="admin-actions-row"><button type="button" className="admin-btn admin-btn--small admin-btn--success" disabled={actionLoading === 'business-review'} onClick={() => void reviewBusiness('approved')}>{dictionary.admin.approve}</button><button type="button" className="admin-btn admin-btn--small admin-btn--danger" disabled={actionLoading === 'business-review'} onClick={() => void reviewBusiness('rejected')}>{dictionary.admin.reject}</button></div>}
                      </>
                    )}
                  </section>
                </div>
              )}

              {activeTab === 'activity' && (
                <section className="admin-user-card">
                  <h3 className="admin-user-card-title">{u360?.activity?.title ?? 'Activity'}</h3>
                  <div className="admin-user360-activity-types">
                    {activityTypes.map((type) => (
                      <button key={type} type="button" className={`admin-btn admin-btn--small ${activityType === type ? 'admin-btn--primary' : ''}`} onClick={() => { setActivityType(type); setActivityPage(1); }}>
                        {u360?.activity?.types?.[type] ?? type}
                      </button>
                    ))}
                  </div>

                  {activityLoading ? <p className="admin-empty">{dictionary.admin.loading}</p> : !activityData || activityData.items.length === 0 ? <p className="admin-empty">{u360?.activity?.empty ?? 'No activity.'}</p> : (
                    <div className="admin-table-wrapper">
                      <table className="admin-table">
                        <thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Amount</th><th>Created</th></tr></thead>
                        <tbody>
                          {activityData.items.map((item) => (
                            <tr key={String(item.id)}>
                              <td>{formatPrimitive(item.id)}</td>
                              <td>{formatPrimitive(item.title ?? item.needTitle ?? item.jobTitle ?? item.serviceTitle ?? item.type)}</td>
                              <td>{formatPrimitive(item.status)}</td>
                              <td>{item.amount != null ? `${Number(item.amount).toFixed(2)} ${formatPrimitive(item.currency, '')}` : '-'}</td>
                              <td>{formatDateTime((item.createdAt as string | null) ?? null)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {activityData && activityData.totalPages > 1 && (
                    <div className="admin-pagination">
                      <button type="button" className="admin-btn admin-btn--small" disabled={activityPage <= 1} onClick={() => setActivityPage((prev) => prev - 1)}>{'<-'}</button>
                      <span className="admin-pagination-info">{activityData.page} / {activityData.totalPages}</span>
                      <button type="button" className="admin-btn admin-btn--small" disabled={activityPage >= activityData.totalPages} onClick={() => setActivityPage((prev) => prev + 1)}>{'->'}</button>
                    </div>
                  )}
                </section>
              )}

              {activeTab === 'security' && (
                <section className="admin-user-card">
                  <h3 className="admin-user-card-title">{u360?.security?.title ?? 'Security Actions'}</h3>
                  <div className="admin-user360-security-block"><p className="admin-user-field-label">{u360?.security?.forceLogout ?? 'Force logout all sessions'}</p><button type="button" className="admin-btn admin-btn--small" disabled={!canManageUsers || actionLoading === 'forceLogout'} onClick={() => void handleForceLogout()}>{u360?.security?.forceLogoutBtn ?? 'Force Logout'}</button></div>
                  <div className="admin-user360-security-block"><p className="admin-user-field-label">{u360?.security?.changeEmail ?? 'Change email'}</p><div className="admin-inline-edit"><input type="email" className="admin-form-input" value={changeEmail.newEmail} onChange={(e) => setChangeEmail((prev) => ({ ...prev, newEmail: e.target.value }))} placeholder={u360?.security?.newEmailPlaceholder ?? 'new@email.com'} /><label className="admin-inline-checkbox"><input type="checkbox" checked={changeEmail.sendVerificationEmail} onChange={(e) => setChangeEmail((prev) => ({ ...prev, sendVerificationEmail: e.target.checked }))} />{u360?.security?.sendVerification ?? 'Send verification'}</label><button type="button" className="admin-btn admin-btn--small admin-btn--primary" disabled={!canManageUsers || actionLoading === 'changeEmail'} onClick={() => void handleChangeEmail()}>{u360?.security?.changeEmailBtn ?? 'Update Email'}</button></div></div>
                  {!user.emailVerifiedAt && <div className="admin-user360-security-block"><p className="admin-user-field-label">{u360?.security?.emailVerification ?? 'Email verification controls'}</p><div className="admin-actions-row"><button type="button" className="admin-btn admin-btn--small" disabled={!canManageUsers || actionLoading === 'sendVerification'} onClick={() => void handleSendVerification()}>{ud.sendVerificationEmail}</button><button type="button" className="admin-btn admin-btn--small admin-btn--success" disabled={!canManageUsers || actionLoading === 'verifyEmail'} onClick={() => void handleVerifyEmail()}>{ud.verifyEmail}</button></div></div>}
                  {canManageTransactions && <div className="admin-user360-security-block"><p className="admin-user-field-label">{u360?.security?.walletFreeze ?? 'Wallet freeze / unfreeze'}</p><button type="button" className={`admin-btn admin-btn--small ${user.walletFrozen ? 'admin-btn--success' : 'admin-btn--danger'}`} disabled={actionLoading === 'freeze'} onClick={() => void handleWalletFreezeToggle()}>{user.walletFrozen ? (u360?.security?.unfreezeBtn ?? 'Unfreeze Wallet') : (u360?.security?.freezeBtn ?? 'Freeze Wallet')}</button></div>}
                  {canManageTransactions && <div className="admin-user360-security-block"><p className="admin-user-field-label">{ud.adjustBalance}</p>{showAdjust ? <div className="admin-user-wallet-form"><select className="admin-form-select" value={adjustForm.type} onChange={(e) => setAdjustForm((prev) => ({ ...prev, type: e.target.value as AdjustForm['type'] }))}><option value="deposit">Deposit</option><option value="withdrawal">Withdrawal</option><option value="adjustment">Adjustment</option><option value="bonus">Bonus</option></select><input type="number" className="admin-form-input" value={adjustForm.amount || ''} onChange={(e) => setAdjustForm((prev) => ({ ...prev, amount: Number(e.target.value) || 0 }))} /><input className="admin-form-input" value={adjustForm.description} onChange={(e) => setAdjustForm((prev) => ({ ...prev, description: e.target.value }))} /><div className="admin-inline-edit"><button type="button" className="admin-btn admin-btn--small admin-btn--primary" disabled={actionLoading === 'adjust' || adjustForm.amount <= 0} onClick={() => void handleAdjustBalance()}>{dictionary.common.save}</button><button type="button" className="admin-btn admin-btn--small" onClick={() => setShowAdjust(false)}>{dictionary.common.back}</button></div></div> : <button type="button" className="admin-btn admin-btn--small" onClick={() => setShowAdjust(true)}>{ud.adjustBalance}</button>}</div>}
                  <div className="admin-user360-security-block"><p className="admin-user-field-label">{u360?.security?.accountStatus ?? 'Account status controls'}</p><div className="admin-actions-row"><button type="button" className={`admin-btn admin-btn--small ${user.isActive ? '' : 'admin-btn--success'}`} disabled={!canManageUsers || actionLoading === 'activate'} onClick={() => void handleActivateDeactivate()}>{user.isActive ? d.deactivate : d.activate}</button><button type="button" className="admin-btn admin-btn--small admin-btn--danger" disabled={!canManageUsers || actionLoading === 'delete'} onClick={() => void handleDelete()}>{d.delete}</button></div></div>
                </section>
              )}
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
    </>
  );
};
