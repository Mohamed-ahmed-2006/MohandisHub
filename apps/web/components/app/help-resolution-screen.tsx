'use client';

import type {
  ReservationDisputeCase,
  ReservationDisputeListItem,
  SupportTicket,
  SupportTicketCategory,
  SupportTicketMessage,
} from '@mohandishub/shared';
import { ChevronLeft, Inbox, PlusCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { getApiBaseUrl } from '@/lib/env';
import { useI18n } from '@/lib/i18n/context';
import { buildLocalePath } from '@/lib/i18n/path';
import { reservationsApiClient } from '@/lib/reservations/client';
import { toStoredAttachmentUrl } from '@/lib/support/attachment-url';
import { supportApiClient } from '@/lib/support/client';
import { getPrivateFileOpenableUrl, uploadFile, uploadPrivateFile } from '@/lib/upload/client';

import '@/app/dashboard.css';

type Props = {
  defaultTab?: 'all' | 'support' | 'disputes' | 'safety';
};

type UnifiedCategory =
  | 'general_support'
  | 'need_job_dispute'
  | 'reservation_dispute'
  | 'direct_payment'
  | 'safety_reporting';

type UnifiedCaseItem = {
  id: string;
  kind: 'support_ticket' | 'reservation_dispute';
  referenceCode: string;
  title: string;
  category: UnifiedCategory;
  categoryLabelText: string;
  status: string;
  updatedAt: string;
  rawSupportTicket?: SupportTicket;
  rawDisputeItem?: ReservationDisputeListItem;
};

export const HelpResolutionScreen = ({ defaultTab = 'all' }: Props) => {
  const { locale, dictionary } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlTicketId = searchParams.get('ticketId') ?? searchParams.get('caseId');
  const urlDisputeId = searchParams.get('disputeId');

  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();

  const [activeTab, setActiveTab] = useState<'all' | 'support' | 'disputes' | 'safety'>(defaultTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');

  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [disputeItems, setDisputeItems] = useState<ReservationDisputeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedCase, setSelectedCase] = useState<UnifiedCaseItem | null>(null);

  // Thread state for support ticket
  const [ticketMessages, setTicketMessages] = useState<SupportTicketMessage[]>([]);
  // Full detail for reservation dispute case
  const [disputeCaseFile, setDisputeCaseFile] = useState<ReservationDisputeCase | null>(null);

  const [detailLoading, setDetailLoading] = useState(false);
  const [messageBody, setMessageBody] = useState('');
  const [evidenceLabel, setEvidenceLabel] = useState('');
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // New Case Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createCategory, setCreateCategory] = useState<UnifiedCategory>('general_support');
  const [createSubject, setCreateSubject] = useState('');
  const [createBody, setCreateBody] = useState('');
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const [unavailableNotice, setUnavailableNotice] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isArabic = locale === 'ar';
  const tr = (en: string, ar: string) => (isArabic ? ar : en);

  const sp = (dictionary.supportPage ?? {}) as Record<string, string>;
  const d = (dictionary.common ?? {}) as Record<string, string>;

  // Redirect unauthenticated or unverified users
  useEffect(() => {
    if (!isReady) return;
    if (!isAuthenticated || !authUser) {
      router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
      return;
    }
    if (!authGuard.emailVerified) {
      router.replace(buildLocalePath(locale, '/verify-email'));
    }
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router]);

  // Load cases from support tickets and reservation dispute APIs
  const loadData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [ticketsRes, disputesRes] = await Promise.allSettled([
        supportApiClient.listMyTickets(accessToken, { page: 1, limit: 50 }),
        reservationsApiClient.listMyDisputeCases(accessToken),
      ]);

      if (ticketsRes.status === 'fulfilled') {
        setSupportTickets(ticketsRes.value.items);
      } else {
        setSupportTickets([]);
      }

      if (disputesRes.status === 'fulfilled') {
        setDisputeItems(disputesRes.value);
      } else {
        setDisputeItems([]);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tr('Failed to load help & resolution cases.', 'تعذر تحميل قضايا الدعم والنزاعات.'),
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Build unified list of case items
  const unifiedCases: UnifiedCaseItem[] = [
    ...supportTickets.map((t) => ({
      id: `ticket-${t.id}`,
      kind: 'support_ticket' as const,
      referenceCode: `TKT-${t.id.slice(0, 8).toUpperCase()}`,
      title: t.subject || tr('Support Ticket', 'تذكرة دعم'),
      category:
        t.category === 'bug'
          ? ('safety_reporting' as const)
          : ('general_support' as const),
      categoryLabelText:
        t.category === 'bug'
          ? tr('Technical Issue', 'مشكلة تقنية')
          : t.category === 'suggestion'
            ? tr('Suggestion', 'اقتراح')
            : t.category === 'error'
              ? tr('System Error', 'خطأ بالنظام')
              : tr('General Support', 'دعم عام'),
      status: t.status,
      updatedAt: t.updatedAt,
      rawSupportTicket: t,
    })),
    ...disputeItems.map((dItem) => ({
      id: `dispute-${dItem.dispute.id}`,
      kind: 'reservation_dispute' as const,
      referenceCode: `DSP-${dItem.dispute.id.slice(0, 8).toUpperCase()}`,
      title: dItem.reservation.serviceTitle ?? tr('Reservation Dispute', 'نزاع حجز'),
      category: 'reservation_dispute' as const,
      categoryLabelText: tr('Reservation Dispute', 'نزاع حجز'),
      status: dItem.dispute.status,
      updatedAt: dItem.lastActivityAt,
      rawDisputeItem: dItem,
    })),
  ].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  // Deep-link query param selection
  useEffect(() => {
    if (unifiedCases.length === 0) return;
    if (urlTicketId) {
      const match = unifiedCases.find(
        (c) => c.kind === 'support_ticket' && c.rawSupportTicket?.id === urlTicketId,
      );
      if (match) setSelectedCase(match);
    } else if (urlDisputeId) {
      const match = unifiedCases.find(
        (c) => c.kind === 'reservation_dispute' && c.rawDisputeItem?.dispute.id === urlDisputeId,
      );
      if (match) setSelectedCase(match);
    }
  }, [urlTicketId, urlDisputeId, supportTickets.length, disputeItems.length]);

  // Filter cases by active tab, status, and search query
  const filteredCases = unifiedCases.filter((item) => {
    if (activeTab === 'support' && item.kind !== 'support_ticket') return false;
    if (activeTab === 'disputes' && item.kind !== 'reservation_dispute') return false;
    if (activeTab === 'safety' && item.category !== 'safety_reporting') return false;

    if (statusFilter === 'open' && (item.status === 'closed' || item.status === 'resolved' || item.status === 'resolved_refunded' || item.status === 'resolved_released')) {
      return false;
    }
    if (statusFilter === 'closed' && !(item.status === 'closed' || item.status === 'resolved' || item.status === 'resolved_refunded' || item.status === 'resolved_released')) {
      return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchRef = item.referenceCode.toLowerCase().includes(q);
      if (!matchTitle && !matchRef) return false;
    }

    return true;
  });

  // Load details when a case is selected
  useEffect(() => {
    if (!selectedCase || !accessToken) {
      setTicketMessages([]);
      setDisputeCaseFile(null);
      return;
    }

    setDetailLoading(true);
    if (selectedCase.kind === 'support_ticket' && selectedCase.rawSupportTicket) {
      supportApiClient
        .listMessages(accessToken, selectedCase.rawSupportTicket.id)
        .then(setTicketMessages)
        .catch(() => setTicketMessages([]))
        .finally(() => setDetailLoading(false));
    } else if (selectedCase.kind === 'reservation_dispute' && selectedCase.rawDisputeItem) {
      reservationsApiClient
        .getDisputeCase(accessToken, selectedCase.rawDisputeItem.dispute.id)
        .then(setDisputeCaseFile)
        .catch(() => setDisputeCaseFile(null))
        .finally(() => setDetailLoading(false));
    }
  }, [selectedCase, accessToken]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [ticketMessages, disputeCaseFile]);

  // Reply or Add Note submit handler
  const handleReplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !selectedCase || !messageBody.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      if (selectedCase.kind === 'support_ticket' && selectedCase.rawSupportTicket) {
        const attachmentUrls: string[] = [];
        for (const file of replyFiles.slice(0, 2)) {
          const { url } = await uploadFile(accessToken, file);
          attachmentUrls.push(toStoredAttachmentUrl(url));
        }
        const newMsg = await supportApiClient.reply(accessToken, selectedCase.rawSupportTicket.id, {
          body: messageBody.trim(),
          ...(attachmentUrls.length ? { attachmentUrls } : {}),
        });
        setTicketMessages((prev) => [...prev, newMsg]);
        setMessageBody('');
        setReplyFiles([]);
      } else if (selectedCase.kind === 'reservation_dispute' && selectedCase.rawDisputeItem) {
        await reservationsApiClient.addDisputeNote(
          accessToken,
          selectedCase.rawDisputeItem.dispute.id,
          { body: messageBody.trim() },
        );
        setMessageBody('');
        if (selectedCase.rawDisputeItem) {
          setDisputeCaseFile(
            await reservationsApiClient.getDisputeCase(
              accessToken,
              selectedCase.rawDisputeItem.dispute.id,
            ),
          );
        }
      }
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('Failed to post message.', 'تعذر إرسال الرسالة.'));
    } finally {
      setSubmitting(false);
    }
  };

  // Add evidence to dispute
  const handleAddEvidence = async (file: File | undefined) => {
    if (!accessToken || !selectedCase || !file || selectedCase.kind !== 'reservation_dispute' || !selectedCase.rawDisputeItem) return;
    setSubmitting(true);
    setError(null);
    try {
      const uploaded = await uploadPrivateFile(accessToken, file);
      await reservationsApiClient.addDisputeEvidence(accessToken, selectedCase.rawDisputeItem.dispute.id, {
        uploadId: uploaded.filename,
        ...(evidenceLabel.trim() ? { label: evidenceLabel.trim() } : {}),
      });
      setEvidenceLabel('');
      setDisputeCaseFile(
        await reservationsApiClient.getDisputeCase(accessToken, selectedCase.rawDisputeItem.dispute.id),
      );
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('Failed to attach evidence.', 'تعذر إرفاق الدليل.'));
    } finally {
      setSubmitting(false);
    }
  };

  // Securely open private evidence file
  const handleOpenPrivateEvidence = async (uploadId: string) => {
    if (!accessToken) return;
    try {
      const url = await getPrivateFileOpenableUrl(accessToken, uploadId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setError(tr('Could not generate secure openable URL for evidence.', 'تعذر إنشاء رابط آمن لفتح الدليل.'));
    }
  };

  // Handle new case creation modal form submit
  const handleCreateCaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnavailableNotice(null);
    if (!accessToken) return;

    if (createCategory === 'need_job_dispute' || createCategory === 'direct_payment') {
      setUnavailableNotice(
        tr(
          `Standalone case creation for "${createCategory.replace(/_/g, ' ')}" is pending backend API deployment (Contract: POST /api/v1/help-resolution/${createCategory === 'need_job_dispute' ? 'job-disputes' : 'payment-disputes'}). Please use General Support or contact platform administrators directly.`,
          `إنشاء القضايا المباشرة لـ "${createCategory}" معطل حالياً بانتظار نشر API الخلفي (العقد: POST /api/v1/help-resolution/${createCategory === 'need_job_dispute' ? 'job-disputes' : 'payment-disputes'}). يرجى استخدام الدعم العام أو التواصل مباشرة مع الإدارة.`,
        ),
      );
      return;
    }

    if (createCategory === 'reservation_dispute') {
      router.push(buildLocalePath(locale, '/app/bookings'));
      setShowCreateModal(false);
      return;
    }

    // General support or safety reporting submission
    if (!createBody.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const attachmentUrls: string[] = [];
      for (const file of createFiles.slice(0, 2)) {
        const { url } = await uploadFile(accessToken, file);
        attachmentUrls.push(toStoredAttachmentUrl(url));
      }

      const mapCat: SupportTicketCategory = createCategory === 'safety_reporting' ? 'bug' : 'other';
      await supportApiClient.createTicket(accessToken, {
        category: mapCat,
        subject: createSubject.trim() || tr('New Support Request', 'طلب دعم جديد'),
        body: createBody.trim(),
        ...(attachmentUrls.length ? { attachmentUrls } : {}),
      });

      setShowCreateModal(false);
      setCreateSubject('');
      setCreateBody('');
      setCreateFiles([]);
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('Could not create ticket.', 'تعذر إنشاء التذكرة.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isReady || !authUser) {
    return (
      <main className="support-screen">
        <Container className="support-screen__container">
          <p className="support-empty">{d.loading ?? tr('Loading...', 'جاري التحميل...')}</p>
        </Container>
      </main>
    );
  }

  const layoutClass = `support-layout${selectedCase ? ' support-layout--thread' : ''}`;

  return (
    <main className="support-screen">
      <Container className="support-screen__container">
        {/* Unified Center Header */}
        <header className="support-screen__header" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h1 className="support-screen__title">
                {tr('Help & Resolution Center', 'مركز الدعم وحل النزاعات')}
              </h1>
              <p className="support-screen__intro" style={{ margin: '0.3rem 0 0' }}>
                {tr(
                  'Manage support tickets, track marketplace disputes, inspect evidence, and resolve issues in one place.',
                  'إدارة تذاكر الدعم، تتبع نزاعات السوق، فحص الأدلة، وحل المشكلات في مكان واحد.',
                )}
              </p>
            </div>
            <button
              type="button"
              className="dashboard-primary-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              onClick={() => {
                setShowCreateModal(true);
                setUnavailableNotice(null);
              }}
            >
              <PlusCircle size={18} />
              {tr('New Ticket / Dispute', 'تذكرة / نزاع جديد')}
            </button>
          </div>

          {/* Unified Filter Tabs */}
          <div className="dashboard-tabs" style={{ marginTop: '1.25rem' }}>
            <button
              type="button"
              className={`dashboard-tab ${activeTab === 'all' ? 'dashboard-tab--active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              {tr('All Cases', 'جميع القضايا')} ({unifiedCases.length})
            </button>
            <button
              type="button"
              className={`dashboard-tab ${activeTab === 'support' ? 'dashboard-tab--active' : ''}`}
              onClick={() => setActiveTab('support')}
            >
              {tr('General Support', 'الدعم العام')} ({supportTickets.length})
            </button>
            <button
              type="button"
              className={`dashboard-tab ${activeTab === 'disputes' ? 'dashboard-tab--active' : ''}`}
              onClick={() => setActiveTab('disputes')}
            >
              {tr('Marketplace Disputes', 'نزاعات السوق')} ({disputeItems.length})
            </button>
            <button
              type="button"
              className={`dashboard-tab ${activeTab === 'safety' ? 'dashboard-tab--active' : ''}`}
              onClick={() => setActiveTab('safety')}
            >
              {tr('Safety & Payments', 'السياسة والدفع')}
            </button>
          </div>
        </header>

        {error && <p className="dashboard-error" style={{ marginBottom: '1rem' }}>{error}</p>}

        {/* Guided New Case Modal */}
        {showCreateModal && (
          <div
            style={{
              background: 'var(--card-bg, rgba(30, 41, 59, 0.95))',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '1.5rem',
              marginBottom: '2rem',
              maxWidth: '650px',
            }}
          >
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem' }}>
              {tr('Create Help Request or Dispute', 'إنشاء طلب دعم أو نزاع')}
            </h3>

            {unavailableNotice && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  marginBottom: '1rem',
                  fontSize: '0.88rem',
                }}
              >
                ⚠️ {unavailableNotice}
              </div>
            )}

            <form onSubmit={(e) => void handleCreateCaseSubmit(e)} className="dashboard-form">
              <label className="dashboard-form-label-inline">
                {tr('Issue Category', 'فئة المشكلة')}
              </label>
              <select
                className="dashboard-input"
                value={createCategory}
                onChange={(e) => {
                  setCreateCategory(e.target.value as UnifiedCategory);
                  setUnavailableNotice(null);
                }}
              >
                <option value="general_support">{tr('General Platform Support', 'دعم المنصة العام')}</option>
                <option value="need_job_dispute">{tr('Need / Job Order Issue', 'مشكلة طلب / وظيفة')}</option>
                <option value="reservation_dispute">{tr('Reservation Escrow Dispute', 'نزاع حجز / الضمان')}</option>
                <option value="direct_payment">{tr('Direct Payment / Settlement Issue', 'مشكلة دفع مباشر')}</option>
                <option value="safety_reporting">{tr('Safety / Policy Report', 'بلاغ سلامة / انتهاك')}</option>
              </select>

              {createCategory === 'reservation_dispute' ? (
                <div style={{ padding: '0.75rem', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '8px' }}>
                  <p className="dashboard-card-meta">
                    ℹ {tr(
                      'Reservation disputes are opened directly from your active booking history. Clicking continue will take you to your Bookings.',
                      'تفتح نزاعات الحجز مباشرة من تاريخ حجوزاتك النشطة. الضغط على متابعة سينقلك إلى الحجوزات.',
                    )}
                  </p>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    className="dashboard-input"
                    placeholder={tr('Subject / Summary', 'الموضوع / الملخص')}
                    value={createSubject}
                    onChange={(e) => setCreateSubject(e.target.value)}
                    required
                  />
                  <textarea
                    className="dashboard-input"
                    placeholder={tr('Detailed description of your issue...', 'وصف تفصيلي للمشكلة...')}
                    value={createBody}
                    onChange={(e) => setCreateBody(e.target.value)}
                    required
                    rows={4}
                  />
                  <div>
                    <label className="dashboard-form-label-inline">
                      {d.upload ?? 'Upload Attachments'} ({d.maxTwoImages ?? 'Max 2 files'})
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="dashboard-input"
                      onChange={(e) => setCreateFiles(Array.from(e.target.files ?? []).slice(0, 2))}
                    />
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button type="submit" className="dashboard-primary-btn" disabled={submitting}>
                  {createCategory === 'reservation_dispute'
                    ? tr('Go to Bookings →', 'الانتقال للحجوزات ←')
                    : tr('Submit Case', 'إرسال القضية')}
                </button>
                <button
                  type="button"
                  className="dashboard-secondary-btn"
                  onClick={() => setShowCreateModal(false)}
                >
                  {d.cancel ?? 'Cancel'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Main Grid Layout */}
        <div className={layoutClass}>
          {/* Cases Sidebar List */}
          <aside className="support-inbox" aria-label="Cases List">
            {/* Search & Filter Inputs */}
            <div className="support-inbox__toolbar" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <input
                type="text"
                className="dashboard-input"
                placeholder={tr('Search cases...', 'البحث في القضايا...')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ fontSize: '0.85rem' }}
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className={`dashboard-secondary-btn ${statusFilter === 'all' ? 'dashboard-primary-btn' : ''}`}
                  style={{ flex: 1, padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                  onClick={() => setStatusFilter('all')}
                >
                  {tr('All Status', 'الكل')}
                </button>
                <button
                  type="button"
                  className={`dashboard-secondary-btn ${statusFilter === 'open' ? 'dashboard-primary-btn' : ''}`}
                  style={{ flex: 1, padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                  onClick={() => setStatusFilter('open')}
                >
                  {tr('Active', 'نشط')}
                </button>
                <button
                  type="button"
                  className={`dashboard-secondary-btn ${statusFilter === 'closed' ? 'dashboard-primary-btn' : ''}`}
                  style={{ flex: 1, padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                  onClick={() => setStatusFilter('closed')}
                >
                  {tr('Closed', 'مغلق')}
                </button>
              </div>
            </div>

            <div className="support-inbox__list">
              {loading ? (
                <p className="support-empty">{d.loading ?? 'Loading...'}</p>
              ) : filteredCases.length === 0 ? (
                <p className="support-empty">
                  {tr('No matching cases found.', 'لم يتم العثور على قضايا مطابقة.')}
                </p>
              ) : (
                filteredCases.map((c) => {
                  const isActive = selectedCase?.id === c.id;
                  const isDispute = c.kind === 'reservation_dispute';
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`support-ticket-row ${isActive ? 'support-ticket-row--active' : ''}`}
                      onClick={() => setSelectedCase(c)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="support-ticket-row__subject">{c.title}</span>
                        <span
                          style={{
                            fontSize: '0.7rem',
                            padding: '0.15rem 0.4rem',
                            borderRadius: '4px',
                            background: isDispute ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                            color: isDispute ? '#ef4444' : '#3b82f6',
                          }}
                        >
                          {isDispute ? tr('Dispute', 'نزاع') : tr('Support', 'دعم')}
                        </span>
                      </div>
                      <span className="support-ticket-row__meta">
                        <span className="support-pill">{c.status}</span>
                        <span>{c.referenceCode}</span>
                        <span>{new Date(c.updatedAt).toLocaleDateString()}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* Selected Case Thread / Detail Section */}
          <section className="support-thread" aria-live="polite">
            {!selectedCase ? (
              <div className="support-thread__placeholder">
                <div className="support-thread__placeholder-icon" aria-hidden>
                  <Inbox size={28} strokeWidth={1.75} />
                </div>
                <p>{tr('Select a case to inspect thread and details.', 'اختر قضية من القائمة لمعاينة التفاصيل.')}</p>
              </div>
            ) : (
              <>
                <div className="support-thread__header">
                  <button
                    type="button"
                    className="support-thread__back"
                    onClick={() => setSelectedCase(null)}
                    aria-label={d.back ?? 'Back'}
                  >
                    <ChevronLeft size={18} aria-hidden />
                    {d.back ?? 'Back'}
                  </button>
                  <div className="support-thread__header-body">
                    <h2>{selectedCase.title}</h2>
                    <div className="support-thread__header-chips">
                      <span className="support-pill">{selectedCase.status}</span>
                      <span className="support-pill">{selectedCase.categoryLabelText}</span>
                      <span className="support-pill">{selectedCase.referenceCode}</span>
                    </div>
                  </div>
                </div>

                {detailLoading ? (
                  <p className="support-empty">{d.loading ?? 'Loading details...'}</p>
                ) : (
                  <div className="support-scroll" role="region" aria-label="Case Thread">
                    {/* Reservation Dispute Detail Summary */}
                    {selectedCase.kind === 'reservation_dispute' && disputeCaseFile && (
                      <div style={{ padding: '1rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', marginBottom: '1.5rem' }}>
                        <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>
                          {tr('Marketplace Reservation Dispute', 'نزاع حجز بالمنصة')}
                        </h4>
                        <p className="dashboard-card-meta" style={{ margin: '0.2rem 0' }}>
                          {tr('Reason', 'السبب')}: <strong>{disputeCaseFile.dispute.reason}</strong> · {tr('Status', 'الحالة')}: <strong>{disputeCaseFile.dispute.status}</strong>
                        </p>
                        {disputeCaseFile.dispute.description && (
                          <p className="dashboard-card-meta" style={{ margin: '0.4rem 0 0' }}>
                            {disputeCaseFile.dispute.description}
                          </p>
                        )}
                        {/* Evidence Files List */}
                        <div style={{ marginTop: '1rem' }}>
                          <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>
                            {tr('Attached Evidence Files', 'الملفات والأدلة المرفقة')} ({disputeCaseFile.evidence.length})
                          </h5>
                          {disputeCaseFile.evidence.length === 0 ? (
                            <p className="dashboard-card-meta">{tr('No evidence files attached yet.', 'لا توجد أدلة مرفقة حتى الآن.')}</p>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                              {disputeCaseFile.evidence.map((ev) => (
                                <div key={ev.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0, 0, 0, 0.2)', padding: '0.4rem 0.8rem', borderRadius: '6px' }}>
                                  <span style={{ fontSize: '0.85rem' }}>📁 {ev.label ?? ev.uploadId}</span>
                                  <button
                                    type="button"
                                    className="dashboard-secondary-btn"
                                    style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                                    onClick={() => void handleOpenPrivateEvidence(ev.uploadId)}
                                  >
                                    {tr('Open File ↗', 'فتح الملف ↗')}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Upload Evidence Input */}
                          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <input
                              className="dashboard-input"
                              style={{ flex: 1 }}
                              placeholder={tr('Evidence label / description', 'وصف الدليل')}
                              value={evidenceLabel}
                              onChange={(e) => setEvidenceLabel(e.target.value)}
                            />
                            <input
                              type="file"
                              className="dashboard-input"
                              style={{ width: 'auto' }}
                              onChange={(e) => void handleAddEvidence(e.target.files?.[0])}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Dispute Notes Thread */}
                    {selectedCase.kind === 'reservation_dispute' && disputeCaseFile && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {disputeCaseFile.notes.map((n) => (
                          <div key={n.id} className="support-bubble support-bubble--user">
                            <span className="support-bubble__label">{n.authorName ?? tr('Party / Staff', 'الطرف / الإدارة')}</span>
                            <p className="support-bubble__body">{n.body}</p>
                            <span className="support-bubble__time">{new Date(n.createdAt).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Support Ticket Thread Messages */}
                    {selectedCase.kind === 'support_ticket' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {ticketMessages.map((m) => {
                          const isStaff = m.isStaff;
                          return (
                            <div
                              key={m.id}
                              className={`support-bubble ${isStaff ? 'support-bubble--staff' : 'support-bubble--user'}`}
                            >
                              <span className="support-bubble__label">
                                {isStaff ? (sp.staffLabel ?? tr('Support Team', 'فريق الدعم')) : (sp.youLabel ?? tr('You', 'أنت'))}
                              </span>
                              <p className="support-bubble__body">{m.body}</p>
                              {m.attachmentUrls?.length ? (
                                <div className="support-attachments">
                                  {m.attachmentUrls.map((u) => {
                                    const src = u.startsWith('http')
                                      ? u
                                      : `${getApiBaseUrl()}${u.startsWith('/') ? '' : '/'}${u}`;
                                    return (
                                      <a key={u} href={src} target="_blank" rel="noopener noreferrer">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={src} alt="attachment" width={80} height={80} />
                                      </a>
                                    );
                                  })}
                                </div>
                              ) : null}
                              <span className="support-bubble__time">
                                {new Date(m.createdAt).toLocaleString()}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div ref={messagesEndRef} />
                  </div>
                )}

                {/* Reply Composer Form */}
                <div className="support-composer" style={{ marginTop: '1rem' }}>
                  <form onSubmit={(e) => void handleReplySubmit(e)}>
                    <textarea
                      value={messageBody}
                      onChange={(e) => setMessageBody(e.target.value)}
                      placeholder={tr('Add message or note to this case...', 'إضافة رسالة أو ملاحظة لهذه القضية...')}
                      rows={3}
                      maxLength={10000}
                    />
                    <div className="support-composer__row">
                      {selectedCase.kind === 'support_ticket' && (
                        <div className="support-composer__files">
                          <label className="dashboard-form-label-inline">
                            {d.upload ?? 'Upload'} — {d.maxTwoImages ?? 'Max 2'}
                          </label>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="dashboard-input"
                            onChange={(e) => setReplyFiles(Array.from(e.target.files ?? []).slice(0, 2))}
                          />
                        </div>
                      )}
                      <button
                        type="submit"
                        className="support-composer__submit"
                        disabled={submitting || !messageBody.trim()}
                      >
                        {d.reply ?? tr('Post Message', 'إرسال الرسالة')}
                      </button>
                    </div>
                  </form>
                </div>
              </>
            )}
          </section>
        </div>
      </Container>
    </main>
  );
};
