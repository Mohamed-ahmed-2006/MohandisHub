import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureInvitation,
  forgetInvitation,
  readInvitation,
  rememberInvitation,
  scrubTokenFromUrl,
} from '../lib/business-teams/invitation-continuation';

// ---------------------------------------------------------------------------
// Carrying an invitation across sign-in, sign-up and email verification.
// ---------------------------------------------------------------------------
// The journey these tests describe is the one the final review found broken: a
// recipient with no account follows an emailed link, creates an account,
// verifies their email, and comes back to accept. Previously the token was
// dropped at the second step and left sitting in the browser history.
// ---------------------------------------------------------------------------

const TOKEN = 'Zm9vYmFyLWJhei1xdXV4LTAxMjM0NTY3ODlfLQ';

/** A stand-in for `sessionStorage` that survives only as long as the test. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

let replaced: Array<[unknown, string, string]> = [];

const setLocation = (href: string) => {
  const url = new URL(href);
  vi.stubGlobal('window', {
    sessionStorage: new MemoryStorage(),
    location: { href: url.toString(), pathname: url.pathname, search: url.search, hash: url.hash },
    history: {
      state: { marker: 'kept' },
      replaceState: (state: unknown, unused: string, next: string) => {
        replaced.push([state, unused, next]);
        // The stub stands in for a real `Location`, which the module only ever
        // reads four fields from. Cast at the single assignment rather than
        // reconstructing the whole interface.
        const updated = new URL(next, url.origin);
        (globalThis as unknown as { window: { location: unknown } }).window.location = {
          href: updated.toString(),
          pathname: updated.pathname,
          search: updated.search,
          hash: updated.hash,
        };
      },
    },
  });
};

beforeEach(() => {
  replaced = [];
  setLocation('https://app.example.com/en/invitations/accept?token=' + TOKEN);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('invitation continuation', () => {
  it('captures the token from the URL and scrubs it from the address bar', () => {
    const captured = captureInvitation(TOKEN);

    expect(captured).toBe(TOKEN);
    // Still available to this tab...
    expect(readInvitation()).toBe(TOKEN);
    // ...and gone from the URL, without a navigation.
    expect(replaced).toHaveLength(1);
    expect(replaced[0]![2]).toBe('/en/invitations/accept');
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.search).toBe('');
  });

  it('rewrites the history entry in place rather than pushing a new one', () => {
    captureInvitation(TOKEN);
    // `replaceState`, so the token is not left behind in a back-button entry,
    // and the existing history state is carried through untouched.
    expect(replaced[0]![0]).toEqual({ marker: 'kept' });
  });

  it('keeps every other query parameter', () => {
    setLocation(`https://app.example.com/en/invitations/accept?token=${TOKEN}&ref=email&x=1`);
    captureInvitation(TOKEN);

    expect(replaced[0]![2]).toBe('/en/invitations/accept?ref=email&x=1');
    expect(window.location.href).not.toContain(TOKEN);
  });

  it('survives a redirect that arrives with no token in the URL', () => {
    // Sign-in, sign-up and email verification all land back here without one:
    // the return path deliberately carries no bearer.
    rememberInvitation(TOKEN);
    setLocationKeepingStorage('https://app.example.com/en/invitations/accept');

    expect(captureInvitation(null)).toBe(TOKEN);
  });

  it('prefers a freshly followed link over the one already held', () => {
    rememberInvitation('older-token-value-000000');
    const next = captureInvitation(TOKEN);

    expect(next).toBe(TOKEN);
    expect(readInvitation()).toBe(TOKEN);
  });

  it('forgets the invitation on a terminal outcome', () => {
    captureInvitation(TOKEN);
    expect(readInvitation()).toBe(TOKEN);

    forgetInvitation();

    expect(readInvitation()).toBeNull();
  });

  it('discards a captured invitation that has gone stale', () => {
    captureInvitation(TOKEN);
    // An hour later, in a tab left open. The token may well still be valid, but
    // this tab has no business replaying it into an unrelated navigation.
    const later = Date.now() + 61 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(later);

    expect(readInvitation()).toBeNull();
  });

  it('ignores a corrupted storage entry instead of throwing', () => {
    window.sessionStorage.setItem('mh.invitation.pending', 'not json');
    expect(readInvitation()).toBeNull();

    window.sessionStorage.setItem('mh.invitation.pending', JSON.stringify({ token: 42 }));
    expect(readInvitation()).toBeNull();
  });

  it('does nothing when there is no token in the URL to scrub', () => {
    setLocation('https://app.example.com/en/invitations/accept');
    scrubTokenFromUrl();

    expect(replaced).toHaveLength(0);
  });

  it('degrades to the URL when storage is unavailable', () => {
    // Private modes and strict site-data settings. The screen still works from
    // the URL in that session; it simply cannot survive a redirect.
    vi.stubGlobal('window', {
      get sessionStorage(): Storage {
        throw new Error('SecurityError');
      },
      location: { href: 'https://app.example.com/en/invitations/accept' },
      history: { state: null, replaceState: () => {} },
    });

    expect(() => rememberInvitation(TOKEN)).not.toThrow();
    expect(readInvitation()).toBeNull();
    expect(captureInvitation(TOKEN)).toBe(TOKEN);
  });

  it('is a no-op on the server, where there is no tab to remember anything', () => {
    vi.stubGlobal('window', undefined);

    expect(readInvitation()).toBeNull();
    expect(() => rememberInvitation(TOKEN)).not.toThrow();
    expect(() => scrubTokenFromUrl()).not.toThrow();
    expect(() => forgetInvitation()).not.toThrow();
  });
});

/** Move the page without emptying the storage the previous page filled. */
function setLocationKeepingStorage(href: string): void {
  const storage = window.sessionStorage;
  const url = new URL(href);
  vi.stubGlobal('window', {
    sessionStorage: storage,
    location: { href: url.toString(), pathname: url.pathname, search: url.search, hash: url.hash },
    history: { state: null, replaceState: () => {} },
  });
}
