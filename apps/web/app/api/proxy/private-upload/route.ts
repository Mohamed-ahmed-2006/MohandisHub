import type { NextRequest } from 'next/server';

import { getApiBaseUrl } from '@/lib/env';

const PRIVATE_UPLOAD_PREFIX = '/api/upload/private/';

const toPrivatePath = (rawPath: string | null): string | null => {
  if (!rawPath) return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      const normalized = `${parsed.pathname}${parsed.search}`;
      return normalized.includes(PRIVATE_UPLOAD_PREFIX) ? normalized : null;
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith('/')) {
    return trimmed.includes(PRIVATE_UPLOAD_PREFIX) ? trimmed : null;
  }

  return `${PRIVATE_UPLOAD_PREFIX}${trimmed.replace(/^\/+/, '')}`;
};

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return new Response('Unauthorized', { status: 401 });
  }

  const rawPath = request.nextUrl.searchParams.get('path');
  const privatePath = toPrivatePath(rawPath);
  if (!privatePath) {
    return new Response('Invalid private upload path', { status: 400 });
  }

  const apiBase = getApiBaseUrl().replace(/\/$/, '');
  if (!apiBase) {
    return new Response('API base URL is not configured', { status: 500 });
  }

  const upstream = await fetch(`${apiBase}${privatePath}`, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'image/*, application/pdf, video/*, */*',
    },
    cache: 'no-store',
  });

  if (!upstream.ok || !upstream.body) {
    const message = await upstream.text().catch(() => 'Failed to load private upload');
    return new Response(message, { status: upstream.status || 502 });
  }

  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  const contentDisposition = upstream.headers.get('content-disposition');
  const contentLength = upstream.headers.get('content-length');

  const headers = new Headers();
  headers.set('content-type', contentType);
  if (contentDisposition) headers.set('content-disposition', contentDisposition);
  if (contentLength) headers.set('content-length', contentLength);
  headers.set('cache-control', 'no-store');

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
}
