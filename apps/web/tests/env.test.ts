import { describe, expect, it } from 'vitest';

import { getApiBaseUrl } from '../lib/env';

describe('getApiBaseUrl', () => {
  it('returns configured NEXT_PUBLIC_API_URL when present', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:5000';

    expect(getApiBaseUrl()).toBe('http://localhost:5000');
  });

  it('returns default when NEXT_PUBLIC_API_URL is empty', () => {
    process.env.NEXT_PUBLIC_API_URL = '';

    expect(getApiBaseUrl()).toBe('http://localhost:4000');
  });
});
