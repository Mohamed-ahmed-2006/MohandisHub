import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(WEB_ROOT, '..', '..');
const readWeb = (relative: string) => readFileSync(join(WEB_ROOT, relative), 'utf8');
const readRepo = (relative: string) => readFileSync(join(REPO_ROOT, relative), 'utf8');

describe('Wave 2G/2H polished UI contracts', () => {
  it('captures and scrubs the invitation bearer before using a tokenless auth continuation', () => {
    const screen = readWeb('components/team/invitation-acceptance-screen.tsx');
    const continuation = readWeb('lib/business-teams/invitation-continuation.ts');

    expect(screen).toContain("captureInvitation(searchParams.get('token'))");
    expect(screen).toContain("const returnTo = buildLocalePath(loc, '/invitations/accept')");
    expect(screen).not.toMatch(/returnTo\s*=.*\?token=/);
    expect(screen).not.toMatch(/localStorage\.(getItem|setItem)/);
    expect(continuation).toContain('window.sessionStorage');
    expect(continuation).toContain('window.history.replaceState');
    expect(continuation).not.toMatch(/window\.localStorage/);
  });

  it('renders invitation summary facts only from the typed verified preview response', () => {
    const screen = readWeb('components/team/invitation-acceptance-screen.tsx');
    const summary = screen.slice(
      screen.indexOf('const invitationSummary'),
      screen.indexOf('if (!isAuthenticated)'),
    );
    const previewFields = new Set(
      [...summary.matchAll(/preview\??\.(\w+)/g)].map((match) => match[1]),
    );

    expect(screen).toContain('useState<BusinessInvitePreview | null>');
    expect(previewFields).toEqual(
      new Set(['teamName', 'roleName', 'inviterDisplayName', 'maskedEmail', 'expiresAt', 'state']),
    );
    expect(summary).not.toContain('token');
  });

  it('derives workspace visibility and invitation history from backend responses', () => {
    const workspace = readWeb('components/team/workspace-screen.tsx');
    const panel = readWeb('components/app/business-team-panel.tsx');
    const service = readRepo('apps/api/src/modules/business-teams/business-teams.service.ts');

    expect(workspace).toContain('businessTeamsApiClient.listWorkspaces(accessToken)');
    expect(workspace).toContain('result.workspaces.some');
    expect(panel).toContain('overview.invites.map');
    expect(service).toContain('canAdministerTeam(context)');
    expect(service).toContain('Promise.resolve({ rows: [] as never[] })');
  });

  it('keeps the removal dialog keyboard-modal and restores its trigger focus', () => {
    const panel = readWeb('components/app/business-team-panel.tsx');

    expect(panel).toContain("event.key === 'Escape'");
    expect(panel).toContain("event.key !== 'Tab'");
    expect(panel).toContain('event.shiftKey');
    expect(panel).toContain('dialog?.querySelectorAll<HTMLElement>');
    expect(panel).toContain('trigger?.isConnected ? trigger : teamSurfaceRef.current');
    expect(panel).toContain('aria-modal="true"');
  });

  it('keeps deferred controls inert and the responsive CSS locally scoped', () => {
    const panel = readWeb('components/app/business-team-panel.tsx');
    const css = readWeb('components/team/team-management.css');
    const client = readWeb('lib/business-teams/client.ts');

    expect(panel).toContain('disabled={!isEnforced}');
    expect(panel).toContain('team-permission-chip--deferred');
    expect(client).not.toMatch(/\btransferOwnership\s*:/);
    expect(css).toContain('@media (max-width: 639px)');
    expect(css).toMatch(/\[dir=['"]rtl['"]\] \.team-table/);
    expect(css).not.toMatch(/(^|\n)\s*(body|html|\.dashboard[-\w]*)\s*[{,]/);
  });
});
