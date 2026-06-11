'use client';

import type { PendingVerificationItem } from '@mohandishub/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useToast } from '@/components/app/toast';
import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { SkeletonCard } from '@/components/ui/skeleton';
import { adminApiClient } from '@/lib/admin/client';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

import './admin-verification-screen.css';

type AdminVerificationScreenProps = {
  locale: Locale;
  dictionary: Dictionary;
};

type RoleTabId = 'customer' | 'expert' | 'business' | 'craftsman';
type CategoryTabId = 'identity' | 'academic' | 'business';

export const AdminVerificationScreen = ({ locale, dictionary }: AdminVerificationScreenProps) => {
  const router = useRouter();
  const { addToast } = useToast();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();
  const [activeRoleTab, setActiveRoleTab] = useState<RoleTabId>('expert');
  const [activeCategoryTab, setActiveCategoryTab] = useState<CategoryTabId>('identity');
  const [items, setItems] = useState<PendingVerificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loadPending = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const data = await adminApiClient.getPendingVerifications(accessToken);
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!isReady || !isAuthenticated || !authUser) {
      router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
      return;
    }
    if (!authGuard.emailVerified) {
      router.replace(buildLocalePath(locale, '/verify-email'));
      return;
    }
    if (!authUser.isAdmin) {
      router.replace(buildLocalePath(locale, '/app'));
      return;
    }
    void loadPending();
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router, loadPending]);

  const handleReviewIdentity = async (docId: string, decision: 'approved' | 'rejected') => {
    if (!accessToken) return;
    let notes: string | undefined;
    if (decision === 'rejected') {
      const reason = window.prompt(
        'Rejection reason (required for identity — user receives this and account is deleted):',
      );
      if (reason === null) return;
      notes = reason.trim() || undefined;
    }
    setReviewing(docId);
    try {
      await adminApiClient.reviewIdentityDocument(accessToken, docId, {
        decision,
        ...(notes !== undefined && notes !== '' && { notes }),
      });
      await loadPending();
    } finally {
      setReviewing(null);
    }
  };

  const handleReviewAcademic = async (recordId: string, decision: 'approved' | 'rejected') => {
    if (!accessToken) return;
    setReviewing(recordId);
    try {
      await adminApiClient.reviewAcademicRecord(accessToken, recordId, { decision });
      await loadPending();
    } finally {
      setReviewing(null);
    }
  };

  const handleReviewBusiness = async (userId: string, decision: 'approved' | 'rejected') => {
    if (!accessToken) return;
    setReviewing(userId);
    try {
      await adminApiClient.reviewBusinessDocs(accessToken, userId, { decision });
      await loadPending();
    } finally {
      setReviewing(null);
    }
  };

  const handleSyncVerifiedAt = async () => {
    if (!accessToken) return;
    setSyncing(true);
    try {
      const result = await adminApiClient.syncVerifiedAt(accessToken);
      if (result.experts > 0 || result.businesses > 0) {
        addToast(
          'Success',
          `Synced: ${result.experts} expert(s), ${result.businesses} business(es).`,
        );
      } else {
        addToast('Info', 'No profiles needed syncing.');
      }
    } catch {
      addToast('Error', 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const identityDocs = items.flatMap((i) =>
    i.identityDocuments
      .filter((d) => d.status === 'pending' || d.status === 'under_review')
      .map((d) => ({
        ...d,
        userId: i.userId,
        displayName: i.displayName,
        email: i.email,
        role: i.role,
      })),
  );
  const academicRecs = items.flatMap((i) =>
    i.academicRecords
      .filter((r) => r.status === 'pending' || r.status === 'under_review')
      .map((r) => ({
        ...r,
        userId: i.userId,
        displayName: i.displayName,
        email: i.email,
        role: i.role,
      })),
  );
  const businessUsers = items.filter(
    (i) =>
      i.businessProfile &&
      !i.businessProfile.businessVerified &&
      (i.businessProfile.verificationStatus === 'pending' ||
        i.businessProfile.verificationStatus === 'under_review'),
  );

  const roleLabel: Record<RoleTabId, string> = {
    customer: dictionary.profileModal?.roleCustomer ?? 'Customer',
    expert: dictionary.profileModal?.roleExpert ?? 'Expert',
    business: dictionary.profileModal?.roleBusiness ?? 'Business',
    craftsman: dictionary.profileModal?.roleCraftsman ?? 'Craftsman',
  };

  const identityCount = identityDocs.reduce<Record<RoleTabId, number>>(
    (acc, doc) => {
      const role = doc.role as RoleTabId;
      if (role === 'customer' || role === 'expert' || role === 'business' || role === 'craftsman') {
        acc[role] += 1;
      }
      return acc;
    },
    { customer: 0, expert: 0, business: 0, craftsman: 0 },
  );
  const academicCount = academicRecs.reduce<Record<RoleTabId, number>>(
    (acc, rec) => {
      const role = rec.role as RoleTabId;
      if (role === 'customer' || role === 'expert' || role === 'business' || role === 'craftsman') {
        acc[role] += 1;
      }
      return acc;
    },
    { customer: 0, expert: 0, business: 0, craftsman: 0 },
  );
  const businessCount = businessUsers.reduce<Record<RoleTabId, number>>(
    (acc, u) => {
      const role = u.role as RoleTabId;
      if (role === 'customer' || role === 'expert' || role === 'business' || role === 'craftsman') {
        acc[role] += 1;
      }
      return acc;
    },
    { customer: 0, expert: 0, business: 0, craftsman: 0 },
  );

  const categoryCountForActiveRole: Record<CategoryTabId, number> = {
    identity: identityCount[activeRoleTab],
    academic: academicCount[activeRoleTab],
    business: businessCount[activeRoleTab],
  };

  const totalCountForRole: Record<RoleTabId, number> = {
    customer: identityCount.customer + academicCount.customer + businessCount.customer,
    expert: identityCount.expert + academicCount.expert + businessCount.expert,
    business: identityCount.business + academicCount.business + businessCount.business,
    craftsman: identityCount.craftsman + academicCount.craftsman + businessCount.craftsman,
  };

  useEffect(() => {
    setActiveCategoryTab((prev) =>
      activeRoleTab === 'business' ? 'business' : prev === 'business' ? 'identity' : prev,
    );
  }, [activeRoleTab]);

  const filteredIdentityDocs = identityDocs.filter((doc) => doc.role === activeRoleTab);
  const filteredAcademicRecs = academicRecs.filter((rec) => rec.role === activeRoleTab);
  const filteredBusinessUsers = businessUsers.filter((u) => u.role === activeRoleTab);

  if (!isReady || !authUser) {
    return (
      <main className="admin-verification-main">
        <Container className="admin-verification-container">
          <div className="admin-verification-skeleton">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </Container>
      </main>
    );
  }

  return (
    <main className="admin-verification-main">
      <Container className="admin-verification-container">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <h1 className="admin-verification-title">{dictionary.admin.title}</h1>
          <button
            type="button"
            className="admin-verification-btn admin-verification-btn-approve"
            disabled={syncing}
            onClick={() => void handleSyncVerifiedAt()}
          >
            {syncing ? (dictionary.admin?.loading ?? 'Loading...') : 'Sync verified_at'}
          </button>
        </div>

        <div className="admin-verification-tabs" style={{ marginBottom: '0.75rem' }}>
          <button
            type="button"
            className={
              activeRoleTab === 'customer'
                ? 'admin-verification-tab admin-verification-tab-active'
                : 'admin-verification-tab'
            }
            onClick={() => setActiveRoleTab('customer')}
          >
            {roleLabel.customer} ({totalCountForRole.customer})
          </button>
          <button
            type="button"
            className={
              activeRoleTab === 'expert'
                ? 'admin-verification-tab admin-verification-tab-active'
                : 'admin-verification-tab'
            }
            onClick={() => setActiveRoleTab('expert')}
          >
            {roleLabel.expert} ({totalCountForRole.expert})
          </button>
          <button
            type="button"
            className={
              activeRoleTab === 'business'
                ? 'admin-verification-tab admin-verification-tab-active'
                : 'admin-verification-tab'
            }
            onClick={() => setActiveRoleTab('business')}
          >
            {roleLabel.business} ({totalCountForRole.business})
          </button>
          <button
            type="button"
            className={
              activeRoleTab === 'craftsman'
                ? 'admin-verification-tab admin-verification-tab-active'
                : 'admin-verification-tab'
            }
            onClick={() => setActiveRoleTab('craftsman')}
          >
            {roleLabel.craftsman} ({totalCountForRole.craftsman})
          </button>
        </div>

        <div className="admin-verification-tabs">
          <button
            type="button"
            className={
              activeCategoryTab === 'identity'
                ? 'admin-verification-tab admin-verification-tab-active'
                : 'admin-verification-tab'
            }
            onClick={() => setActiveCategoryTab('identity')}
          >
            {dictionary.admin.identity} ({categoryCountForActiveRole.identity})
          </button>
          <button
            type="button"
            className={
              activeCategoryTab === 'academic'
                ? 'admin-verification-tab admin-verification-tab-active'
                : 'admin-verification-tab'
            }
            onClick={() => setActiveCategoryTab('academic')}
          >
            {dictionary.admin.academic} ({categoryCountForActiveRole.academic})
          </button>
          <button
            type="button"
            className={
              activeCategoryTab === 'business'
                ? 'admin-verification-tab admin-verification-tab-active'
                : 'admin-verification-tab'
            }
            onClick={() => setActiveCategoryTab('business')}
          >
            {dictionary.admin.business} ({categoryCountForActiveRole.business})
          </button>
        </div>

        {loading && (
          <div className="admin-verification-skeleton">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {!loading && activeCategoryTab === 'identity' && (
          <section className="admin-verification-card">
            {filteredIdentityDocs.length === 0 ? (
              <p className="admin-verification-empty">{dictionary.admin.noPending}</p>
            ) : (
              <ul className="admin-verification-list">
                {filteredIdentityDocs.map((doc) => (
                  <li key={doc.id} className="admin-verification-item">
                    <div className="admin-verification-item-header">
                      <span className="admin-verification-item-name">{doc.fullNameOnDoc}</span>
                      <span className="admin-verification-item-meta">
                        {doc.documentType} | {doc.displayName} ({doc.email})
                      </span>
                    </div>
                    <div className="admin-verification-item-actions">
                      <button
                        type="button"
                        className="admin-verification-btn admin-verification-btn-approve"
                        disabled={reviewing === doc.id}
                        onClick={() => void handleReviewIdentity(doc.id, 'approved')}
                      >
                        {dictionary.admin.approve}
                      </button>
                      <button
                        type="button"
                        className="admin-verification-btn admin-verification-btn-reject"
                        disabled={reviewing === doc.id}
                        onClick={() => void handleReviewIdentity(doc.id, 'rejected')}
                      >
                        {dictionary.admin.reject}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {!loading && activeCategoryTab === 'academic' && (
          <section className="admin-verification-card">
            {filteredAcademicRecs.length === 0 ? (
              <p className="admin-verification-empty">{dictionary.admin.noPending}</p>
            ) : (
              <ul className="admin-verification-list">
                {filteredAcademicRecs.map((rec) => (
                  <li key={rec.id} className="admin-verification-item">
                    <div className="admin-verification-item-header">
                      <span className="admin-verification-item-name">{rec.title}</span>
                      <span className="admin-verification-item-meta">
                        {rec.institution} | {rec.displayName} ({rec.email})
                      </span>
                    </div>
                    <div className="admin-verification-item-actions">
                      <button
                        type="button"
                        className="admin-verification-btn admin-verification-btn-approve"
                        disabled={reviewing === rec.id}
                        onClick={() => void handleReviewAcademic(rec.id, 'approved')}
                      >
                        {dictionary.admin.approve}
                      </button>
                      <button
                        type="button"
                        className="admin-verification-btn admin-verification-btn-reject"
                        disabled={reviewing === rec.id}
                        onClick={() => void handleReviewAcademic(rec.id, 'rejected')}
                      >
                        {dictionary.admin.reject}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {!loading && activeCategoryTab === 'business' && (
          <section className="admin-verification-card">
            {filteredBusinessUsers.length === 0 ? (
              <p className="admin-verification-empty">{dictionary.admin.noPending}</p>
            ) : (
              <ul className="admin-verification-list">
                {filteredBusinessUsers.map((item) => (
                  <li key={item.userId} className="admin-verification-item">
                    <div className="admin-verification-item-header">
                      <span className="admin-verification-item-name">
                        {item.businessProfile!.companyName}
                      </span>
                      <span className="admin-verification-item-meta">
                        {item.displayName} ({item.email})
                      </span>
                    </div>
                    <div className="admin-verification-item-actions">
                      <button
                        type="button"
                        className="admin-verification-btn admin-verification-btn-approve"
                        disabled={reviewing === item.userId}
                        onClick={() => void handleReviewBusiness(item.userId, 'approved')}
                      >
                        {dictionary.admin.approve}
                      </button>
                      <button
                        type="button"
                        className="admin-verification-btn admin-verification-btn-reject"
                        disabled={reviewing === item.userId}
                        onClick={() => void handleReviewBusiness(item.userId, 'rejected')}
                      >
                        {dictionary.admin.reject}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </Container>
    </main>
  );
};
