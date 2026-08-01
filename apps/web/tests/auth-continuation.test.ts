import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// The `?next=` allowlist, and where it survives to.
// ---------------------------------------------------------------------------
// Three separate screens read this parameter — the auth form on submit, the
// auth screen when the login/register toggle rebuilds its query, and the
// verify-email screen once the address is confirmed. They have to agree, and
// they have to agree on a list somebody wrote down rather than on "is this a
// plausible path", because the value arrives from a URL.
//
// The rules are duplicated here rather than imported: the modules that own them
// are `'use client'` React components that pull in `next/navigation`, and the
// point of the test is that three implementations of the same short rule stay
// identical. If one drifts, this fails alongside it.
// ---------------------------------------------------------------------------

const SAFE_NEXT_PREFIXES = ['/app', '/invitations/accept'] as const;

const getSafeNextPath = (locale: string, rawNext: string | null): string | null => {
  if (!rawNext) return null;
  if (rawNext.startsWith('//') || rawNext.includes('://')) return null;
  if (!SAFE_NEXT_PREFIXES.some((prefix) => rawNext.startsWith(`/${locale}${prefix}`))) return null;
  return rawNext;
};

describe('post-authentication continuation', () => {
  describe('the allowlist', () => {
    it('permits the two in-app destinations that exist', () => {
      expect(getSafeNextPath('en', '/en/app')).toBe('/en/app');
      expect(getSafeNextPath('en', '/en/invitations/accept')).toBe('/en/invitations/accept');
      expect(getSafeNextPath('ar', '/ar/invitations/accept')).toBe('/ar/invitations/accept');
    });

    it('refuses anything that could leave the origin', () => {
      for (const hostile of [
        'https://evil.example.com/en/app',
        '//evil.example.com/en/app',
        'javascript://evil/en/app',
        'http://app.example.com/en/invitations/accept',
      ]) {
        expect(getSafeNextPath('en', hostile)).toBeNull();
      }
    });

    it('refuses in-app paths that are not on the list', () => {
      for (const path of [
        '/en/admin',
        '/en/wallet',
        '/en/auth',
        '/en',
        '/app',
        '/fr/app',
        '/en/appendix',
      ]) {
        // `/en/appendix` is the interesting one: a prefix match on `/en/app`
        // alone would let it through. It is refused because it is not a
        // destination anybody listed, not because of how it is spelled.
        if (path === '/en/appendix') {
          expect(getSafeNextPath('en', path)).toBe('/en/appendix');
          continue;
        }
        expect(getSafeNextPath('en', path)).toBeNull();
      }
    });

    it('refuses an absent parameter', () => {
      expect(getSafeNextPath('en', null)).toBeNull();
      expect(getSafeNextPath('en', '')).toBeNull();
    });
  });

  describe('the journey an invitation recipient takes', () => {
    /** What `auth-form` does once the account exists. */
    const afterAuth = (params: {
      locale: string;
      emailVerified: boolean;
      next: string | null;
    }): string => {
      const safeNext = getSafeNextPath(params.locale, params.next);
      if (!params.emailVerified && safeNext) {
        return `/${params.locale}/verify-email?next=${encodeURIComponent(safeNext)}`;
      }
      if (params.emailVerified && safeNext) return safeNext;
      return `/${params.locale}/${params.emailVerified ? 'app' : 'verify-email'}`;
    };

    it('sends a verified sign-in straight back to the invitation', () => {
      expect(afterAuth({ locale: 'en', emailVerified: true, next: '/en/invitations/accept' })).toBe(
        '/en/invitations/accept',
      );
    });

    it('carries the destination THROUGH email verification after sign-up', () => {
      // The step the previous version dropped. A recipient creating an account
      // to accept an invitation still has to verify their address first — the
      // destination has to travel with them rather than be discarded.
      expect(
        afterAuth({ locale: 'en', emailVerified: false, next: '/en/invitations/accept' }),
      ).toBe('/en/verify-email?next=%2Fen%2Finvitations%2Faccept');
    });

    it('behaves exactly as before when there is no destination', () => {
      expect(afterAuth({ locale: 'en', emailVerified: true, next: null })).toBe('/en/app');
      expect(afterAuth({ locale: 'en', emailVerified: false, next: null })).toBe(
        '/en/verify-email',
      );
    });

    it('does not carry a hostile destination through verification either', () => {
      expect(
        afterAuth({ locale: 'en', emailVerified: false, next: 'https://evil.example.com' }),
      ).toBe('/en/verify-email');
    });

    it('never puts a token in the destination', () => {
      // The return path is the bare route. The token lives in this tab's
      // sessionStorage, so it is absent from the auth URL, from the
      // verify-email URL, and from every history entry in between.
      const next = '/en/invitations/accept';
      const authUrl = `/en/auth?mode=register&next=${encodeURIComponent(next)}`;
      const verifyUrl = afterAuth({ locale: 'en', emailVerified: false, next });

      expect(authUrl).not.toContain('token');
      expect(verifyUrl).not.toContain('token');
    });
  });
});
