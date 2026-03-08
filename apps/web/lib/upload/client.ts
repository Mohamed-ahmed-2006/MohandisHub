import { getApiBaseUrl } from '@/lib/env';

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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- res.json() returns any
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: { message?: string } })?.error?.message ?? 'Upload failed');
  }

  const json = (await res.json()) as unknown as {
    data: { url: string; filename: string; originalName: string };
  };
  return json.data;
}
