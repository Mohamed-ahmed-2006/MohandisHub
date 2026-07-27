export class ExternalRequestError extends Error {
  readonly code: 'EXTERNAL_TIMEOUT' | 'EXTERNAL_NETWORK_ERROR';

  constructor(code: ExternalRequestError['code']) {
    super(code === 'EXTERNAL_TIMEOUT' ? 'External request timed out' : 'External request failed');
    this.name = 'ExternalRequestError';
    this.code = code;
  }
}

type FetchPolicy = {
  timeoutMs?: number;
  retries?: number;
};

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  policy: FetchPolicy = {},
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const timeoutMs = policy.timeoutMs ?? 8_000;
  const retries = policy.retries ?? (method === 'GET' || method === 'HEAD' ? 2 : 0);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    try {
      const response = await fetch(input, { ...init, signal });
      if (
        attempt < retries &&
        (response.status === 429 || (response.status >= 500 && response.status <= 599))
      ) {
        await response.body?.cancel().catch(() => undefined);
        await wait(100 * 2 ** attempt + Math.floor(Math.random() * 50));
        continue;
      }
      return response;
    } catch (error) {
      if (init.signal?.aborted) throw error;
      if (attempt < retries) {
        await wait(100 * 2 ** attempt + Math.floor(Math.random() * 50));
        continue;
      }
      const timedOut =
        timeoutSignal.aborted || (error instanceof DOMException && error.name === 'TimeoutError');
      throw new ExternalRequestError(timedOut ? 'EXTERNAL_TIMEOUT' : 'EXTERNAL_NETWORK_ERROR');
    }
  }

  throw new ExternalRequestError('EXTERNAL_NETWORK_ERROR');
}
