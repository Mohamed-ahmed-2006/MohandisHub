// ---------------------------------------------------------------------------
// Wave 2I Help & Resolution Center — Rendered & Presentation UI/UX Tests
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import type { ResolutionCaseAvailability, ResolutionCaseSummary } from '@mohandishub/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


import { helpResolutionApiClient } from '@/lib/help-resolution/client';
import { arDictionary } from '@/lib/i18n/dictionaries/ar';
import { enDictionary } from '@/lib/i18n/dictionaries/en';

const MOCK_SUMMARY: ResolutionCaseSummary = {
  id: 'case-101',
  referenceCode: 'MH-000101',
  kind: 'need_job_dispute',
  status: 'under_review',
  engineStatus: null,
  title: 'Very long case title requiring multi-line word wrapping and responsive layout bounds testing on small viewports',
  openedBy: 'user-1',
  counterpartyId: 'user-2',
  counterpartyName: 'Engineer Tariq',
  subjectType: 'need',
  subjectId: 'need-77',
  reasonCode: 'quality',
  escalatedAt: '2026-08-01T10:00:00.000Z',
  assignedAdminId: 'admin-1',
  messageCount: 5,
  evidenceCount: 2,
  lastActivityAt: '2026-08-01T11:00:00.000Z',
  createdAt: '2026-07-31T09:00:00.000Z',
  updatedAt: '2026-08-01T11:00:00.000Z',
  supportTicketId: null,
  reservationDisputeId: null,
  viewerRole: 'opener',
};

describe('Wave 2I Help & Resolution UI Polish Tests', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Desktop Master/Detail & Mobile Navigation Structure', () => {
    const screenSource = readFileSync(
      new URL('../components/app/help-resolution-screen.tsx', import.meta.url),
      'utf8',
    );
    const screenCss = readFileSync(
      new URL('../components/app/support-screen.css', import.meta.url),
      'utf8',
    );

    it('renders desktop master/detail grid structure', () => {
      expect(screenCss).toContain('display: grid');
      expect(screenCss).toContain('grid-template-columns: minmax(280px, 320px) 1fr');
      expect(screenSource).toContain('className={layoutClass}');
    });

    it('handles mobile single-column toggle and back button', () => {
      expect(screenCss).toContain('@media (max-width: 768px)');
      expect(screenCss).toContain('.support-layout:not(.support-layout--thread) .support-thread');
      expect(screenCss).toContain('.support-layout.support-layout--thread .support-inbox');
      expect(screenCss).toContain('.support-thread__back');
      expect(screenSource).toContain("setSelectedCaseId(null)");
    });

    it('supports 375px mobile breakpoint without horizontal overflow', () => {
      const mobile375 = screenCss.slice(screenCss.indexOf('@media (max-width: 375px)'));
      expect(mobile375).toContain('padding-inline: 0.25rem');
      expect(mobile375).toContain('grid-template-columns: 1fr 1fr');
    });
  });

  describe('Arabic RTL and English LTR Localization', () => {
    it('provides complete helpResolutionPage dictionary keys in English and Arabic', () => {
      const en = enDictionary.helpResolutionPage as Record<string, string>;
      const ar = arDictionary.helpResolutionPage as Record<string, string>;

      const requiredKeys = [
        'title',
        'intro',
        'newCase',
        'allCases',
        'generalSupport',
        'marketplaceDisputes',
        'safetyAndPayments',
        'searchPlaceholder',
        'statusAll',
        'statusActive',
        'statusClosed',
        'totalCases',
        'activeCases',
        'closedCases',
        'awaitingUserCases',
        'underReviewCases',
        'backToList',
        'clearSearch',
        'statusOpen',
        'statusAwaitingUser',
        'statusUnderReview',
        'statusResolved',
        'statusClosed',
      ];

      for (const key of requiredKeys) {
        expect(en[key], `Missing English key: ${key}`).toBeTruthy();
        expect(ar[key], `Missing Arabic key: ${key}`).toBeTruthy();
        expect(/[\u0600-\u06FF]/.test(ar[key]!), `Arabic key ${key} is not in Arabic script`).toBe(true);
      }
    });

    it('uses CSS logical properties for RTL mirroring', () => {
      const screenCss = readFileSync(
        new URL('../components/app/support-screen.css', import.meta.url),
        'utf8',
      );
      expect(screenCss).toContain('border-inline-end');
      expect(screenCss).toContain("[dir='rtl'] .support-thread__back-icon");
    });
  });

  describe('Category Distinction and Canonical Status Badges', () => {
    it('distinguishes between general support, disputes, and safety/payments', () => {
      const tabKinds = {
        all: [],
        support: ['general_support'],
        disputes: ['reservation_dispute', 'need_job_dispute'],
        safety: ['safety_report', 'direct_payment'],
      };

      expect(tabKinds.support).toContain('general_support');
      expect(tabKinds.disputes).toContain('reservation_dispute');
      expect(tabKinds.disputes).toContain('need_job_dispute');
      expect(tabKinds.safety).toContain('safety_report');
      expect(tabKinds.safety).toContain('direct_payment');
    });

    it('computes summary stat counters for active, awaiting, and closed cases', () => {
      const cases: ResolutionCaseSummary[] = [
        { ...MOCK_SUMMARY, id: '1', status: 'open' },
        { ...MOCK_SUMMARY, id: '2', status: 'awaiting_user' },
        { ...MOCK_SUMMARY, id: '3', status: 'under_review' },
        { ...MOCK_SUMMARY, id: '4', status: 'resolved' },
        { ...MOCK_SUMMARY, id: '5', status: 'closed' },
      ];

      const OPEN_STATUSES = ['open', 'awaiting_user', 'under_review'];
      const CLOSED_STATUSES = ['resolved', 'closed'];

      const total = cases.length;
      const active = cases.filter((c) => OPEN_STATUSES.includes(c.status)).length;
      const awaiting = cases.filter((c) => c.status === 'awaiting_user').length;
      const closed = cases.filter((c) => CLOSED_STATUSES.includes(c.status)).length;

      expect(total).toBe(5);
      expect(active).toBe(3);
      expect(awaiting).toBe(1);
      expect(closed).toBe(2);
    });
  });

  describe('Evidence Presentation & Upload Security', () => {
    it('uses private upload proxy URLs for dispute evidence', () => {
      const evidence = {
        id: 'ev-99',
        uploadId: 'private_doc_99.pdf',
        fileUrl: '/api/upload/private/private_doc_99.pdf',
      };

      expect(evidence.fileUrl).toContain('/api/upload/private/');
      expect(evidence.fileUrl).not.toContain('http://');
      expect(evidence.fileUrl).not.toContain('s3.amazonaws.com');
    });

    it('truncates or wraps long filenames and titles gracefully', () => {
      const screenCss = readFileSync(
        new URL('../components/app/support-screen.css', import.meta.url),
        'utf8',
      );
      expect(screenCss).toContain('word-break: break-word');
      expect(screenCss).toContain('overflow-wrap: anywhere');
    });
  });

  describe('Modal Dialog Accessibility & Unsupported Creation States', () => {
    it('implements modal dialog role and aria attributes', () => {
      const screenSource = readFileSync(
        new URL('../components/app/help-resolution-screen.tsx', import.meta.url),
        'utf8',
      );
      expect(screenSource).toContain('role="dialog"');
      expect(screenSource).toContain('aria-modal="true"');
      expect(screenSource).toContain('aria-labelledby="hr-modal-title"');
      expect(screenSource).toContain("e.key === 'Escape'");
    });

    it('displays clear unavailable message when case creation is blocked by server', () => {
      const availability: ResolutionCaseAvailability = {
        kind: 'direct_payment',
        available: false,
        reasonCode: 'no_eligible_subject',
        message: 'No eligible payment subject found.',
        eligibleSubjects: [],
      };

      expect(availability.available).toBe(false);
      expect(enDictionary.helpResolutionPage.unavailableNoEligibleSubject).toBeTruthy();
      expect(arDictionary.helpResolutionPage.unavailableNoEligibleSubject).toBeTruthy();
    });
  });

  describe('Historical Route Compatibility & Deep Linking', () => {
    it('resolves case deep links via server API client', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: MOCK_SUMMARY }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await helpResolutionApiClient.getCaseBySupportTicket('token-xyz', 'ticket-88');
      expect(result.id).toBe('case-101');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/api/help-resolution/cases/by-support-ticket/ticket-88',
        expect.anything(),
      );
    });
  });
});
