'use client';

import type { PendingVerificationItem } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import { ImagePreviewModal } from '@/components/ui/image-preview-modal';
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
  return dictionary.auth.errors.generic;
};

export const AdminVerificationsTab = ({ dictionary, accessToken, refreshSession }: Props) => {
  const [items, setItems] = useState<PendingVerificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'identity' | 'academic' | 'business'>(
    'identity',
  );
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApiClient.getPendingVerifications(accessToken, { refreshSession });
      setItems(data);
    } catch (err: unknown) {
      setItems([]);
      setError(getErrorMessage(err, dictionary));
    } finally {
      setLoading(false);
    }
  }, [accessToken, dictionary, refreshSession]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReviewIdentity = async (docId: string, decision: 'approved' | 'rejected') => {
    let notes: string | undefined;
    if (decision === 'rejected') {
      const reason = window.prompt(
        'Rejection reason (required for identity — user receives this and account is deleted):',
      );
      if (reason === null) return;
      notes = reason.trim() || undefined;
    }
    setReviewing(docId);
    setError(null);
    try {
      await adminApiClient.reviewIdentityDocument(
        accessToken,
        docId,
        { decision, ...(notes !== undefined && notes !== '' && { notes }) },
        { refreshSession },
      );
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err, dictionary));
    } finally {
      setReviewing(null);
    }
  };

  const handleReviewAcademic = async (recordId: string, decision: 'approved' | 'rejected') => {
    let notes: string | undefined;
    if (decision === 'rejected') {
      const reason = window.prompt(
        'Rejection reason (sent to user by email):',
      );
      if (reason === null) return;
      notes = reason.trim() || undefined;
    }
    setReviewing(recordId);
    setError(null);
    try {
      await adminApiClient.reviewAcademicRecord(
        accessToken,
        recordId,
        { decision, ...(notes !== undefined && notes !== '' && { notes }) },
        { refreshSession },
      );
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err, dictionary));
    } finally {
      setReviewing(null);
    }
  };

  const handleReviewBusiness = async (userId: string, decision: 'approved' | 'rejected') => {
    setReviewing(userId);
    setError(null);
    try {
      await adminApiClient.reviewBusinessDocs(accessToken, userId, { decision }, { refreshSession });
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err, dictionary));
    } finally {
      setReviewing(null);
    }
  };

  const handleSyncVerifiedAt = async () => {
    setSyncing(true);
    setError(null);
    try {
      const result = await adminApiClient.syncVerifiedAt(accessToken, { refreshSession });
      if (result.experts > 0 || result.businesses > 0) {
        setError(null);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, dictionary));
    } finally {
      setSyncing(false);
    }
  };

  const identityDocs = items.flatMap((i) =>
    i.identityDocuments
      .filter((d) => d.status === 'pending' || d.status === 'under_review')
      .map((d) => ({ ...d, userDisplayName: i.displayName, userEmail: i.email, userRole: i.role })),
  );
  const academicRecs = items.flatMap((i) =>
    i.academicRecords
      .filter((r) => r.status === 'pending' || r.status === 'under_review')
      .map((r) => ({ ...r, userDisplayName: i.displayName, userEmail: i.email, userRole: i.role })),
  );
  const businessUsers = items.filter(
    (i) =>
      i.businessProfile &&
      (i.businessProfile.verificationStatus === 'pending' ||
        i.businessProfile.verificationStatus === 'under_review'),
  );

  if (loading) {
    return <p className="admin-empty">{dictionary.admin.loading}</p>;
  }

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
      {error && <p className="admin-error-banner">{error}</p>}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="admin-btn"
          disabled={syncing}
          onClick={() => void handleSyncVerifiedAt()}
          title="Fix verified_at for profiles manually set to verified in the database"
        >
          {syncing ? dictionary.admin.loading : 'Sync verified_at'}
        </button>
        <button
          type="button"
          className={`admin-btn ${activeSubTab === 'identity' ? 'admin-btn--primary' : ''}`}
          onClick={() => setActiveSubTab('identity')}
        >
          {dictionary.admin.identity} ({identityDocs.length})
        </button>
        <button
          type="button"
          className={`admin-btn ${activeSubTab === 'academic' ? 'admin-btn--primary' : ''}`}
          onClick={() => setActiveSubTab('academic')}
        >
          {dictionary.admin.academic} ({academicRecs.length})
        </button>
        <button
          type="button"
          className={`admin-btn ${activeSubTab === 'business' ? 'admin-btn--primary' : ''}`}
          onClick={() => setActiveSubTab('business')}
        >
          {dictionary.admin.business} ({businessUsers.length})
        </button>
      </div>

      {activeSubTab === 'identity' &&
        (identityDocs.length === 0 ? (
          <p className="admin-empty">{dictionary.admin.noPending}</p>
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>{dictionary.admin.user}</th>
                  <th>Type</th>
                  <th>Images</th>
                  <th>{dictionary.admin.role}</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {identityDocs.map((doc) => (
                  <tr key={doc.id}>
                    <td>{doc.fullNameOnDoc}</td>
                    <td>
                      {doc.userDisplayName}
                      <br />
                      <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-soft))' }}>
                        {doc.userEmail}
                      </span>
                    </td>
                    <td>{doc.documentType}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {doc.frontImageUrl && (
                          <button
                            type="button"
                            className="admin-btn admin-btn--small"
                            onClick={() =>
                              setPreviewImage({ url: doc.frontImageUrl!, title: 'Document front' })
                            }
                          >
                            View front
                          </button>
                        )}
                        {doc.backImageUrl && (
                          <button
                            type="button"
                            className="admin-btn admin-btn--small"
                            onClick={() =>
                              setPreviewImage({ url: doc.backImageUrl!, title: 'Document back' })
                            }
                          >
                            View back
                          </button>
                        )}
                        {doc.selfieImageUrl && (
                          <button
                            type="button"
                            className="admin-btn admin-btn--small"
                            onClick={() =>
                              setPreviewImage({ url: doc.selfieImageUrl!, title: 'Selfie' })
                            }
                          >
                            View selfie
                          </button>
                        )}
                        {!doc.frontImageUrl && !doc.backImageUrl && !doc.selfieImageUrl && (
                          <span style={{ color: 'hsl(var(--text-soft))' }}>—</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="admin-badge">{doc.userRole}</span>
                    </td>
                    <td>
                      <div className="admin-actions-row">
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-btn--success"
                          disabled={reviewing === doc.id}
                          onClick={() => void handleReviewIdentity(doc.id, 'approved')}
                        >
                          {dictionary.admin.approve}
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-btn--danger"
                          disabled={reviewing === doc.id}
                          onClick={() => void handleReviewIdentity(doc.id, 'rejected')}
                        >
                          {dictionary.admin.reject}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {activeSubTab === 'academic' &&
        (academicRecs.length === 0 ? (
          <p className="admin-empty">{dictionary.admin.noPending}</p>
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Institution</th>
                  <th>Documents</th>
                  <th>{dictionary.admin.user}</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {academicRecs.map((rec) => (
                  <tr key={rec.id}>
                    <td>{rec.title}</td>
                    <td>{rec.institution}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {rec.certificateImageUrl && (
                          <button
                            type="button"
                            className="admin-btn admin-btn--small"
                            onClick={() =>
                              setPreviewImage({
                                url: rec.certificateImageUrl!,
                                title: 'Certificate',
                              })
                            }
                          >
                            View certificate
                          </button>
                        )}
                        {rec.transcriptImageUrl && (
                          <button
                            type="button"
                            className="admin-btn admin-btn--small"
                            onClick={() =>
                              setPreviewImage({
                                url: rec.transcriptImageUrl!,
                                title: 'Transcript',
                              })
                            }
                          >
                            View transcript
                          </button>
                        )}
                        {!rec.certificateImageUrl && !rec.transcriptImageUrl && (
                          <span style={{ color: 'hsl(var(--text-soft))' }}>—</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {rec.userDisplayName}
                      <br />
                      <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-soft))' }}>
                        {rec.userEmail}
                      </span>
                    </td>
                    <td>
                      <div className="admin-actions-row">
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-btn--success"
                          disabled={reviewing === rec.id}
                          onClick={() => void handleReviewAcademic(rec.id, 'approved')}
                        >
                          {dictionary.admin.approve}
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-btn--danger"
                          disabled={reviewing === rec.id}
                          onClick={() => void handleReviewAcademic(rec.id, 'rejected')}
                        >
                          {dictionary.admin.reject}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {activeSubTab === 'business' &&
        (businessUsers.length === 0 ? (
          <p className="admin-empty">{dictionary.admin.noPending}</p>
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>{dictionary.admin.user}</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {businessUsers.map((item) => (
                  <tr key={item.userId}>
                    <td>{item.businessProfile!.companyName}</td>
                    <td>
                      {item.displayName}
                      <br />
                      <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-soft))' }}>
                        {item.email}
                      </span>
                    </td>
                    <td>
                      <div className="admin-actions-row">
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-btn--success"
                          disabled={reviewing === item.userId}
                          onClick={() => void handleReviewBusiness(item.userId, 'approved')}
                        >
                          {dictionary.admin.approve}
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-btn--danger"
                          disabled={reviewing === item.userId}
                          onClick={() => void handleReviewBusiness(item.userId, 'rejected')}
                        >
                          {dictionary.admin.reject}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </>
  );
};
