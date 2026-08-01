// ---------------------------------------------------------------------------
// Wave 2I — the frontend's half of the unified centre.
// ---------------------------------------------------------------------------
// The Antigravity screen already had its own coverage (help-resolution.test.ts).
// What is new is that the screen no longer decides anything: filtering, paging,
// availability and permissions all come from the server. These tests pin the
// contract between the two — the request the client sends, the error codes it
// must be able to tell apart, and the deep links that carry a user to a case.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import type { ResolutionCaseAvailability, ResolutionCaseSummary } from '@mohandishub/shared';
import { NOTIFICATION_NAVIGATION_MAP } from '@mohandishub/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getNotificationTargetHref } from '@/components/app/notification-display';
import { isApiClientError } from '@/lib/auth/client';
import { helpResolutionApiClient } from '@/lib/help-resolution/client';
import { arDictionary } from '@/lib/i18n/dictionaries/ar';
import { enDictionary } from '@/lib/i18n/dictionaries/en';

const CASE: ResolutionCaseSummary = {
  id: 'case-1',
  referenceCode: 'MH-000042',
  kind: 'need_job_dispute',
  status: 'under_review',
  engineStatus: null,
  title: 'Work not delivered: Structural survey',
  openedBy: 'user-1',
  counterpartyId: 'user-2',
  counterpartyName: 'Nour',
  subjectType: 'need',
  subjectId: 'need-1',
  reasonCode: 'not_delivered',
  escalatedAt: null,
  assignedAdminId: null,
  messageCount: 3,
  evidenceCount: 1,
  lastActivityAt: '2026-08-01T10:00:00.000Z',
  createdAt: '2026-07-30T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
  supportTicketId: null,
  reservationDisputeId: null,
  viewerRole: 'opener',
};

const okResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ ok: true, data }),
});

const errorResponse = (status: number, code: string, message: string) => ({
  ok: false,
  status,
  json: () => Promise.resolve({ ok: false, error: { code, message } }),
});

describe('unified case listing is a server query, not a browser filter', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends tab, status and search as query parameters', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okResponse({ items: [CASE], total: 1, page: 1, limit: 50, totalPages: 1 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await helpResolutionApiClient.listCases('token-123', {
      kind: ['reservation_dispute', 'need_job_dispute'],
      status: ['open', 'awaiting_user', 'under_review'],
      search: 'survey',
      limit: 50,
    });

    expect(result.items).toHaveLength(1);
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/api/help-resolution/cases?');
    expect(url).toContain('kind=reservation_dispute%2Cneed_job_dispute');
    expect(url).toContain('status=open%2Cawaiting_user%2Cunder_review');
    expect(url).toContain('search=survey');
    expect(url).toContain('limit=50');
  });

  it('resolves a historical ticket link through the server, not through the loaded page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ...CASE, supportTicketId: 'tkt-9' }));
    vi.stubGlobal('fetch', fetchMock);

    const found = await helpResolutionApiClient.getCaseBySupportTicket('token-123', 'tkt-9');

    expect(found.supportTicketId).toBe('tkt-9');
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'http://localhost:4000/api/help-resolution/cases/by-support-ticket/tkt-9',
    );
  });

  it('resolves a historical dispute link the same way', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(CASE));
    vi.stubGlobal('fetch', fetchMock);

    await helpResolutionApiClient.getCaseByReservationDispute('token-123', 'dsp-7');

    expect(fetchMock.mock.calls[0]![0]).toBe(
      'http://localhost:4000/api/help-resolution/cases/by-reservation-dispute/dsp-7',
    );
  });

  /**
   * The centre reacts differently to a duplicate, an unsupported lifecycle and
   * a closed case. Flattening errors to a message string would leave that
   * decision resting on English prose.
   */
  it('preserves the server error code so the UI can react to it', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          errorResponse(409, 'DUPLICATE_CASE', 'You already have an open case about this.'),
        ),
    );

    await expect(
      helpResolutionApiClient.createCase('token-123', {
        kind: 'need_job_dispute',
        subjectType: 'need',
        subjectId: 'need-1',
        reason: 'not_delivered',
        description: 'Nothing delivered.',
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isApiClientError(error) && error.code === 'DUPLICATE_CASE',
    );
  });

  it('surfaces the honest unavailability reason rather than inventing one', async () => {
    const availability: ResolutionCaseAvailability[] = [
      {
        kind: 'need_job_dispute',
        available: false,
        reasonCode: 'no_eligible_subject',
        message: 'You have no activated need or accepted job engagement to dispute.',
        eligibleSubjects: [],
      },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ items: availability })));

    const response = await helpResolutionApiClient.getAvailability('token-123');
    const entry = response.items[0]!;

    expect(entry.available).toBe(false);
    expect(entry.reasonCode).toBe('no_eligible_subject');
    // The UI keys its wording on the code so translation is possible.
    expect(enDictionary.helpResolutionPage.unavailableNoEligibleSubject).toBeTruthy();
    expect(arDictionary.helpResolutionPage.unavailableNoEligibleSubject).toBeTruthy();
  });

  it('never asks for a file by storage path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        case: CASE,
        description: null,
        resolution: { outcome: null, notes: null, resolvedBy: null, resolvedAt: null },
        escalation: { escalatedAt: null, escalatedBy: null, reason: null },
        messages: [],
        evidence: [
          {
            id: 'ev-1',
            caseId: 'case-1',
            uploadedBy: 'user-1',
            uploadId: 'upl-1',
            fileUrl: '/api/upload/private/upl-1',
            label: 'Delivery emails',
            createdAt: '2026-08-01T10:00:00.000Z',
          },
        ],
        timeline: [],
        capabilities: {
          canPostMessage: true,
          canAddEvidence: true,
          canEscalate: true,
          canResolve: false,
          resolutionHandledBy: null,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const file = await helpResolutionApiClient.getCase('token-123', 'case-1');
    const evidence = file.evidence[0]!;

    expect(evidence.fileUrl).toBe('/api/upload/private/upl-1');
    expect(evidence.fileUrl).not.toContain('storage/v1/object');
    expect(evidence.fileUrl).not.toContain('verification-docs');
  });
});

describe('case notification deep links', () => {
  it('sends every case event to the centre with the case id', () => {
    const types = [
      'resolution_case_opened',
      'resolution_case_message',
      'resolution_case_escalated',
      'resolution_case_status_changed',
      'resolution_case_resolved',
    ] as const;

    for (const type of types) {
      expect(NOTIFICATION_NAVIGATION_MAP[type]).toBe('/app/help-resolution');
      expect(getNotificationTargetHref(type, { caseId: 'case-1' }, 'en')).toBe(
        '/en/app/help-resolution?caseId=case-1',
      );
      expect(getNotificationTargetHref(type, { caseId: 'case-1' }, 'ar')).toBe(
        '/ar/app/help-resolution?caseId=case-1',
      );
    }
  });

  it('still routes reservation dispute events to the booking they belong to', () => {
    expect(
      getNotificationTargetHref('reservation_dispute_resolved', { reservationId: 'res-1' }, 'en'),
    ).toBe('/en/app/bookings?reservation=res-1');
  });
});

describe('mobile behaviour', () => {
  const screenSource = readFileSync(
    new URL('../components/app/help-resolution-screen.tsx', import.meta.url),
    'utf8',
  );
  const screenCss = readFileSync(
    new URL('../components/app/case-thread.css', import.meta.url),
    'utf8',
  );

  /**
   * The screen was written against the `support-*` classes but imported only
   * dashboard.css, and the component that used to import the case-thread CSS is
   * no longer routed anywhere — so on a phone the list and the thread rendered
   * stacked and unstyled instead of as a master/detail pair.
   */
  it('loads the stylesheet that defines the classes it uses', () => {
    expect(screenSource).toContain("import './case-thread.css'");
    expect(screenSource).not.toContain("import './support-screen.css'");
  });

  it('keeps authoritative legacy status and resolution detail visible', () => {
    expect(screenSource).toContain('item.engineStatus ?? item.status');
    expect(screenSource).toContain('selectedCase.engineStatus');
    expect(screenSource).toContain('caseFile.resolution.outcome');
    expect(screenSource).toContain('caseFile.resolution.notes');
  });

  it('collapses to one column and swaps list for thread under 768px', () => {
    const mobileBlock = screenCss.slice(screenCss.indexOf('@media (max-width: 768px)'));
    expect(mobileBlock).toContain('grid-template-columns: 1fr');
    expect(mobileBlock).toContain('.support-layout:not(.support-layout--thread) .support-thread');
    expect(mobileBlock).toContain('.support-layout.support-layout--thread .support-inbox');
    expect(mobileBlock).toContain('.support-thread__back');
  });

  it('drives that swap from the selected case, and offers a way back', () => {
    expect(screenSource).toContain(
      "`support-layout${selectedCaseId ? ' support-layout--thread' : ''}`",
    );
    expect(screenSource).toContain('support-thread__back');
    expect(screenSource).toContain('setSelectedCaseId(null)');
  });
});

describe('Arabic and English integration', () => {
  it('translates every help & resolution string in both dictionaries', () => {
    const en = enDictionary.helpResolutionPage as Record<string, string>;
    const ar = arDictionary.helpResolutionPage as Record<string, string>;

    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
    for (const key of Object.keys(en)) {
      expect(ar[key], `missing Arabic value for ${key}`).toBeTruthy();
      // A key left in English in the Arabic dictionary reads as a bug to a
      // reader, so require at least one Arabic-script character.
      expect(/[؀-ۿ]/.test(ar[key]!), `${key} is not translated`).toBe(true);
    }
  });

  it('translates the case notification templates in both dictionaries', () => {
    const enTemplates = enDictionary.notificationTemplates as Record<
      string,
      { title: string; message: string }
    >;
    const arTemplates = arDictionary.notificationTemplates as Record<
      string,
      { title: string; message: string }
    >;

    for (const type of [
      'resolution_case_opened',
      'resolution_case_message',
      'resolution_case_escalated',
      'resolution_case_status_changed',
      'resolution_case_resolved',
    ]) {
      expect(enTemplates[type]?.title).toBeTruthy();
      expect(arTemplates[type]?.title).toBeTruthy();
      expect(/[؀-ۿ]/.test(arTemplates[type]!.message)).toBe(true);
      // The reference code is interpolated from the payload in both languages.
      expect(enTemplates[type]!.message).toContain('{referenceCode}');
      expect(arTemplates[type]!.message).toContain('{referenceCode}');
    }
  });

  it('gives the merged centre a navigation label in both languages', () => {
    expect(enDictionary.nav.helpResolution).toBeTruthy();
    expect(arDictionary.nav.helpResolution).toBeTruthy();
    expect(/[؀-ۿ]/.test(arDictionary.nav.helpResolution as string)).toBe(true);
  });
});
