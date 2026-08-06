import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env } from '../config/env.js';

let client: SupabaseClient | null = null;

export function getSupabaseStorageClient(): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return client;
}

export function isSupabaseStorageConfigured(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

export const UPLOADS_BUCKET = 'uploads';
export const VERIFICATION_DOCS_BUCKET = 'verification-docs';

/** Supabase public URL pattern: .../storage/v1/object/public/{bucket}/{path} */
const PUBLIC_OBJECT_URL_RE = /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Extract storage object path for our public `uploads` bucket from a full URL, or null if not a match.
 */
export function parsePublicUploadsPathFromUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  try {
    const parsed = new URL(u);
    const m = parsed.pathname.match(PUBLIC_OBJECT_URL_RE);
    if (!m) return null;
    const bucket = decodeURIComponent(m[1]!);
    const objectPath = decodeURIComponent(m[2]!);
    if (bucket !== UPLOADS_BUCKET) return null;
    if (!objectPath || objectPath.includes('..')) return null;
    return objectPath;
  } catch {
    return null;
  }
}

/**
 * `/uploads/{filename}` on API host → local basename (same as public-uploads middleware).
 */
export function parseLocalUploadsBasenameFromUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  try {
    const parsed = new URL(u, 'http://localhost');
    const path = parsed.pathname.replace(/\/+$/, '');
    const m = path.match(/^\/uploads\/([^/]+)$/);
    if (!m) return null;
    const base = m[1]!;
    if (!base || base.includes('..') || base.includes('/') || base.includes('\\')) return null;
    return base;
  } catch {
    return null;
  }
}

/** Resolve public uploads URL to either `{ kind: 'supabase', path }` or `{ kind: 'local', basename }`. */
export function resolvePublicUploadRef(
  url: string,
): { kind: 'supabase'; path: string } | { kind: 'local'; basename: string } | null {
  const supa = parsePublicUploadsPathFromUrl(url);
  if (supa) return { kind: 'supabase', path: supa };
  const local = parseLocalUploadsBasenameFromUrl(url);
  if (local) return { kind: 'local', basename: local };
  return null;
}

/** Extract a private upload id from `/api/upload/private/:id` or an absolute API URL. */
export function parsePrivateUploadIdFromUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  try {
    const parsed = new URL(u, 'http://localhost');
    const path = parsed.pathname.replace(/\/+$/, '');
    const m = path.match(/^\/api\/upload\/private\/([^/]+)$/);
    if (!m) return null;
    const id = m[1]!;
    return UUID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function deleteObjectsFromBucket(bucket: string, paths: string[]): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;
  const supabase = getSupabaseStorageClient();
  if (!supabase) return;
  const { error } = await supabase.storage.from(bucket).remove(unique);
  if (error) {
    throw new Error(`Supabase delete failed: ${error.message}`);
  }
}

export type UploadResult = { url: string; path: string };

export type PrivateUploadResult = { path: string };

const safeStorageFilename = (filename: string): string => {
  const normalized = filename
    .replaceAll('\\', '_')
    .replaceAll('/', '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.\.+/g, '_');
  return normalized && normalized !== '.' && normalized !== '..' ? normalized : 'upload';
};

/** Upload to public bucket; returns public URL. Use for non-sensitive assets only. */
export async function uploadToSupabase(
  buffer: Buffer,
  filename: string,
  contentType: string,
): Promise<UploadResult> {
  const supabase = getSupabaseStorageClient();
  if (!supabase) {
    throw new Error('Supabase Storage is not configured');
  }
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeStorageFilename(filename)}`;
  const { data, error } = await supabase.storage.from(UPLOADS_BUCKET).upload(path, buffer, {
    contentType,
    upsert: false,
  });
  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }
  const { data: urlData } = supabase.storage.from(UPLOADS_BUCKET).getPublicUrl(data.path);
  return { url: urlData.publicUrl, path: data.path };
}

/** Upload to private bucket (verification-docs). Returns storage path only; do not return public URL. */
export async function uploadToSupabasePrivate(
  buffer: Buffer,
  filename: string,
  contentType: string,
): Promise<PrivateUploadResult> {
  const supabase = getSupabaseStorageClient();
  if (!supabase) {
    throw new Error('Supabase Storage is not configured');
  }
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeStorageFilename(filename)}`;
  const { error } = await supabase.storage.from(VERIFICATION_DOCS_BUCKET).upload(path, buffer, {
    contentType,
    upsert: false,
  });
  if (error) {
    throw new Error(`Supabase private upload failed: ${error.message}`);
  }
  return { path };
}

/** Create a short-lived signed URL for a file in a private bucket. Expiry in seconds. */
export async function createPrivateSignedUrl(
  bucket: string,
  path: string,
  expirySeconds: number,
): Promise<string> {
  const supabase = getSupabaseStorageClient();
  if (!supabase) {
    throw new Error('Supabase Storage is not configured');
  }
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expirySeconds);
  if (error) {
    throw new Error(`Signed URL failed: ${error.message}`);
  }
  if (!data?.signedUrl) {
    throw new Error('No signed URL returned');
  }
  return data.signedUrl;
}
