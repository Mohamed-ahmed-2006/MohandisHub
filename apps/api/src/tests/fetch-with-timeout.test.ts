import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExternalRequestError, fetchWithTimeout } from '../lib/fetch-with-timeout.js';

describe('external request policy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retries safe GET requests on retryable statuses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithTimeout(
      'https://provider.invalid/status',
      {},
      {
        retries: 1,
      },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-idempotent POST by default', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWithTimeout('https://provider.invalid/checkout', {
        method: 'POST',
        body: '{}',
      }),
    ).rejects.toBeInstanceOf(ExternalRequestError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('aborts a request that exceeds its deadline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: unknown, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error(String(init.signal?.reason ?? 'request aborted'))),
            { once: true },
          );
        });
      }),
    );

    await expect(
      fetchWithTimeout('https://provider.invalid/slow', {}, { timeoutMs: 5, retries: 0 }),
    ).rejects.toMatchObject({ code: 'EXTERNAL_TIMEOUT' });
  });
});
