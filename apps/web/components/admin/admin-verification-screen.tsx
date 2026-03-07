'use client';

import type { PendingVerificationItem } from '@mohandishub/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

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

type TabId = 'identity' | 'academic' | 'business';

export const AdminVerificationScreen = ({ locale, dictionary }: AdminVerificationScreenProps) => {
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('identity');
  const [items, setItems] = useState<PendingVerificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<string | null>(null);

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
    setReviewing(docId);
    try {
      await adminApiClient.reviewIdentityDocument(accessToken, docId, { decision });
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
      (i.businessProfile.verificationStatus === 'pending' ||
        i.businessProfile.verificationStatus === 'under_review'),
  );

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
        <h1 className="admin-verification-title">{dictionary.admin.title}</h1>

        <div className="admin-verification-tabs">
          <button
            type="button"
            className={
              activeTab === 'identity'
                ? 'admin-verification-tab admin-verification-tab-active'
                : 'admin-verification-tab'
            }
            onClick={() => setActiveTab('identity')}
          >
            {dictionary.admin.identity} ({identityDocs.length})
          </button>
          <button
            type="button"
            className={
              activeTab === 'academic'
                ? 'admin-verification-tab admin-verification-tab-active'
                : 'admin-verification-tab'
            }
            onClick={() => setActiveTab('academic')}
          >
            {dictionary.admin.academic} ({academicRecs.length})
          </button>
          <button
            type="button"
            className={
              activeTab === 'business'
                ? 'admin-verification-tab admin-verification-tab-active'
                : 'admin-verification-tab'
            }
            onClick={() => setActiveTab('business')}
          >
            {dictionary.admin.business} ({businessUsers.length})
          </button>
        </div>

        {loading && (
          <div className="admin-verification-skeleton">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {!loading && activeTab === 'identity' && (
          <section className="admin-verification-card">
            {identityDocs.length === 0 ? (
              <p className="admin-verification-empty">{dictionary.admin.noPending}</p>
            ) : (
              <ul className="admin-verification-list">
                {identityDocs.map((doc) => (
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

        {!loading && activeTab === 'academic' && (
          <section className="admin-verification-card">
            {academicRecs.length === 0 ? (
              <p className="admin-verification-empty">{dictionary.admin.noPending}</p>
            ) : (
              <ul className="admin-verification-list">
                {academicRecs.map((rec) => (
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

        {!loading && activeTab === 'business' && (
          <section className="admin-verification-card">
            {businessUsers.length === 0 ? (
              <p className="admin-verification-empty">{dictionary.admin.noPending}</p>
            ) : (
              <ul className="admin-verification-list">
                {businessUsers.map((item) => (
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
