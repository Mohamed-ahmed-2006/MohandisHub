// ---------------------------------------------------------------------------
// Carrying an invitation across sign-in, sign-up and email verification.
// ---------------------------------------------------------------------------
// The invitation token arrives in the query string, because that is where an
// emailed link can put it. Everything after that arrival is this module's job:
//
//   * CAPTURE it into `sessionStorage` and take it out of the address bar with
//     `history.replaceState`, so it stops being copied into the browser history
//     entry, the `Referer` header of the next navigation, and any screenshot or
//     screen-share of the page;
//   * KEEP it across the redirects that authentication needs. A recipient
//     usually has no account yet, so the path is accept -> register -> verify
//     email -> back to accept, and the previous version dropped the token at the
//     second step and stranded the user with an unusable link;
//   * FORGET it as soon as the invitation reaches a state no retry can change.
//
// `sessionStorage`, not `localStorage` and not a cookie: it dies with the tab,
// is never attached to a request, and is not readable by another origin. The raw
// token is deliberately never written to a durable application database — the
// only durable record of it anywhere is the SHA-256 digest the API stores.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'mh.invitation.pending';

/** How long a captured invitation stays usable in this tab. */
const CONTINUATION_TTL_MS = 60 * 60 * 1000;

export type PendingInvitation = {
  token: string;
  capturedAt: number;
};

const storage = (): Storage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    // Storage can be unavailable in private modes and under strict site data
    // settings. The acceptance screen still works from the URL in that session;
    // it just cannot survive a redirect.
    return null;
  }
};

/**
 * Remember an invitation token for the rest of this tab's session.
 *
 * Overwrites any earlier one: following a second invitation link means the
 * second is the one being acted on.
 */
export const rememberInvitation = (token: string): void => {
  const store = storage();
  if (!store) return;
  try {
    const value: PendingInvitation = { token, capturedAt: Date.now() };
    store.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Quota or a disabled store. Nothing to recover; the URL is still authoritative.
  }
};

/** Read the remembered token, discarding one that has gone stale. */
export const readInvitation = (): string | null => {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingInvitation>;
    if (typeof parsed.token !== 'string' || typeof parsed.capturedAt !== 'number') {
      store.removeItem(STORAGE_KEY);
      return null;
    }
    if (Date.now() - parsed.capturedAt > CONTINUATION_TTL_MS) {
      store.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed.token;
  } catch {
    return null;
  }
};

/**
 * Forget the invitation.
 *
 * Called on every terminal outcome — accepted, revoked, expired, already used,
 * wrong account, malformed — so a token that can no longer do anything does not
 * sit in the tab waiting to be replayed by the next navigation.
 */
export const forgetInvitation = (): void => {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // Nothing further to do.
  }
};

/**
 * Remove the `token` parameter from the visible URL without navigating.
 *
 * `replaceState` rather than a router push: the history entry is rewritten in
 * place, so the token is not left behind in a back-button entry either. Any
 * other query parameter on the page is preserved untouched.
 */
export const scrubTokenFromUrl = (): void => {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('token')) return;
    url.searchParams.delete('token');
    const query = url.searchParams.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${query ? `?${query}` : ''}${url.hash}`,
    );
  } catch {
    // A URL the browser will not parse is one there is nothing to scrub from.
  }
};

/**
 * Take the token from the URL if it is there, remember it, and clear the URL.
 *
 * Returns whichever token applies: the one just captured, or the one this tab
 * was already carrying from before an authentication redirect.
 */
export const captureInvitation = (fromUrl: string | null): string | null => {
  if (fromUrl) {
    rememberInvitation(fromUrl);
    scrubTokenFromUrl();
    return fromUrl;
  }
  return readInvitation();
};
