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

/** Resolve private file path (e.g. /api/upload/private/:id) to a short-lived signed URL. Use for "View CV" etc. */
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
