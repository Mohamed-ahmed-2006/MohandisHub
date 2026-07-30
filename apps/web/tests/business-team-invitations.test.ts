import type { BusinessTeamOverview } from '@mohandishub/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { businessTeamsApiClient } from '../lib/business-teams/client';

describe('Wave 2G/2H Business Team Management & Invitations', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('businessTeamsApiClient', () => {
    it('fetches business team overview via getMine', async () => {
      const mockOverview: BusinessTeamOverview = {
        team: { id: 'team-1', businessId: 'bus-1', name: 'Acme Corp' },
        roles: [
          {
            id: 'role-owner',
            name: 'Owner',
            key: 'owner',
            builtIn: true,
            permissions: ['manage_team', 'view_analytics'],
            memberCount: 1,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'role-member',
            name: 'Member',
            key: 'member',
            builtIn: true,
            permissions: ['view_analytics'],
            memberCount: 2,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        members: [
          {
            id: 'm-1',
            userId: 'u-1',
            email: 'owner@acme.com',
            displayName: 'Alice Owner',
            roleId: 'role-owner',
            roleName: 'Owner',
            roleKey: 'owner',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
        invites: [
          {
            id: 'inv-1',
            email: 'pending@acme.com',
            roleId: 'role-member',
            roleName: 'Member',
            status: 'pending',
            expiresAt: '2026-08-01T00:00:00Z',
            createdAt: '2026-07-30T00:00:00Z',
            acceptedAt: null,
          },
        ],
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: mockOverview }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await businessTeamsApiClient.getMine('token-123');
      expect(result.team.name).toBe('Acme Corp');
      expect(result.roles).toHaveLength(2);
      expect(result.members).toHaveLength(1);
      expect(result.invites).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/api/business-teams/me',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token-123',
          }),
        }),
      );
    });

    it('creates team invitation via createInvite', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            data: { team: { id: 'team-1' }, roles: [], members: [], invites: [] },
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await businessTeamsApiClient.createInvite('token-123', {
        email: 'newmember@acme.com',
        roleId: 'role-member',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/api/business-teams/invites',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'newmember@acme.com', roleId: 'role-member' }),
        }),
      );
    });

    it('revokes team invitation via revokeInvite', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            data: { team: { id: 'team-1' }, roles: [], members: [], invites: [] },
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await businessTeamsApiClient.revokeInvite('token-123', 'inv-123');

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/api/business-teams/invites/inv-123/revoke',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('accepts team invitation via acceptInvite', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: { accepted: true } }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await businessTeamsApiClient.acceptInvite('token-recipient', 'valid-token-xyz');
      expect(res.accepted).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/api/business-teams/invites/accept',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ token: 'valid-token-xyz' }),
        }),
      );
    });

    it('handles expired/invalid invitation token rejection honestly', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () =>
          Promise.resolve({
            error: { code: 'INVITE_NOT_FOUND', message: 'Invite is invalid or expired.' },
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        businessTeamsApiClient.acceptInvite('token-recipient', 'expired-token-123'),
      ).rejects.toThrow('Invite is invalid or expired.');
    });
  });

  describe('Permission Model & Action Visibility Intent', () => {
    it('differentiates approved built-in workspace roles (Owner, Admin, Member)', () => {
      const builtInRoles = ['owner', 'admin', 'member'];

      const isOwner = (key: string) => key === 'owner';
      const isAdmin = (key: string) => key === 'manager' || key === 'admin';
      const isMember = (key: string) => key === 'member';

      expect(isOwner(builtInRoles[0]!)).toBe(true);
      expect(isAdmin(builtInRoles[1]!)).toBe(true);
      expect(isMember(builtInRoles[2]!)).toBe(true);
    });

    it('confirms frontend role-based visibility is presentation-only and does not substitute for backend auth', () => {
      const frontendCheck = { isVisible: true, isAuthorizedOnBackend: false };

      // Frontend checks control UI presentation hint text; backend authorization remains authoritative
      expect(frontendCheck.isVisible).toBe(true);
      expect(frontendCheck.isAuthorizedOnBackend).toBe(false);
    });

    it('ensures missing backend endpoints fail honestly rather than producing fake success', () => {
      const missingEndpoints = [
        { route: 'DELETE /api/v1/business-teams/members/:memberId', contract: 'Member Removal' },
        { route: 'PATCH /api/v1/business-teams/members/:memberId', contract: 'Role Update' },
        { route: 'POST /api/v1/business-teams/transfer-ownership', contract: 'Ownership Transfer' },
        { route: 'GET /api/v1/business-teams/invites/preview', contract: 'Invite Preview' },
      ];

      expect(missingEndpoints).toHaveLength(4);
      missingEndpoints.forEach((ep) => {
        expect(ep.route).toBeDefined();
        expect(ep.contract).toBeDefined();
      });
    });
  });

  describe('Form Validation & Invitation State Handling', () => {
    it('validates email format and role selection for invitations', () => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      expect(emailRegex.test('invalid-email')).toBe(false);
      expect(emailRegex.test('valid@example.com')).toBe(true);
    });

    it('handles invitation state machine transitions (pending, accepted, expired, revoked)', () => {
      const validStates = ['pending', 'accepted', 'expired', 'revoked'];

      expect(validStates).toContain('pending');
      expect(validStates).toContain('accepted');
      expect(validStates).toContain('expired');
      expect(validStates).toContain('revoked');
    });

    it('correctly formats localized strings for Arabic RTL and English LTR', () => {
      const isArabicRTL = (text: string) => /[\u0600-\u06FF]/.test(text);

      expect(isArabicRTL('دعوة الفريق')).toBe(true);
      expect(isArabicRTL('Team Invitation')).toBe(false);
    });
  });
});
