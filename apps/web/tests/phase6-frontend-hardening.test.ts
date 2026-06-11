import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Phase 6 frontend route, session, and notification hardening', () => {
  it('protects localized app routes in middleware with a web session hint', () => {
    const middleware = read('middleware.ts');

    expect(middleware).toContain("const AUTH_SESSION_COOKIE_KEY = 'mohandishub-session'");
    expect(middleware).toContain("segments[1] === 'app'");
    expect(middleware).toContain("url.searchParams.set('mode', 'login')");
    expect(middleware).toContain("url.searchParams.set('next'");
  });

  it('sets and clears the web session hint and disconnects sockets on logout', () => {
    const provider = read('components/auth/auth-provider.tsx');

    expect(provider).toContain('AUTH_SESSION_COOKIE_KEY');
    expect(provider).toContain('disconnectChatSocket()');
    expect(provider).toContain('Max-Age=2592000');
    expect(provider).toContain('Max-Age=0');
  });

  it('reconnects sockets when the access token changes', () => {
    const socket = read('lib/chat/socket.ts');

    expect(socket).toContain('let socketToken: string | null = null');
    expect(socket).toContain('const tokenChanged = socketToken !== accessToken');
    expect(socket).toContain('socket.connected && tokenChanged');
    expect(socket).toContain('socket.disconnect()');
    expect(socket).toContain('socketToken = null');
  });

  it('uses the real projects workflow for job notification targets', () => {
    const page = read('app/[locale]/app/projects/page.tsx');
    const projects = read('components/app/projects-screen.tsx');
    const businessJobs = read('components/app/business-jobs-tab.tsx');
    const expertApps = read('components/app/jobs/expert-applications.tsx');

    expect(page).toContain('ProjectsScreen');
    expect(projects).toContain('BusinessJobsTab');
    expect(projects).toContain('ExpertJobsTab');
    expect(businessJobs).toContain("searchParams.get('job')");
    expect(expertApps).toContain("searchParams.get('application')");
  });

  it('hides demo notifications in production and refresh-retries notification requests', () => {
    const center = read('components/app/notification-center.tsx');
    const client = read('lib/notifications/client.ts');
    const fetchRetry = read('lib/auth/fetch-with-auth-retry.ts');
    const shell = read('components/app/app-shell.tsx');

    expect(center).toContain("process.env.NODE_ENV !== 'production'");
    expect(shell).toContain('refreshSession={refreshSession}');
    expect(client).toContain('fetchWithAuthRetry');
    expect(fetchRetry).toContain('response.status !== 401');
    expect(fetchRetry).toContain('coalescedRefresh()');
    expect(fetchRetry).toContain('Authorization');
  });

  it('keeps password reset tokens out of server query strings while accepting legacy links', () => {
    const form = read('components/auth/reset-password-form.tsx');

    expect(form).toContain('window.location.hash');
    expect(form).toContain("hashParams.get('token')");
    expect(form).toContain('window.history.replaceState');
    expect(form).toContain('const effectiveToken = token?.trim() ? token : fragmentToken');
  });
});
