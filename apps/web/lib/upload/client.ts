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
  const base = (getApiBaseUrl() || '').replace(/\/$/, '');
  const fullUrl =
    privatePathOrId.startsWith('http')
      ? privatePathOrId
      : (() => {
          const path = privatePathOrId.startsWith('/') ? privatePathOrId : `/${privatePathOrId}`;
          return path.startsWith('/api/') ? `${base}${path}` : `${base}/api/upload/private/${privatePathOrId.replace(/^\//, '')}`;
        })();
  const res = await fetch(fullUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'image/*, application/pdf, */*',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? 'Could not load file');
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000);
  return blobUrl;
}
