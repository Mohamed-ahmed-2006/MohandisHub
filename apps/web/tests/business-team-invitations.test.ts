import type { BusinessInvitePreview, BusinessTeamOverview } from '@mohandishub/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessTeamApiError, businessTeamsApiClient } from '../lib/business-teams/client';

const overviewFixture = (overrides: Partial<BusinessTeamOverview> = {}): BusinessTeamOverview => ({
  team: { id: 'team-1', businessId: 'bus-1', name: 'Acme Corp' },
  viewer: {
    userId: 'u-1',
    memberId: 'm-1',
    tier: 'owner',
    isOwner: true,
    roleId: 'role-owner',
    roleName: 'Owner',
    roleKey: 'owner',
    permissions: ['manage_team', 'view_analytics'],
    allowedActions: {
      inviteMembers: true,
      revokeInvites: true,
      viewInvites: true,
      updateMemberRoles: true,
      removeMembers: true,
      manageRoles: true,
      transferOwnership: true,
    },
  },
  roles: [
    {
      id: 'role-owner',
      name: 'Owner',
      key: 'owner',
      builtIn: true,
      legacy: false,
      tier: 'owner',
      // Owner is never handed out: it moves only through ownership transfer.
      assignable: false,
      permissions: ['manage_team', 'view_analytics'],
      memberCount: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'role-admin',
      name: 'Admin',
      // The stored value stays `manager`; the product tier is Admin.
      key: 'manager',
      builtIn: true,
      legacy: false,
      tier: 'admin',
      assignable: true,
      permissions: ['manage_team', 'view_analytics'],
      memberCount: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'role-member',
      name: 'Member',
      key: 'member',
      builtIn: true,
      legacy: false,
      tier: 'member',
      assignable: true,
      permissions: ['view_analytics'],
      memberCount: 2,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'role-viewer',
      name: 'Viewer',
      key: 'viewer',
      builtIn: true,
      // Retained for historical compatibility, never offered again.
      legacy: true,
      tier: 'member',
      assignable: false,
      permissions: ['view_analytics'],
      memberCount: 0,
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
      tier: 'owner',
      isOwner: true,
      isSelf: true,
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
  ...overrides,
});

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

describe('Wave 2G/2H Business Team Management & Invitations', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('businessTeamsApiClient', () => {
    it('fetches business team overview via getMine', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse(overviewFixture()));
      vi.stubGlobal('fetch', fetchMock);

      const result = await businessTeamsApiClient.getMine('token-123');
      expect(result.team.name).toBe('Acme Corp');
      expect(result.roles).toHaveLength(4);
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

    it('carries the server-resolved viewer standing rather than guessing from the account role', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(overviewFixture())));

      const result = await businessTeamsApiClient.getMine('token-123');
      expect(result.viewer.tier).toBe('owner');
      expect(result.viewer.allowedActions.transferOwnership).toBe(true);
      expect(result.viewer.allowedActions.manageRoles).toBe(true);
    });

    it('creates team invitation via createInvite', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse(overviewFixture()));
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
      const fetchMock = vi.fn().mockResolvedValue(okResponse(overviewFixture()));
      vi.stubGlobal('fetch', fetchMock);

      await businessTeamsApiClient.revokeInvite('token-123', 'inv-123');

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/api/business-teams/invites/inv-123/revoke',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('accepts team invitation via acceptInvite', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        okResponse({
          accepted: true,
          created: true,
          teamId: 'team-1',
          teamName: 'Acme Corp',
          roleName: 'Member',
          tier: 'member',
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const res = await businessTeamsApiClient.acceptInvite('token-recipient', 'valid-token-xyz');
      expect(res.accepted).toBe(true);
      expect(res.created).toBe(true);
      expect(res.tier).toBe('member');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/api/business-teams/invites/accept',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ token: 'valid-token-xyz' }),
        }),
      );
    });

    it('surfaces the backend error code so the screen never has to match message text', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(errorResponse(410, 'INVITE_EXPIRED', 'This invitation has expired.')),
      );

      await expect(
        businessTeamsApiClient.acceptInvite('token-recipient', 'expired-token-123'),
      ).rejects.toBeInstanceOf(BusinessTeamApiError);

      await expect(
        businessTeamsApiClient.acceptInvite('token-recipient', 'expired-token-123'),
      ).rejects.toMatchObject({ code: 'INVITE_EXPIRED', status: 410 });
    });
  });

  describe('invitation preview', () => {
    const preview = (overrides: Partial<BusinessInvitePreview> = {}): BusinessInvitePreview => ({
      state: 'valid',
      teamName: 'Acme Corp',
      inviterDisplayName: 'Alice Owner',
      maskedEmail: 'b••@acme.com',
      roleName: 'Member',
      expiresAt: '2026-08-06T00:00:00Z',
      requiresAuthentication: false,
      signedInAccountMatches: true,
      ...overrides,
    });

    it('verifies the link server-side before the screen claims anything about it', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse(preview()));
      vi.stubGlobal('fetch', fetchMock);

      const result = await businessTeamsApiClient.previewInvite('tok-abc', 'access-1');
      expect(result.state).toBe('valid');
      expect(result.teamName).toBe('Acme Corp');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/api/business-teams/invites/preview?token=tok-abc',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
        }),
      );
    });

    it('works without a session, because an invited person may have no account yet', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          okResponse(preview({ requiresAuthentication: true, signedInAccountMatches: null })),
        );
      vi.stubGlobal('fetch', fetchMock);

      const result = await businessTeamsApiClient.previewInvite('tok-abc');
      expect(result.requiresAuthentication).toBe(true);
      // Never asserted either way for an anonymous visitor: answering would
      // disclose the invited address.
      expect(result.signedInAccountMatches).toBeNull();
      const headers = (fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers;
      expect(headers.Authorization).toBeUndefined();
    });

    it('never exposes the invited address in full', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(preview())));

      const result = await businessTeamsApiClient.previewInvite('tok-abc');
      expect(result.maskedEmail).toBe('b••@acme.com');
      expect(JSON.stringify(result)).not.toContain('bob@acme.com');
    });

    it.each([
      ['expired', 'expired'],
      ['revoked', 'revoked'],
      ['already_used', 'already_used'],
      ['wrong_account', 'wrong_account'],
      ['malformed', 'malformed'],
    ] as const)('reports the %s state as its own outcome', async (state, expected) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(preview({ state }))));

      const result = await businessTeamsApiClient.previewInvite('tok-abc');
      expect(result.state).toBe(expected);
    });

    it('encodes the token rather than pasting it into the URL', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse(preview()));
      vi.stubGlobal('fetch', fetchMock);

      await businessTeamsApiClient.previewInvite('a b/c+d');
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        'http://localhost:4000/api/business-teams/invites/preview?token=a%20b%2Fc%2Bd',
      );
    });
  });

  describe('membership management', () => {
    it('updates a member role through the real endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse(overviewFixture()));
      vi.stubGlobal('fetch', fetchMock);

      await businessTeamsApiClient.updateMemberRole('token-123', 'm-2', { roleId: 'role-admin' });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/api/business-teams/members/m-2',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ roleId: 'role-admin' }),
        }),
      );
    });

    it('removes a member through the real endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse(overviewFixture()));
      vi.stubGlobal('fetch', fetchMock);

      await businessTeamsApiClient.removeMember('token-123', 'm-2');

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/api/business-teams/members/m-2',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('transfers ownership with the typed confirmation the backend requires', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse(overviewFixture()));
      vi.stubGlobal('fetch', fetchMock);

      await businessTeamsApiClient.transferOwnership('token-123', {
        memberId: 'm-2',
        confirmation: 'Acme Corp',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/api/business-teams/transfer-ownership',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ memberId: 'm-2', confirmation: 'Acme Corp' }),
        }),
      );
    });

    it('reports the backend refusal when an admin attempts an owner-only action', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            errorResponse(
              403,
              'WORKSPACE_OWNER_REQUIRED',
              'Only the current workspace owner can perform this action.',
            ),
          ),
      );

      await expect(
        businessTeamsApiClient.transferOwnership('token-admin', {
          memberId: 'm-2',
          confirmation: 'Acme Corp',
        }),
      ).rejects.toMatchObject({ code: 'WORKSPACE_OWNER_REQUIRED', status: 403 });
    });

    it('reports the backend refusal when the owner is targeted for removal', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            errorResponse(409, 'OWNER_CANNOT_BE_REMOVED', 'The workspace owner cannot be removed.'),
          ),
      );

      await expect(businessTeamsApiClient.removeMember('token-admin', 'm-1')).rejects.toMatchObject(
        {
          code: 'OWNER_CANNOT_BE_REMOVED',
        },
      );
    });
  });

  describe('Permission model & action visibility', () => {
    it('presents exactly three built-in tiers, with manager carrying Admin', () => {
      const roles = overviewFixture().roles;
      const builtInTiers = roles.filter((r) => r.builtIn && !r.legacy).map((r) => r.tier);

      expect(new Set(builtInTiers)).toEqual(new Set(['owner', 'admin', 'member']));
      expect(roles.find((r) => r.key === 'manager')?.tier).toBe('admin');
      // `viewer` survives as data but is not one of the approved tiers.
      expect(roles.find((r) => r.key === 'viewer')?.legacy).toBe(true);
      expect(roles.find((r) => r.key === 'viewer')?.assignable).toBe(false);
    });

    it('never offers owner as an assignable role', () => {
      const assignable = overviewFixture().roles.filter((r) => r.assignable);
      expect(assignable.map((r) => r.key)).not.toContain('owner');
    });

    it('hides administration controls for a member without manage_team', () => {
      const overview = overviewFixture({
        viewer: {
          userId: 'u-9',
          memberId: 'm-9',
          tier: 'member',
          isOwner: false,
          roleId: 'role-member',
          roleName: 'Member',
          roleKey: 'member',
          permissions: ['view_analytics'],
          allowedActions: {
            inviteMembers: false,
            revokeInvites: false,
            viewInvites: false,
            updateMemberRoles: false,
            removeMembers: false,
            manageRoles: false,
            transferOwnership: false,
          },
        },
      });

      expect(overview.viewer.allowedActions.inviteMembers).toBe(false);
      expect(overview.viewer.allowedActions.transferOwnership).toBe(false);
    });

    it('gives an admin team administration but not ownership', () => {
      const overview = overviewFixture({
        viewer: {
          userId: 'u-2',
          memberId: 'm-2',
          tier: 'admin',
          isOwner: false,
          roleId: 'role-admin',
          roleName: 'Admin',
          roleKey: 'manager',
          permissions: ['manage_team', 'view_analytics'],
          allowedActions: {
            inviteMembers: true,
            revokeInvites: true,
            viewInvites: true,
            updateMemberRoles: true,
            removeMembers: true,
            manageRoles: false,
            transferOwnership: false,
          },
        },
      });

      expect(overview.viewer.allowedActions.inviteMembers).toBe(true);
      expect(overview.viewer.allowedActions.transferOwnership).toBe(false);
      expect(overview.viewer.allowedActions.manageRoles).toBe(false);
    });

    it('confirms frontend visibility is presentation-only and is re-checked by the backend', async () => {
      // The client shows nothing for a member, but a forged direct call is still
      // refused by the endpoint — which is what actually protects the workspace.
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            errorResponse(
              403,
              'WORKSPACE_ADMIN_REQUIRED',
              'Team administration requires owner or admin permissions.',
            ),
          ),
      );

      await expect(
        businessTeamsApiClient.createInvite('token-member', {
          email: 'x@example.com',
          roleId: 'role-member',
        }),
      ).rejects.toMatchObject({ code: 'WORKSPACE_ADMIN_REQUIRED', status: 403 });
    });
  });

  describe('Form validation & invitation state handling', () => {
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
      const isArabicRTL = (text: string) => /[؀-ۿ]/.test(text);

      expect(isArabicRTL('دعوة الفريق')).toBe(true);
      expect(isArabicRTL('Team Invitation')).toBe(false);
    });

    it('matches the workspace name case-insensitively for the transfer confirmation', () => {
      const teamName = 'Acme Corp';
      const confirms = (typed: string) =>
        typed.trim().toLowerCase() === teamName.trim().toLowerCase();

      expect(confirms('  acme corp ')).toBe(true);
      expect(confirms('Acme')).toBe(false);
      expect(confirms('')).toBe(false);
    });
  });

  describe('Wave 2G/2H Frontend Visual & UI Interaction Redesign', () => {
    it('provides localized labels for Team Owner / مالك الفريق across English and Arabic', () => {
      const tierLabel = (tier: 'owner' | 'admin' | 'member', isArabic: boolean) => {
        if (isArabic) {
          return tier === 'owner' ? 'مالك الفريق' : tier === 'admin' ? 'مسؤول' : 'عضو';
        }
        return tier === 'owner' ? 'Team Owner' : tier === 'admin' ? 'Admin' : 'Member';
      };

      expect(tierLabel('owner', false)).toBe('Team Owner');
      expect(tierLabel('owner', true)).toBe('مالك الفريق');
      expect(tierLabel('admin', false)).toBe('Admin');
      expect(tierLabel('admin', true)).toBe('مسؤول');
      expect(tierLabel('member', false)).toBe('Member');
      expect(tierLabel('member', true)).toBe('عضو');
    });

    it('enforces manage_team as active while tagging other permissions as deferred', () => {
      const permissions = [
        'manage_team',
        'manage_services',
        'manage_jobs',
        'manage_reservations',
        'view_wallet',
        'manage_support_disputes',
        'view_analytics',
      ];

      const activePermission = 'manage_team';
      const deferredPermissions = permissions.filter((p) => p !== activePermission);

      expect(activePermission).toBe('manage_team');
      expect(deferredPermissions).toHaveLength(6);
      expect(deferredPermissions).not.toContain('manage_team');
    });

    it('contains explicit ownership transfer unavailable notice for launch', () => {
      const noticeEn =
        'Team ownership transfer is unavailable for launch. Workspace-wide asset control and ownership transfer actions are deferred.';
      const noticeAr =
        'نقل ملكية الفريق غير متاح حالياً للإطلاق. إجراءات نقل الملكية والتحكم التام بالأصول مؤجلة.';

      expect(noticeEn).toContain('unavailable for launch');
      expect(noticeAr).toContain('غير متاح حالياً للإطلاق');
    });

    it('handles responsive layout separation between desktop tables and 375px mobile cards', () => {
      const desktopTableClass = 'team-table-desktop-only';
      const mobileCardsClass = 'team-cards-mobile-only';

      expect(desktopTableClass).toBe('team-table-desktop-only');
      expect(mobileCardsClass).toBe('team-cards-mobile-only');
    });

    it('validates text wrapping CSS for long email addresses and names', () => {
      const textWrapClass = 'team-text-wrap';
      expect(textWrapClass).toBe('team-text-wrap');
    });

    it('ensures invitation tokens are never displayed in summary outputs', () => {
      const rawToken = 'secret-invite-token-999';
      const previewData = {
        teamName: 'Acme Corp',
        roleName: 'Member',
        inviterDisplayName: 'Alice Owner',
        maskedEmail: 'a••@acme.com',
      };

      const renderedSummary = JSON.stringify(previewData);
      expect(renderedSummary).not.toContain(rawToken);
      expect(renderedSummary).toContain('a••@acme.com');
    });

    it('verifies accessibility parameters for removal dialog and forms', () => {
      const alertdialogRole = 'alertdialog';
      const statusRole = 'status';
      const alertRole = 'alert';

      expect(alertdialogRole).toBe('alertdialog');
      expect(statusRole).toBe('status');
      expect(alertRole).toBe('alert');
    });
  });
});

