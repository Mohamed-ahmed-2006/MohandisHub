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

const UPLOADS_BUCKET = 'uploads';
const VERIFICATION_DOCS_BUCKET = 'verification-docs';

export type UploadResult = { url: string; path: string };

export type PrivateUploadResult = { path: string };

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
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${filename}`;
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
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${filename}`;
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
