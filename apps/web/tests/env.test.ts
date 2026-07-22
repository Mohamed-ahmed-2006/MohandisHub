import { afterEach, describe, expect, it, vi } from 'vitest';

import { getApiBaseUrl, getAuthApiBaseUrl } from '../lib/env';
import { resolveApiTarget } from '../next.config';

describe('getApiBaseUrl', () => {
  it('returns configured NEXT_PUBLIC_API_URL when present', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:5000';

    expect(getApiBaseUrl()).toBe('http://localhost:5000');
  });

  it('returns empty string when NEXT_PUBLIC_API_URL is empty', () => {
    process.env.NEXT_PUBLIC_API_URL = '';

    expect(getApiBaseUrl()).toBe('');
  });

  it('prepends https when scheme is omitted for a public hostname', () => {
    process.env.NEXT_PUBLIC_API_URL = 'api.example.com';

    expect(getApiBaseUrl()).toBe('https://api.example.com');
  });

  it('prepends http for localhost without scheme', () => {
    process.env.NEXT_PUBLIC_API_URL = 'localhost:4000';

    expect(getApiBaseUrl()).toBe('http://localhost:4000');
  });

  it('preserves explicit http/https', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:4000';

    expect(getApiBaseUrl()).toBe('http://127.0.0.1:4000');
  });
});

describe('getAuthApiBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_AUTH_SAME_ORIGIN;
  });

  it('matches getApiBaseUrl when NEXT_PUBLIC_AUTH_SAME_ORIGIN is unset (Node has no window)', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';

    expect(getAuthApiBaseUrl()).toBe('https://api.example.com');
  });

  it('returns empty string in browser when NEXT_PUBLIC_AUTH_SAME_ORIGIN=1', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
    process.env.NEXT_PUBLIC_AUTH_SAME_ORIGIN = '1';
    vi.stubGlobal('window', {} as Window & typeof globalThis);

    expect(getAuthApiBaseUrl()).toBe('');
  });
});

describe('resolveApiTarget', () => {
  it('uses the public API URL when an internal rewrite target is not set', () => {
    expect(
      resolveApiTarget({
        NODE_ENV: 'production',
        NEXT_PUBLIC_API_URL: 'https://api.mohandishub.app',
      }),
    ).toBe('https://api.mohandishub.app');
  });

  it('fails closed for missing or loopback production targets', () => {
    expect(() => resolveApiTarget({ NODE_ENV: 'production' })).toThrow(
      'Production requires API_INTERNAL_URL or NEXT_PUBLIC_API_URL.',
    );
    expect(() =>
      resolveApiTarget({ NODE_ENV: 'production', API_INTERNAL_URL: 'http://localhost:4000' }),
    ).toThrow('Production API target must be a public HTTPS URL.');
  });
});
