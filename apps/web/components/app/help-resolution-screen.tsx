'use client';

import type {
  CreateResolutionCaseBody,
  ResolutionCaseAvailability,
  ResolutionCaseFile,
  ResolutionCaseKind,
  ResolutionCaseSummary,
} from '@mohandishub/shared';
import { ChevronLeft, Inbox, PlusCircle, ShieldAlert } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { isApiClientError } from '@/lib/auth/client';
import { getApiBaseUrl } from '@/lib/env';
import { helpResolutionApiClient } from '@/lib/help-resolution/client';
import { useI18n } from '@/lib/i18n/context';
import { buildLocalePath } from '@/lib/i18n/path';
import { toStoredAttachmentUrl } from '@/lib/support/attachment-url';
import { getPrivateFileOpenableUrl, uploadFile, uploadPrivateFile } from '@/lib/upload/client';

import '@/app/dashboard.css';
import './case-thread.css';

type Props = {
  defaultTab?: 'all' | 'support' | 'disputes' | 'safety';
};

type CreatableKind = ResolutionCaseKind;

/**
 * Which case kinds each tab shows.
 *
 * Sent to the server as a filter rather than applied to a loaded page: the list
 * is paginated, so filtering client-side would have hidden older cases that
 * simply had not been fetched.
 */
const TAB_KINDS: Record<NonNullable<Props['defaultTab']>, ResolutionCaseKind[]> = {
  all: [],
  support: ['general_support'],
  disputes: ['reservation_dispute', 'need_job_dispute'],
  safety: ['safety_report', 'direct_payment'],
};

const OPEN_STATUSES = ['open', 'awaiting_user', 'under_review'];
const CLOSED_STATUSES = ['resolved', 'closed'];

export const HelpResolutionScreen = ({ defaultTab = 'all' }: Props) => {
  const { locale, dictionary } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlCaseId = searchParams.get('caseId');
  const urlTicketId = searchParams.get('ticketId');
  const urlDisputeId = searchParams.get('disputeId');

  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();

  const [activeTab, setActiveTab] = useState<'all' | 'support' | 'disputes' | 'safety'>(defaultTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');

  const [cases, setCases] = useState<ResolutionCaseSummary[]>([]);
  const [availability, setAvailability] = useState<ResolutionCaseAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [caseFile, setCaseFile] = useState<ResolutionCaseFile | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [messageBody, setMessageBody] = useState('');
  const [evidenceLabel, setEvidenceLabel] = useState('');
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createKind, setCreateKind] = useState<CreatableKind>('general_support');
  const [createSubjectKey, setCreateSubjectKey] = useState('');
  const [createReason, setCreateReason] = useState('other');
  const [createSubject, setCreateSubject] = useState('');
  const [createBody, setCreateBody] = useState('');
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const [unavailableNotice, setUnavailableNotice] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const createCaseButtonRef = useRef<HTMLButtonElement>(null);
  const createCaseDialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const isArabic = locale === 'ar';
  const tr = (en: string, ar: string) => (isArabic ? ar : en);

  const hr = (dictionary.helpResolutionPage ?? {}) as Record<string, string>;
  const sp = (dictionary.supportPage ?? {}) as Record<string, string>;
  const d = (dictionary.common ?? {}) as Record<string, string>;

  const kindLabel = useCallback(
    (kind: ResolutionCaseKind): string => {
      switch (kind) {
        case 'general_support':
          return hr.kindGeneralSupport ?? tr('General support', 'الدعم العام');
        case 'reservation_dispute':
          return hr.kindReservationDispute ?? tr('Reservation dispute', 'نزاع حجز');
        case 'need_job_dispute':
          return hr.kindNeedJobDispute ?? tr('Need / job dispute', 'نزاع طلب أو وظيفة');
        case 'direct_payment':
          return hr.kindDirectPayment ?? tr('Direct payment issue', 'مشكلة دفع مباشر');
        case 'safety_report':
          return hr.kindSafetyReport ?? tr('Safety report', 'بلاغ سلامة');
      }
    },
    [hr, isArabic],
  );

  const statusLabel = useCallback(
    (status: string): string => {
      const labels: Record<string, string> = {
        open: tr('Open', 'مفتوحة'),
        awaiting_user: tr('Awaiting user', 'بانتظار المستخدم'),
        under_review: tr('Under review', 'قيد المراجعة'),
        escalated: tr('Escalated', 'مصعّدة'),
        resolved: tr('Resolved', 'تم الحل'),
        closed: tr('Closed', 'مغلقة'),
        in_progress: tr('In progress', 'قيد المعالجة'),
        waiting_reply: tr('Waiting for reply', 'بانتظار الرد'),
        resolved_customer: tr('Resolved for customer', 'تم الحل لصالح العميل'),
        resolved_provider: tr('Resolved for provider', 'تم الحل لصالح مقدم الخدمة'),
        resolved_partial: tr('Resolved with a split', 'تم الحل بالتقسيم'),
        dismissed: tr('Dismissed', 'مرفوضة'),
      };
      return labels[status] ?? status.replaceAll('_', ' ');
    },
    [isArabic],
  );

  const outcomeLabel = useCallback(
    (outcome: NonNullable<ResolutionCaseFile['resolution']['outcome']>): string => {
      const labels: Record<typeof outcome, string> = {
        resolved_for_opener: tr('Resolved for opener', 'تم الحل لصالح مقدم البلاغ'),
        resolved_for_counterparty: tr('Resolved for counterparty', 'تم الحل لصالح الطرف الآخر'),
        resolved_partial: tr('Resolved partially', 'تم الحل جزئياً'),
        no_action: tr('No action', 'لا إجراء'),
        duplicate: tr('Duplicate', 'مكررة'),
        withdrawn: tr('Withdrawn', 'مسحوبة'),
      };
      return labels[outcome];
    },
    [isArabic],
  );

  const statusPillInfo = useCallback(
    (status: string) => {
      const label = statusLabel(status);
      switch (status) {
        case 'open':
          return { label, className: 'support-pill support-pill--open' };
        case 'awaiting_user':
        case 'waiting_reply':
          return { label, className: 'support-pill support-pill--wait' };
        case 'under_review':
        case 'in_progress':
        case 'escalated':
          return { label, className: 'support-pill support-pill--progress' };
        case 'resolved':
        case 'closed':
        case 'resolved_customer':
        case 'resolved_provider':
        case 'resolved_partial':
        case 'dismissed':
          return { label, className: 'support-pill support-pill--done' };
        default:
          return { label, className: 'support-pill' };
      }
    },
    [statusLabel],
  );

  const kindBadgeClass = useCallback((kind: ResolutionCaseKind): string => {
    switch (kind) {
      case 'general_support':
        return 'support-kind-badge support-kind-badge--support';
      case 'reservation_dispute':
      case 'need_job_dispute':
        return 'support-kind-badge support-kind-badge--dispute';
      case 'safety_report':
        return 'support-kind-badge support-kind-badge--safety';
      case 'direct_payment':
        return 'support-kind-badge support-kind-badge--payment';
    }
  }, []);

  const totalCasesCount = cases.length;
  const activeCasesCount = useMemo(
    () => cases.filter((c) => OPEN_STATUSES.includes(c.status)).length,
    [cases],
  );
  const awaitingUserCount = useMemo(
    () => cases.filter((c) => c.status === 'awaiting_user').length,
    [cases],
  );
  const closedCasesCount = useMemo(
    () => cases.filter((c) => CLOSED_STATUSES.includes(c.status)).length,
    [cases],
  );

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

  // ---------------------------------------------------------------------------
  // Listing
  // ---------------------------------------------------------------------------

  const statusParam = useMemo(() => {
    if (statusFilter === 'open') return OPEN_STATUSES;
    if (statusFilter === 'closed') return CLOSED_STATUSES;
    return undefined;
  }, [statusFilter]);

  const loadCases = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const kinds = TAB_KINDS[activeTab];
      const response = await helpResolutionApiClient.listCases(accessToken, {
        ...(kinds.length ? { kind: kinds } : {}),
        ...(statusParam ? { status: statusParam } : {}),
        ...(searchQuery.trim() ? { search: searchQuery.trim() } : {}),
        limit: 50,
      });
      setCases(response.items);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : (hr.loadFailed ?? tr('Could not load your cases.', 'تعذر تحميل قضاياك.')),
      );
      setCases([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeTab, statusParam, searchQuery, hr.loadFailed, isArabic]);

  // Typing in the search box should not fire a request per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => void loadCases(), searchQuery ? 300 : 0);
    return () => clearTimeout(handle);
  }, [loadCases, searchQuery]);

  const loadAvailability = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await helpResolutionApiClient.getAvailability(accessToken);
      setAvailability(response.items);
    } catch {
      // An availability failure must not block the list. The create form falls
      // back to treating unknown kinds as unavailable, which is the honest
      // reading of "we could not confirm you may open this".
      setAvailability([]);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadAvailability();
  }, [loadAvailability]);

  // ---------------------------------------------------------------------------
  // Deep links
  // ---------------------------------------------------------------------------
  // A historical link may point at a case that is not on the loaded page, so the
  // legacy id is resolved by the server rather than matched against `cases`.
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    const resolve = async () => {
      try {
        if (urlCaseId) {
          if (!cancelled) setSelectedCaseId(urlCaseId);
          return;
        }
        if (urlTicketId) {
          const found = await helpResolutionApiClient.getCaseBySupportTicket(
            accessToken,
            urlTicketId,
          );
          if (!cancelled) setSelectedCaseId(found.id);
          return;
        }
        if (urlDisputeId) {
          const found = await helpResolutionApiClient.getCaseByReservationDispute(
            accessToken,
            urlDisputeId,
          );
          if (!cancelled) setSelectedCaseId(found.id);
        }
      } catch {
        if (!cancelled) setSelectedCaseId(null);
      }
    };
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [accessToken, urlCaseId, urlTicketId, urlDisputeId]);

  const loadCaseFile = useCallback(
    async (caseId: string) => {
      if (!accessToken) return;
      setDetailLoading(true);
      try {
        setCaseFile(await helpResolutionApiClient.getCase(accessToken, caseId));
      } catch (err) {
        setCaseFile(null);
        setError(err instanceof Error ? err.message : null);
      } finally {
        setDetailLoading(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    if (!selectedCaseId) {
      setCaseFile(null);
      return;
    }
    void loadCaseFile(selectedCaseId);
  }, [selectedCaseId, loadCaseFile]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [caseFile]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleReplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !caseFile || !messageBody.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const attachmentUrls: string[] = [];
      // Only general support carries public attachments; the private evidence
      // control below is what the other kinds use.
      if (caseFile.case.kind === 'general_support') {
        for (const file of replyFiles.slice(0, 2)) {
          const { url } = await uploadFile(accessToken, file);
          attachmentUrls.push(toStoredAttachmentUrl(url));
        }
      }
      await helpResolutionApiClient.postMessage(accessToken, caseFile.case.id, {
        body: messageBody.trim(),
        ...(attachmentUrls.length ? { attachmentUrls } : {}),
      });
      setMessageBody('');
      setReplyFiles([]);
      await loadCaseFile(caseFile.case.id);
      void loadCases();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : (hr.messageFailed ?? tr('Could not send the message.', 'تعذر إرسال الرسالة.')),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddEvidence = async (file: File | undefined) => {
    if (!accessToken || !caseFile || !file) return;
    setSubmitting(true);
    setError(null);
    try {
      const uploaded = await uploadPrivateFile(accessToken, file);
      await helpResolutionApiClient.addEvidence(accessToken, caseFile.case.id, {
        uploadId: uploaded.filename,
        ...(evidenceLabel.trim() ? { label: evidenceLabel.trim() } : {}),
      });
      setEvidenceLabel('');
      await loadCaseFile(caseFile.case.id);
      void loadCases();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : (hr.evidenceFailed ?? tr('Could not attach the evidence.', 'تعذر إرفاق الدليل.')),
      );
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Evidence is fetched through the authenticated proxy, never linked directly.
   *
   * The API returns `/api/upload/private/:id` and nothing else — no bucket, no
   * object path — and that route re-authorises the caller against the case
   * before it mints a short-lived signed URL.
   */
  const handleOpenEvidence = async (uploadId: string) => {
    if (!accessToken) return;
    try {
      const url = await getPrivateFileOpenableUrl(accessToken, uploadId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setError(
        hr.evidenceOpenFailed ??
          tr('Could not open this file securely.', 'تعذر فتح هذا الملف بشكل آمن.'),
      );
    }
  };

  const handleEscalate = async () => {
    if (!accessToken || !caseFile) return;
    setSubmitting(true);
    setError(null);
    try {
      await helpResolutionApiClient.escalate(accessToken, caseFile.case.id, {});
      await loadCaseFile(caseFile.case.id);
      void loadCases();
    } catch (err) {
      setError(err instanceof Error ? err.message : null);
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Creation
  // ---------------------------------------------------------------------------

  const availabilityFor = (kind: CreatableKind): ResolutionCaseAvailability | undefined =>
    availability.find((entry) => entry.kind === kind);

  const selectedAvailability =
    createKind === 'reservation_dispute' ? undefined : availabilityFor(createKind);

  const eligibleSubjects = selectedAvailability?.eligibleSubjects ?? [];

  const needsSubject = createKind === 'need_job_dispute' || createKind === 'direct_payment';

  /**
   * Why a kind cannot be opened, in the reader's language.
   *
   * Keyed on the server's reason code rather than its English sentence: the
   * server decides availability, the dictionary decides wording, and an Arabic
   * reader is not handed an English explanation.
   */
  const unavailableMessage = (entry: ResolutionCaseAvailability | undefined): string | null => {
    if (!entry || entry.available) return null;
    if (entry.reasonCode === 'no_eligible_subject') {
      return (
        hr.unavailableNoEligibleSubject ??
        entry.message ??
        tr('This case type is not available to you.', 'هذا النوع من القضايا غير متاح لك.')
      );
    }
    return (
      hr.unavailableLifecycle ??
      entry.message ??
      tr('This case type is not available to you.', 'هذا النوع من القضايا غير متاح لك.')
    );
  };

  const resetCreateForm = useCallback(() => {
    setCreateSubject('');
    setCreateBody('');
    setCreateFiles([]);
    setCreateSubjectKey('');
    setCreateReason('other');
    setUnavailableNotice(null);
  }, []);

  const closeCreateModal = useCallback(() => {
    setShowCreateModal(false);
    resetCreateForm();
  }, [resetCreateForm]);

  useEffect(() => {
    if (!showCreateModal) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const dialog = createCaseDialogRef.current;
    const focusableSelector = [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const getFocusableElements = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter(
        (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
      );

    const initialTarget = getFocusableElements()[0] ?? dialog;
    initialTarget?.focus();

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCreateModal();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }

      const first = focusableElements[0]!;
      const last = focusableElements[focusableElements.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown);
      const focusTarget = previousFocusRef.current ?? createCaseButtonRef.current;
      requestAnimationFrame(() => focusTarget?.focus());
      previousFocusRef.current = null;
    };
  }, [closeCreateModal, showCreateModal]);

  const buildCreateBody = (): CreateResolutionCaseBody | null => {
    if (createKind === 'general_support') {
      return {
        kind: 'general_support',
        subject: createSubject.trim(),
        body: createBody.trim(),
        category: 'other',
      };
    }
    if (createKind === 'safety_report') {
      return {
        kind: 'safety_report',
        reason: createReason as 'other',
        description: createBody.trim(),
      };
    }
    const [subjectType, subjectId] = createSubjectKey.split('::');
    if (!subjectType || !subjectId) return null;
    if (createKind === 'need_job_dispute') {
      return {
        kind: 'need_job_dispute',
        subjectType: subjectType as 'need' | 'job_application',
        subjectId,
        reason: createReason as 'other',
        description: createBody.trim(),
      };
    }
    return {
      kind: 'direct_payment',
      subjectType: subjectType as 'need' | 'reservation',
      subjectId,
      reason: createReason as 'other',
      description: createBody.trim(),
    };
  };

  const handleCreateCaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnavailableNotice(null);
    if (!accessToken) return;

    // Reservation disputes open from the booking, because the same admin action
    // that decides them also settles the money held against that reservation.
    if (createKind === 'reservation_dispute') {
      router.push(buildLocalePath(locale, '/app/bookings'));
      closeCreateModal();
      return;
    }

    const blocked = unavailableMessage(selectedAvailability);
    if (blocked) {
      setUnavailableNotice(blocked);
      return;
    }

    const body = buildCreateBody();
    if (!body) return;
    if (createKind === 'general_support' && !createSubject.trim()) return;
    if (!createBody.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const attachmentUrls: string[] = [];
      if (createKind === 'general_support') {
        for (const file of createFiles.slice(0, 2)) {
          const { url } = await uploadFile(accessToken, file);
          attachmentUrls.push(toStoredAttachmentUrl(url));
        }
      }
      const evidenceUploadIds: string[] = [];
      if (createKind !== 'general_support') {
        for (const file of createFiles.slice(0, 2)) {
          const uploaded = await uploadPrivateFile(accessToken, file);
          evidenceUploadIds.push(uploaded.filename);
        }
      }

      const payload: CreateResolutionCaseBody =
        body.kind === 'general_support'
          ? { ...body, ...(attachmentUrls.length ? { attachmentUrls } : {}) }
          : { ...body, ...(evidenceUploadIds.length ? { evidenceUploadIds } : {}) };

      const created = await helpResolutionApiClient.createCase(accessToken, payload);
      closeCreateModal();
      setSelectedCaseId(created.id);
      void loadCases();
      void loadAvailability();
    } catch (err) {
      // The server distinguishes "you already have this open" from a generic
      // failure, and only the first one has a useful next step for the user.
      if (isApiClientError(err) && err.code === 'DUPLICATE_CASE') {
        setUnavailableNotice(
          hr.duplicateCase ??
            tr('You already have an open case about this.', 'لديك بالفعل قضية مفتوحة بخصوص هذا.'),
        );
      } else {
        setUnavailableNotice(
          err instanceof Error
            ? err.message
            : (hr.createFailed ?? tr('Could not create the case.', 'تعذر إنشاء القضية.')),
        );
      }
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

  const layoutClass = `support-layout${selectedCaseId ? ' support-layout--thread' : ''}`;
  const selectedCase = caseFile?.case ?? null;

  return (
    <main className="support-screen">
      <Container className="support-screen__container">
        <header className="support-screen__header" style={{ marginBottom: '1.25rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem',
            }}
          >
            <div>
              <h1 className="support-screen__title">
                {hr.title ?? tr('Help & Resolution Centre', 'مركز الدعم وحل النزاعات')}
              </h1>
              <p className="support-screen__intro" style={{ margin: '0.3rem 0 0' }}>
                {hr.intro ??
                  tr(
                    'Support tickets, marketplace disputes, payment issues and safety reports in one place.',
                    'تذاكر الدعم ونزاعات السوق ومشكلات الدفع وبلاغات السلامة في مكان واحد.',
                  )}
              </p>
            </div>
            <button
              ref={createCaseButtonRef}
              type="button"
              className="dashboard-primary-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              onClick={() => {
                setShowCreateModal(true);
                setUnavailableNotice(null);
              }}
            >
              <PlusCircle size={18} />
              {hr.newCase ?? tr('New case', 'قضية جديدة')}
            </button>
          </div>

          <div className="support-stats" style={{ marginTop: '1.25rem' }}>
            <div className="support-stat-card">
              <span className="support-stat-card__label">
                {hr.totalCases ?? tr('Total cases', 'إجمالي القضايا')}
              </span>
              <span className="support-stat-card__value">{totalCasesCount}</span>
            </div>
            <div className="support-stat-card support-stat-card--active">
              <span className="support-stat-card__label">
                {hr.activeCases ?? tr('Active cases', 'قضايا نشطة')}
              </span>
              <span className="support-stat-card__value">{activeCasesCount}</span>
            </div>
            <div className="support-stat-card support-stat-card--awaiting">
              <span className="support-stat-card__label">
                {hr.awaitingUserCases ?? tr('Awaiting response', 'في انتظار ردك')}
              </span>
              <span className="support-stat-card__value">{awaitingUserCount}</span>
            </div>
            <div className="support-stat-card support-stat-card--closed">
              <span className="support-stat-card__label">
                {hr.closedCases ?? tr('Closed cases', 'قضايا مغلقة')}
              </span>
              <span className="support-stat-card__value">{closedCasesCount}</span>
            </div>
          </div>

          <div className="dashboard-tabs" style={{ marginTop: '1rem' }}>
            {(
              [
                ['all', hr.allCases ?? tr('All cases', 'جميع القضايا')],
                ['support', hr.generalSupport ?? tr('General support', 'الدعم العام')],
                ['disputes', hr.marketplaceDisputes ?? tr('Marketplace disputes', 'نزاعات السوق')],
                ['safety', hr.safetyAndPayments ?? tr('Safety & payments', 'السلامة والمدفوعات')],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                className={`dashboard-tab ${activeTab === tab ? 'dashboard-tab--active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {error && (
          <p className="dashboard-error" style={{ marginBottom: '1rem' }}>
            {error}
          </p>
        )}

        {showCreateModal && (
          <div
            className="support-modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                closeCreateModal();
              }
            }}
          >
            <div
              ref={createCaseDialogRef}
              className="support-modal-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="hr-modal-title"
              tabIndex={-1}
            >
              <h3 id="hr-modal-title" style={{ margin: '0 0 1rem 0', fontSize: '1.2rem' }}>
                {hr.newCase ?? tr('New case', 'قضية جديدة')}
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
                role="alert"
              >
                {unavailableNotice}
              </div>
            )}

            <form onSubmit={(e) => void handleCreateCaseSubmit(e)} className="dashboard-form">
              <label className="dashboard-form-label-inline" htmlFor="hr-kind">
                {hr.categoryLabel ?? tr('What is this about?', 'ما موضوع القضية؟')}
              </label>
              <select
                id="hr-kind"
                className="dashboard-input"
                value={createKind}
                onChange={(e) => {
                  setCreateKind(e.target.value as CreatableKind);
                  setCreateSubjectKey('');
                  setUnavailableNotice(null);
                }}
              >
                <option value="general_support">{kindLabel('general_support')}</option>
                <option value="need_job_dispute">{kindLabel('need_job_dispute')}</option>
                <option value="reservation_dispute">{kindLabel('reservation_dispute')}</option>
                <option value="direct_payment">{kindLabel('direct_payment')}</option>
                <option value="safety_report">{kindLabel('safety_report')}</option>
              </select>

              {createKind === 'reservation_dispute' ? (
                <div
                  style={{
                    padding: '0.75rem',
                    background: 'rgba(255, 255, 255, 0.04)',
                    borderRadius: '8px',
                  }}
                >
                  <p className="dashboard-card-meta">
                    {hr.reservationDisputeHint ??
                      tr(
                        'Reservation disputes are opened from the booking itself.',
                        'تُفتح نزاعات الحجز من الحجز نفسه.',
                      )}
                  </p>
                </div>
              ) : (
                <>
                  {needsSubject && (
                    <>
                      <label className="dashboard-form-label-inline" htmlFor="hr-subject">
                        {hr.subjectLabel ?? tr('Which engagement?', 'أي ارتباط؟')}
                      </label>
                      {eligibleSubjects.length === 0 ? (
                        <p className="dashboard-card-meta" role="status">
                          {unavailableMessage(selectedAvailability) ??
                            hr.checkingAvailability ??
                            tr('Checking what you can open...', 'جارٍ التحقق...')}
                        </p>
                      ) : (
                        <select
                          id="hr-subject"
                          className="dashboard-input"
                          value={createSubjectKey}
                          onChange={(e) => setCreateSubjectKey(e.target.value)}
                          required
                        >
                          <option value="">—</option>
                          {eligibleSubjects.map((subject) => (
                            <option
                              key={`${subject.subjectType}::${subject.subjectId}`}
                              value={`${subject.subjectType}::${subject.subjectId}`}
                            >
                              {subject.label}
                              {subject.counterpartyName ? ` — ${subject.counterpartyName}` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </>
                  )}

                  {createKind === 'general_support' ? (
                    <input
                      type="text"
                      className="dashboard-input"
                      placeholder={hr.summaryLabel ?? tr('Subject', 'الموضوع')}
                      value={createSubject}
                      onChange={(e) => setCreateSubject(e.target.value)}
                      required
                    />
                  ) : (
                    <>
                      <label className="dashboard-form-label-inline" htmlFor="hr-reason">
                        {hr.reasonLabel ?? tr('Reason', 'السبب')}
                      </label>
                      <select
                        id="hr-reason"
                        className="dashboard-input"
                        value={createReason}
                        onChange={(e) => setCreateReason(e.target.value)}
                      >
                        {(createKind === 'need_job_dispute'
                          ? [
                              ['not_delivered', tr('Work not delivered', 'لم يُسلَّم العمل')],
                              ['partially_delivered', tr('Partially delivered', 'تسليم جزئي')],
                              ['quality', tr('Quality of work', 'جودة العمل')],
                              [
                                'unresponsive',
                                tr('Other party unresponsive', 'الطرف الآخر لا يرد'),
                              ],
                              ['scope_disagreement', tr('Scope disagreement', 'خلاف على النطاق')],
                              ['other', tr('Other', 'أخرى')],
                            ]
                          : createKind === 'direct_payment'
                            ? [
                                [
                                  'paid_not_acknowledged',
                                  tr('Paid but not acknowledged', 'دفعت ولم يُعترف'),
                                ],
                                ['wrong_amount', tr('Wrong amount', 'مبلغ خاطئ')],
                                [
                                  'payment_details_invalid',
                                  tr('Payment details did not work', 'بيانات الدفع لم تعمل'),
                                ],
                                [
                                  'refund_not_received',
                                  tr('Refund not received', 'لم يصل الاسترداد'),
                                ],
                                ['other', tr('Other', 'أخرى')],
                              ]
                            : [
                                ['harassment', tr('Harassment', 'تحرش أو إساءة')],
                                ['fraud', tr('Fraud', 'احتيال')],
                                [
                                  'off_platform_solicitation',
                                  tr('Off-platform solicitation', 'استدراج خارج المنصة'),
                                ],
                                ['impersonation', tr('Impersonation', 'انتحال هوية')],
                                ['unsafe_behaviour', tr('Unsafe behaviour', 'سلوك غير آمن')],
                                ['other', tr('Other', 'أخرى')],
                              ]
                        ).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </>
                  )}

                  <textarea
                    className="dashboard-input"
                    placeholder={hr.detailsLabel ?? tr('Details', 'التفاصيل')}
                    value={createBody}
                    onChange={(e) => setCreateBody(e.target.value)}
                    required
                    rows={4}
                  />
                  <div>
                    <label className="dashboard-form-label-inline" htmlFor="hr-files">
                      {d.upload ?? tr('Attachments', 'المرفقات')} (
                      {d.maxTwoImages ?? tr('max 2', 'حد أقصى 2')})
                    </label>
                    <input
                      id="hr-files"
                      type="file"
                      multiple
                      className="dashboard-input"
                      onChange={(e) => setCreateFiles(Array.from(e.target.files ?? []).slice(0, 2))}
                    />
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button type="submit" className="dashboard-primary-btn" disabled={submitting}>
                  {createKind === 'reservation_dispute'
                    ? (hr.goToBookings ?? tr('Go to bookings', 'الانتقال للحجوزات'))
                    : (hr.submit ?? tr('Submit case', 'إرسال القضية'))}
                </button>
                <button
                  type="button"
                  className="dashboard-secondary-btn"
                  onClick={closeCreateModal}
                >
                  {hr.cancel ?? d.cancel ?? tr('Cancel', 'إلغاء')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

        <div className={layoutClass}>
          <aside className="support-inbox" aria-label={hr.allCases ?? 'Cases'}>
            <div
              className="support-inbox__toolbar"
              style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
            >
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type="search"
                  className="dashboard-input"
                  placeholder={hr.searchPlaceholder ?? tr('Search cases...', 'البحث في القضايا...')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    fontSize: '0.85rem',
                    width: '100%',
                    paddingInlineEnd: searchQuery ? '2rem' : undefined,
                  }}
                  aria-label={hr.searchPlaceholder ?? 'Search cases'}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    style={{
                      position: 'absolute',
                      insetInlineEnd: '0.5rem',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'hsl(var(--muted-foreground))',
                      fontSize: '0.85rem',
                      padding: '0.2rem',
                    }}
                    aria-label={hr.clearSearch ?? tr('Clear search', 'مسح البحث')}
                  >
                    ✕
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {(
                  [
                    ['all', hr.statusAll ?? tr('All', 'الكل')],
                    ['open', hr.statusActive ?? tr('Active', 'نشط')],
                    ['closed', hr.statusClosed ?? tr('Closed', 'مغلق')],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`dashboard-secondary-btn ${statusFilter === value ? 'dashboard-primary-btn' : ''}`}
                    style={{ flex: 1, padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                    onClick={() => setStatusFilter(value)}
                    aria-pressed={statusFilter === value}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="support-inbox__list">
              {loading ? (
                <p className="support-empty">{d.loading ?? 'Loading...'}</p>
              ) : cases.length === 0 ? (
                <p className="support-empty">
                  {hr.noCases ?? tr('No matching cases found.', 'لم يتم العثور على قضايا مطابقة.')}
                </p>
              ) : (
                cases.map((item) => {
                  const isActive = selectedCaseId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`support-ticket-row ${isActive ? 'support-ticket-row--active' : ''}`}
                      onClick={() => setSelectedCaseId(item.id)}
                      aria-current={isActive}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}
                      >
                        <span className="support-ticket-row__subject">{item.title}</span>
                        <span className={kindBadgeClass(item.kind)}>
                          {kindLabel(item.kind)}
                        </span>
                      </div>
                      <span className="support-ticket-row__meta">
                        <span
                          className={statusPillInfo(item.engineStatus ?? item.status).className}
                        >
                          {statusPillInfo(item.engineStatus ?? item.status).label}
                        </span>
                        <span>{item.referenceCode}</span>
                        {item.kind !== 'safety_report' && item.counterpartyName && (
                          <span className="support-pill">{item.counterpartyName}</span>
                        )}
                        <span>{new Date(item.lastActivityAt).toLocaleDateString(locale)}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <section className="support-thread" aria-live="polite">
            {!selectedCaseId ? (
              <div className="support-thread__placeholder">
                <div className="support-thread__placeholder-icon" aria-hidden>
                  <Inbox size={28} strokeWidth={1.75} />
                </div>
                <p>
                  {hr.selectCase ??
                    tr(
                      'Select a case to see its thread and details.',
                      'اختر قضية لعرض المحادثة والتفاصيل.',
                    )}
                </p>
              </div>
            ) : detailLoading || !caseFile || !selectedCase ? (
              <p className="support-empty">{d.loading ?? 'Loading...'}</p>
            ) : (
              <>
                <div className="support-thread__header">
                  <button
                    type="button"
                    className="support-thread__back"
                    onClick={() => setSelectedCaseId(null)}
                    aria-label={hr.backToList ?? d.back ?? 'Back'}
                  >
                    <ChevronLeft size={18} className="support-thread__back-icon" aria-hidden />
                    {hr.backToList ?? d.back ?? 'Back'}
                  </button>
                  <div className="support-thread__header-body">
                    <h2>{selectedCase.title}</h2>
                    <div className="support-thread__header-chips">
                      <span className={statusPillInfo(selectedCase.status).className}>
                        {statusPillInfo(selectedCase.status).label}
                      </span>
                      {selectedCase.engineStatus &&
                        selectedCase.engineStatus !== selectedCase.status && (
                          <span className={statusPillInfo(selectedCase.engineStatus).className}>
                            {selectedCase.kind === 'reservation_dispute'
                              ? tr('Reservation: ', 'الحجز: ')
                              : tr('Support: ', 'الدعم: ')}
                            {statusPillInfo(selectedCase.engineStatus).label}
                          </span>
                        )}
                      <span className={kindBadgeClass(selectedCase.kind)}>
                        {kindLabel(selectedCase.kind)}
                      </span>
                      <span className="support-pill">{selectedCase.referenceCode}</span>
                      {selectedCase.kind !== 'safety_report' && selectedCase.counterpartyName && (
                        <span className="support-pill">{selectedCase.counterpartyName}</span>
                      )}
                    </div>
                  </div>
                  {caseFile.capabilities.canEscalate && (
                    <button
                      type="button"
                      className="dashboard-secondary-btn"
                      style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                      onClick={() => void handleEscalate()}
                      disabled={submitting}
                    >
                      <ShieldAlert size={16} aria-hidden />
                      {hr.escalate ?? tr('Escalate to admin', 'تصعيد إلى الإدارة')}
                    </button>
                  )}
                </div>

                <div className="support-scroll" role="region" aria-label={selectedCase.title}>
                  {caseFile.description && (
                    <div
                      style={{
                        padding: '1rem',
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: '8px',
                        marginBottom: '1.25rem',
                      }}
                    >
                      <p className="dashboard-card-meta" style={{ margin: 0 }}>
                        {caseFile.description}
                      </p>
                    </div>
                  )}

                  {caseFile.resolution.outcome && (
                    <div className="support-thread__readonly" style={{ marginBottom: '1.25rem' }}>
                      <p className="support-thread__readonly-title">
                        {tr('Resolution', 'القرار')}: {outcomeLabel(caseFile.resolution.outcome)}
                      </p>
                      {caseFile.resolution.notes && (
                        <p className="support-thread__readonly-body">{caseFile.resolution.notes}</p>
                      )}
                    </div>
                  )}

                  {caseFile.capabilities.canAddEvidence || caseFile.evidence.length > 0 ? (
                    <div style={{ marginBottom: '1.5rem' }}>
                      <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>
                        {hr.evidenceTitle ?? tr('Evidence files', 'ملفات الأدلة')} (
                        {caseFile.evidence.length})
                      </h5>
                      {caseFile.evidence.length === 0 ? (
                        <p className="dashboard-card-meta">
                          {hr.noEvidence ??
                            tr('No evidence attached yet.', 'لا توجد أدلة مرفقة حتى الآن.')}
                        </p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                          {caseFile.evidence.map((ev) => (
                            <div
                              key={ev.id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '0.5rem',
                                background: 'rgba(0, 0, 0, 0.2)',
                                padding: '0.4rem 0.8rem',
                                borderRadius: '6px',
                              }}
                            >
                              <span style={{ fontSize: '0.85rem', wordBreak: 'break-word' }}>
                                {ev.label ?? ev.uploadId}
                              </span>
                              <button
                                type="button"
                                className="dashboard-secondary-btn"
                                style={{
                                  fontSize: '0.75rem',
                                  padding: '0.2rem 0.5rem',
                                  whiteSpace: 'nowrap',
                                }}
                                onClick={() => void handleOpenEvidence(ev.uploadId)}
                              >
                                {hr.openFile ?? tr('Open file', 'فتح الملف')}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {caseFile.capabilities.canAddEvidence && (
                        <div
                          style={{
                            marginTop: '0.75rem',
                            display: 'flex',
                            gap: '0.5rem',
                            flexWrap: 'wrap',
                          }}
                        >
                          <input
                            className="dashboard-input"
                            style={{ flex: '1 1 12rem' }}
                            placeholder={
                              hr.evidenceLabelPlaceholder ?? tr('Evidence label', 'وصف الدليل')
                            }
                            value={evidenceLabel}
                            onChange={(e) => setEvidenceLabel(e.target.value)}
                            aria-label={hr.evidenceLabelPlaceholder ?? 'Evidence label'}
                          />
                          <input
                            type="file"
                            className="dashboard-input"
                            style={{ width: 'auto' }}
                            disabled={submitting}
                            onChange={(e) => void handleAddEvidence(e.target.files?.[0])}
                            aria-label={hr.evidenceTitle ?? 'Attach evidence'}
                          />
                        </div>
                      )}
                    </div>
                  ) : null}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {caseFile.messages.map((m) => (
                      <div
                        key={m.id}
                        className={`support-bubble ${m.isStaff ? 'support-bubble--staff' : 'support-bubble--user'}`}
                      >
                        <span className="support-bubble__label">
                          {m.isStaff
                            ? (sp.staffLabel ?? tr('Support team', 'فريق الدعم'))
                            : (m.authorName ?? sp.youLabel ?? tr('You', 'أنت'))}
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
                          {new Date(m.createdAt).toLocaleString(locale)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div ref={messagesEndRef} />
                </div>

                <div className="support-composer" style={{ marginTop: '1rem' }}>
                  {caseFile.capabilities.canPostMessage ? (
                    <form onSubmit={(e) => void handleReplySubmit(e)}>
                      <textarea
                        value={messageBody}
                        onChange={(e) => setMessageBody(e.target.value)}
                        placeholder={
                          hr.composerPlaceholder ??
                          tr('Add a message to this case...', 'أضف رسالة إلى هذه القضية...')
                        }
                        rows={3}
                        maxLength={10000}
                        aria-label={hr.composerPlaceholder ?? 'Message'}
                      />
                      <div className="support-composer__row">
                        {selectedCase.kind === 'general_support' && (
                          <div className="support-composer__files">
                            <label className="dashboard-form-label-inline" htmlFor="hr-reply-files">
                              {d.upload ?? tr('Attachments', 'المرفقات')} —{' '}
                              {d.maxTwoImages ?? tr('max 2', 'حد أقصى 2')}
                            </label>
                            <input
                              id="hr-reply-files"
                              type="file"
                              accept="image/*"
                              multiple
                              className="dashboard-input"
                              onChange={(e) =>
                                setReplyFiles(Array.from(e.target.files ?? []).slice(0, 2))
                              }
                            />
                          </div>
                        )}
                        <button
                          type="submit"
                          className="support-composer__submit"
                          disabled={submitting || !messageBody.trim()}
                        >
                          {hr.postMessage ?? d.reply ?? tr('Send', 'إرسال')}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p className="support-empty">
                      {hr.caseClosedNotice ??
                        sp.ticketReadOnlyBody ??
                        tr(
                          'This case is closed. Open a new case if you still need help.',
                          'هذه القضية مغلقة. افتح قضية جديدة إذا كنت لا تزال بحاجة إلى مساعدة.',
                        )}
                    </p>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </Container>
    </main>
  );
};
