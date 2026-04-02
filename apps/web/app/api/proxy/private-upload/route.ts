import type { NextRequest } from 'next/server';

import { getApiBaseUrl } from '@/lib/env';

const PRIVATE_UPLOAD_PREFIX = '/api/upload/private/';

const normalizeApiBase = (apiBase: string): string => {
  const trimmed = apiBase.trim().replace(/\/+$/, '');
  // Some configs accidentally include `/api` in the base URL.
  return trimmed.endsWith('/api') ? trimmed.slice(0, -'/api'.length) : trimmed;
};

const toPrivateUploadUpstreamCandidates = (rawPath: string | null, apiBase: string): string[] => {
  if (!rawPath) return [];
  const trimmed = rawPath.trim();
  if (!trimmed) return [];

  const normalizedApiBase = normalizeApiBase(apiBase);
  const candidates: string[] = [];

  // Handle cases where the value contains the private prefix but is missing a scheme,
  // e.g. `api.mohandishub.app/api/upload/private/<id>`.
  if (
    !trimmed.startsWith('http://') &&
    !trimmed.startsWith('https://') &&
    !trimmed.startsWith('/') &&
    trimmed.includes(PRIVATE_UPLOAD_PREFIX)
  ) {
    const idx = trimmed.indexOf(PRIVATE_UPLOAD_PREFIX);
    const extractedPath = trimmed.slice(idx); // starts with `/api/upload/private/...`
    if (extractedPath.startsWith('/')) {
      const first = normalizedApiBase ? `${normalizedApiBase}${extractedPath}` : null;
      if (first) candidates.push(first);
      return candidates;
    }
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      if (!parsed.pathname?.includes(PRIVATE_UPLOAD_PREFIX)) return [];
      const first = normalizedApiBase ? `${normalizedApiBase}${parsed.pathname}${parsed.search}` : null;
      const second = `${parsed.origin}${parsed.pathname}${parsed.search}`;
      if (first && !candidates.includes(first)) candidates.push(first);
      if (!candidates.includes(second)) candidates.push(second);
      return candidates;
    } catch {
      return [];
    }
  }

  if (trimmed.startsWith('/')) {
    if (!trimmed.includes(PRIVATE_UPLOAD_PREFIX)) return [];
    const first = normalizedApiBase ? `${normalizedApiBase}${trimmed}` : null;
    if (first) candidates.push(first);
    return candidates;
  }

  // Assume caller passed an upload id (uuid-like).
  const first = normalizedApiBase ? `${normalizedApiBase}${PRIVATE_UPLOAD_PREFIX}${trimmed.replace(/^\/+/, '')}` : null;
  if (first) candidates.push(first);
  return candidates;
};

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return new Response('Unauthorized', { status: 401 });
  }

  const rawPath = request.nextUrl.searchParams.get('path');
  const apiBaseRaw = getApiBaseUrl();
  const apiBase = apiBaseRaw.replace(/\/$/, '');
  if (!apiBaseRaw) {
    return new Response('API base URL is not configured', { status: 500 });
  }

  const candidates = toPrivateUploadUpstreamCandidates(rawPath, apiBase);
  if (candidates.length === 0) {
    return new Response('Invalid private upload path', { status: 400 });
  }

  // Try candidates in order. If the first host doesn't have the file (404),
  // the stored URL might have been generated from a different host (prod vs local).
  let lastError: Response | null = null;
  for (const upstreamUrl of candidates) {
    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        Accept: 'image/*, application/pdf, video/*, */*',
      },
      cache: 'no-store',
    });

    if (upstream.ok && upstream.body) {
      const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
      const contentDisposition = upstream.headers.get('content-disposition');
      const bytes = await upstream.arrayBuffer();

      const headers = new Headers();
      headers.set('content-type', contentType);
      if (contentDisposition) headers.set('content-disposition', contentDisposition);
      headers.set('content-length', String(bytes.byteLength));
      headers.set('cache-control', 'no-store');

      return new Response(bytes, {
        status: 200,
        headers,
      });
    }

    lastError = upstream;
    // On 404/401/403, try the next candidate (different origin).
    // 401 can happen when the stored URL points to a different API host than the one
    // that the current access token is valid for.
    if (upstream.status !== 404 && upstream.status !== 401 && upstream.status !== 403) break;
  }

  const message = await (lastError ? lastError.text().catch(() => '') : Promise.resolve('Failed to load private upload'));
  return new Response(message || 'Failed to load private upload', { status: lastError?.status || 502 });

}
