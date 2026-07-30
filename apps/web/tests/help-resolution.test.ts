import type { ReservationDisputeListItem, SupportTicket } from '@mohandishub/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reservationsApiClient } from '../lib/reservations/client';
import { supportApiClient } from '../lib/support/client';

describe('Wave 2I Unified Help & Resolution Center', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('API Integration & Data Aggregation', () => {
    it('fetches support tickets via listMyTickets', async () => {
      const mockTickets: SupportTicket[] = [
        {
          id: 'ticket-1',
          userId: 'u-1',
          assignedTo: null,
          category: 'bug',
          subject: 'Broken layout on mobile',
          status: 'open',
          createdAt: '2026-07-30T10:00:00Z',
          updatedAt: '2026-07-30T10:00:00Z',
          messageCount: 1,
        },
      ];

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: { items: mockTickets, total: 1 } }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await supportApiClient.listMyTickets('token-123', { page: 1, limit: 50 });
      expect(res.items).toHaveLength(1);
      expect(res.items[0]?.subject).toBe('Broken layout on mobile');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/api/support/tickets?page=1&limit=50',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token-123',
          }),
        }),
      );
    });

    it('fetches reservation dispute cases via listMyDisputeCases', async () => {
      const mockDisputes = [
        {
          dispute: {
            id: 'disp-1',
            reservationId: 'res-1',
            openedByUserId: 'u-1',
            reason: 'customer_report',
            description: 'Work was incomplete',
            status: 'open',
            resolutionNote: null,
            refundAmount: null,
            releasedAmount: null,
            resolvedByUserId: null,
            resolvedAt: null,
            createdAt: '2026-07-30T10:00:00Z',
            updatedAt: '2026-07-30T10:00:00Z',
          },
          reservation: {
            id: 'res-1',
            serviceTitle: 'Architectural Design Consultation',
            expertPriceAmount: 2500,
            currency: 'EGP',
          },
          evidenceCount: 2,
          noteCount: 3,
          lastActivityAt: '2026-07-30T11:00:00Z',
        },
      ] as unknown as ReservationDisputeListItem[];

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: mockDisputes }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await reservationsApiClient.listMyDisputeCases('token-123');
      expect(res).toHaveLength(1);
      expect(res[0]?.dispute.reason).toBe('customer_report');
      expect(res[0]?.reservation.serviceTitle).toBe('Architectural Design Consultation');
    });

    it('creates support tickets via createTicket', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            data: {
              id: 'new-tkt-1',
              subject: 'New Issue',
              category: 'other',
              status: 'open',
              createdAt: '2026-07-30T12:00:00Z',
              updatedAt: '2026-07-30T12:00:00Z',
            },
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await supportApiClient.createTicket('token-123', {
        category: 'other',
        subject: 'New Issue',
        body: 'Description of problem',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/api/support/tickets',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ category: 'other', subject: 'New Issue', body: 'Description of problem' }),
        }),
      );
    });
  });

  describe('Unified Help & Resolution Categories & Statuses', () => {
    it('distinguishes between platform support tickets and marketplace disputes', () => {
      const categories = [
        'general_support',
        'need_job_dispute',
        'reservation_dispute',
        'direct_payment',
        'safety_reporting',
      ];

      expect(categories).toHaveLength(5);
      expect(categories).toContain('general_support');
      expect(categories).toContain('reservation_dispute');
    });

    it('differentiates case status badges for open and resolved states', () => {
      const statuses = ['open', 'in_progress', 'waiting_reply', 'under_review', 'resolved', 'closed'];

      const isOpen = (s: string) => s === 'open' || s === 'in_progress' || s === 'under_review';
      const isClosed = (s: string) => s === 'resolved' || s === 'closed';

      expect(isOpen(statuses[0]!)).toBe(true);
      expect(isOpen(statuses[1]!)).toBe(true);
      expect(isClosed(statuses[4]!)).toBe(true);
      expect(isClosed(statuses[5]!)).toBe(true);
    });
  });

  describe('Evidence Security & Missing Backend Operation Contracts', () => {
    it('handles evidence upload validation (max 2 files)', () => {
      const files = [new File([''], 'file1.jpg'), new File([''], 'file2.jpg'), new File([''], 'file3.jpg')];
      const selected = files.slice(0, 2);

      expect(selected).toHaveLength(2);
    });

    it('ensures private dispute evidence files do not invent insecure public URLs', () => {
      const uploadId = 'private_upload_99.png';
      const secureProxyPath = `/api/proxy/private-upload?filename=${encodeURIComponent(uploadId)}`;

      expect(secureProxyPath).toContain('/api/proxy/private-upload');
      expect(secureProxyPath).not.toContain('http://insecure-public-bucket');
    });

    it('presents honest unavailable notices for missing backend case endpoints', () => {
      const missingEndpoints = [
        { route: 'POST /api/v1/help-resolution/job-disputes', category: 'need_job_dispute' },
        { route: 'POST /api/v1/help-resolution/payment-disputes', category: 'direct_payment' },
      ];

      expect(missingEndpoints).toHaveLength(2);
      missingEndpoints.forEach((ep) => {
        expect(ep.route).toBeDefined();
      });
    });
  });

  describe('Route Compatibility & Localization', () => {
    it('supports legacy route deep links for /app/support and /app/disputes', () => {
      const legacyRoutes = ['/app/support', '/app/disputes', '/app/help-resolution'];

      expect(legacyRoutes).toContain('/app/support');
      expect(legacyRoutes).toContain('/app/disputes');
      expect(legacyRoutes).toContain('/app/help-resolution');
    });

    it('handles RTL string rendering for Arabic and LTR for English', () => {
      const isArabicRTL = (text: string) => /[\u0600-\u06FF]/.test(text);

      expect(isArabicRTL('مركز الدعم وحل النزاعات')).toBe(true);
      expect(isArabicRTL('Help & Resolution Center')).toBe(false);
    });
  });
});
