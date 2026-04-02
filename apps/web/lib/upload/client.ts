import { authApiClient } from '@/lib/auth/client';
import { getApiBaseUrl } from '@/lib/env';

type UploadResponse = { data: { url: string; filename: string; originalName: string } };

export async function uploadFile(
  accessToken: string,
  file: File,
): Promise<{ url: string; filename: string; originalName: string }> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${getApiBaseUrl()}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? 'Upload failed');
  }

  const json = (await res.json()) as unknown as UploadResponse;
  return json.data;
}

/** Upload sensitive file (CV, verification docs). Stored in private bucket; URL is an API path that requires auth to resolve. */
export async function uploadPrivateFile(
  accessToken: string,
  file: File,
): Promise<{ url: string; filename: string; originalName: string }> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${getApiBaseUrl()}/api/upload/private`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? 'Upload failed');
  }

  const json = (await res.json()) as unknown as UploadResponse;
  return json.data;
}

/** Resolve private file path (e.g. /api/upload/private/:id) to a short-lived signed URL. Use when you need a URL (e.g. for API). */
export async function getPrivateFileUrl(
  accessToken: string,
  privatePathOrId: string,
): Promise<string> {
  const base = getApiBaseUrl();
  const path = privatePathOrId.startsWith('/') ? privatePathOrId : `/${privatePathOrId}`;
  const url = path.startsWith('/api/') ? `${base}${path}` : `${base}/api/upload/private/${privatePathOrId}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? 'Could not load file');
  }
  const json = (await res.json()) as unknown as { ok: boolean; data: { url: string } };
  return json.data.url;
}

/**
 * Return a URL that can be opened in a new tab (e.g. "Open CV"). Fetches the private file with auth
 * and returns a blob URL so it works for both Supabase (redirect) and local storage.
 * The blob URL is revoked after 5 minutes.
 */
export async function getPrivateFileOpenableUrl(
  accessToken: string,
  privatePathOrId: string,
): Promise<string> {
  // IMPORTANT: fetch private uploads through Next.js proxy (same-origin)
  // to avoid browser CORS issues when the API host is different.
  const proxyUrl = `/api/proxy/private-upload?path=${encodeURIComponent(privatePathOrId)}`;
  console.warn('[getPrivateFileOpenableUrl] start', {
    proxyUrl,
    privatePathOrIdPrefix: privatePathOrId.slice(0, 60),
  });
  // #region agent log
  fetch('http://127.0.0.1:7325/ingest/ebd08bf8-7d73-450c-ad4d-4436a6c2225b', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': 'b33485',
    },
    body: JSON.stringify({
      sessionId: 'b33485',
      runId: 'pre-debug',
      hypothesisId: 'H5_proxy_private_upload_resolution_inputs',
      location: 'upload/client.ts:getPrivateFileOpenableUrl:start',
      message: 'Resolving private upload via proxy',
      data: {
        privatePathOrIdStartsWithHttp: privatePathOrId.startsWith('http'),
        privatePathOrIdIncludesPrivatePrefix: privatePathOrId.includes('/api/upload/private/'),
        proxyUrlLength: proxyUrl.length,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  const fetchWithToken = async (token: string): Promise<Response> => {
    return fetch(proxyUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'image/*, application/pdf, */*',
      },
      credentials: 'include',
    });
  };

  let res = await fetchWithToken(accessToken);
  console.warn('[getPrivateFileOpenableUrl] proxy response initial', {
    status: res.status,
  });
  // #region agent log
  fetch('http://127.0.0.1:7325/ingest/ebd08bf8-7d73-450c-ad4d-4436a6c2225b', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': 'b33485',
    },
    body: JSON.stringify({
      sessionId: 'b33485',
      runId: 'pre-debug',
      hypothesisId: 'H5_proxy_private_upload_resolution_status_initial',
      location: 'upload/client.ts:getPrivateFileOpenableUrl:initialStatus',
      message: 'Private upload proxy initial response',
      data: {
        status: res.status,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (res.status === 401) {
    // Access token may expire while admin is open; try refreshing once.
    try {
      console.warn('[getPrivateFileOpenableUrl] proxy 401 -> refreshing token once');
      const refreshed = await authApiClient.refresh();
      const newToken = refreshed.tokens.accessToken;
      res = await fetchWithToken(newToken);
    } catch {
      // Keep original error handling below.
    }
  }

  console.warn('[getPrivateFileOpenableUrl] proxy response final', { status: res.status });

  // #region agent log
  fetch('http://127.0.0.1:7325/ingest/ebd08bf8-7d73-450c-ad4d-4436a6c2225b', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': 'b33485',
    },
    body: JSON.stringify({
      sessionId: 'b33485',
      runId: 'pre-debug',
      hypothesisId: 'H5_proxy_private_upload_resolution_status_afterRefresh',
      location: 'upload/client.ts:getPrivateFileOpenableUrl:afterRefresh',
      message: 'Private upload proxy response after refresh (if needed)',
      data: {
        finalStatus: res.status,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (res.status === 401) {
    throw new Error('Session expired. Please log out and log in again.');
  }

  if (!res.ok) {
    console.warn('[getPrivateFileOpenableUrl] proxy fetch not ok', { status: res.status });
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } | Record<string, unknown>;
    const message =
      typeof body === 'object' &&
      body &&
      'error' in body &&
      typeof (body as { error?: { message?: string } }).error?.message === 'string'
        ? (body as { error: { message: string } }).error.message
        : `Could not load file (HTTP ${res.status})`;
    throw new Error(message);
  }

  const blob = await res.blob();
  console.warn('[getPrivateFileOpenableUrl] blob meta', {
    proxyUrl,
    finalStatus: res.status,
    responseContentType: res.headers.get('content-type'),
    responseContentLength: res.headers.get('content-length'),
    blobType: blob.type,
    blobSize: blob.size,
  });
  const blobUrl = URL.createObjectURL(blob);
  console.warn('[getPrivateFileOpenableUrl] created blob url', {
    blobUrlPrefix: blobUrl.slice(0, 20),
  });
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000);
  return blobUrl;
}
