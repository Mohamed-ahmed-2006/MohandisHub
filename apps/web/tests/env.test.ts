import { describe, expect, it } from 'vitest';

import { getApiBaseUrl } from '../lib/env';

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
