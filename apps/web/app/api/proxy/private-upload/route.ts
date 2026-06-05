import type { NextRequest } from 'next/server';

import { getApiBaseUrl } from '@/lib/env';
import { toPrivateUploadUpstreamUrl } from '@/lib/upload/private-upload-proxy';

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

  const upstreamUrl = toPrivateUploadUpstreamUrl(rawPath, apiBase);
  if (!upstreamUrl) {
    return new Response('Invalid private upload path', { status: 400 });
  }

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

  const message = await upstream.text().catch(() => '');
  return new Response(message || 'Failed to load private upload', { status: upstream.status || 502 });
}
