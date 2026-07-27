import { env } from '../../config/env.js';
import { fetchWithTimeout } from '../../lib/fetch-with-timeout.js';
import { HttpError } from '../../utils/http-error.js';

export type BackupProviderName = 'supabase' | 'custom_http' | 'disabled';

export type BackupProviderStatus = {
  provider: BackupProviderName;
  configured: boolean;
  status: string;
  latestBackupReference: string | null;
  latestBackupAt: string | null;
  raw?: unknown;
};

export type BackupRestoreResult = {
  provider: BackupProviderName;
  providerOperationId: string | null;
  result: Record<string, unknown>;
};

type ProviderRequestOptions = {
  method?: 'GET' | 'POST';
  path: string;
  body?: unknown;
};

const jsonFetch = async (
  url: string,
  headers: Record<string, string>,
  options: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<unknown> => {
  const response = await fetchWithTimeout(
    url,
    {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(options.body != null ? { body: JSON.stringify(options.body) } : {}),
    },
    { timeoutMs: 15_000 },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof data === 'object' && data && 'message' in data && typeof data.message === 'string'
        ? data.message
        : `Backup provider returned ${response.status}`;
    throw new HttpError({
      statusCode: 502,
      code: 'BACKUP_PROVIDER_ERROR',
      message,
      details: { status: response.status },
    });
  }
  return data;
};

const getSupabaseHeaders = () => ({ Authorization: `Bearer ${env.BACKUP_SUPABASE_ACCESS_TOKEN}` });

const supabaseUrl = (path: string) => {
  if (!env.BACKUP_SUPABASE_PROJECT_REF || !env.BACKUP_SUPABASE_ACCESS_TOKEN) {
    throw new HttpError({
      statusCode: 503,
      code: 'BACKUP_PROVIDER_NOT_CONFIGURED',
      message: 'Supabase backup provider is not configured.',
    });
  }
  return `${env.BACKUP_SUPABASE_BASE_URL}/v1/projects/${env.BACKUP_SUPABASE_PROJECT_REF}${path}`;
};

const getLatestFromList = (
  data: unknown,
): { latestBackupReference: string | null; latestBackupAt: string | null } => {
  const list = Array.isArray(data)
    ? data
    : typeof data === 'object' && data && Array.isArray((data as { backups?: unknown }).backups)
      ? (data as { backups: unknown[] }).backups
      : [];
  const first = list[0] as Record<string, unknown> | undefined;
  const ref =
    typeof first?.id === 'string'
      ? first.id
      : typeof first?.name === 'string'
        ? first.name
        : typeof first?.created_at === 'string'
          ? first.created_at
          : null;
  const at =
    typeof first?.created_at === 'string'
      ? first.created_at
      : typeof first?.inserted_at === 'string'
        ? first.inserted_at
        : null;
  return { latestBackupReference: ref, latestBackupAt: at };
};

const callCustomProvider = async (options: ProviderRequestOptions): Promise<unknown> => {
  if (!env.BACKUP_CUSTOM_BASE_URL || !env.BACKUP_CUSTOM_API_KEY) {
    throw new HttpError({
      statusCode: 503,
      code: 'BACKUP_PROVIDER_NOT_CONFIGURED',
      message: 'Custom backup provider is not configured.',
    });
  }
  return jsonFetch(
    `${env.BACKUP_CUSTOM_BASE_URL}${options.path}`,
    {
      Authorization: `Bearer ${env.BACKUP_CUSTOM_API_KEY}`,
    },
    options,
  );
};

export const getBackupProviderStatus = async (): Promise<BackupProviderStatus> => {
  if (env.BACKUP_PROVIDER === 'disabled') {
    return {
      provider: 'disabled',
      configured: false,
      status: 'disabled',
      latestBackupReference: null,
      latestBackupAt: null,
    };
  }
  if (env.BACKUP_PROVIDER === 'supabase') {
    const data = await jsonFetch(supabaseUrl('/database/backups'), getSupabaseHeaders());
    return {
      provider: 'supabase',
      configured: true,
      status: 'ok',
      ...getLatestFromList(data),
      raw: data,
    };
  }
  const data = await callCustomProvider({ path: env.BACKUP_CUSTOM_STATUS_PATH });
  const obj = typeof data === 'object' && data ? (data as Record<string, unknown>) : {};
  return {
    provider: 'custom_http',
    configured: true,
    status: typeof obj.status === 'string' ? obj.status : 'ok',
    latestBackupReference:
      typeof obj.latestBackupReference === 'string' ? obj.latestBackupReference : null,
    latestBackupAt: typeof obj.latestBackupAt === 'string' ? obj.latestBackupAt : null,
    raw: data,
  };
};

export const runBackupProviderDryRun = async (
  backupReference: string,
): Promise<BackupRestoreResult> => {
  if (env.BACKUP_PROVIDER === 'supabase') {
    return {
      provider: 'supabase',
      providerOperationId: null,
      result: {
        valid: /^\d+$/.test(backupReference),
        requiresUnixPitrTimestamp: true,
        backupReference,
      },
    };
  }
  if (env.BACKUP_PROVIDER === 'custom_http') {
    const data = await callCustomProvider({
      method: 'POST',
      path: env.BACKUP_CUSTOM_DRY_RUN_PATH,
      body: { backupReference },
    });
    return {
      provider: 'custom_http',
      providerOperationId:
        typeof data === 'object' &&
        data &&
        typeof (data as { operationId?: unknown }).operationId === 'string'
          ? (data as { operationId: string }).operationId
          : null,
      result: { response: data },
    };
  }
  throw new HttpError({
    statusCode: 503,
    code: 'BACKUP_PROVIDER_DISABLED',
    message: 'Backup provider is disabled.',
  });
};

export const runBackupProviderRestore = async (
  backupReference: string,
): Promise<BackupRestoreResult> => {
  if (env.BACKUP_PROVIDER === 'supabase') {
    if (!/^\d+$/.test(backupReference)) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_SUPABASE_RESTORE_REFERENCE',
        message: 'Supabase PITR restore requires a Unix timestamp backup reference.',
      });
    }
    const data = await jsonFetch(
      supabaseUrl('/database/backups/restore-pitr'),
      getSupabaseHeaders(),
      {
        method: 'POST',
        body: { recovery_time_target_unix: backupReference },
      },
    );
    return {
      provider: 'supabase',
      providerOperationId:
        typeof data === 'object' && data && typeof (data as { id?: unknown }).id === 'string'
          ? (data as { id: string }).id
          : null,
      result: { response: data },
    };
  }
  if (env.BACKUP_PROVIDER === 'custom_http') {
    const data = await callCustomProvider({
      method: 'POST',
      path: env.BACKUP_CUSTOM_RESTORE_PATH,
      body: { backupReference },
    });
    return {
      provider: 'custom_http',
      providerOperationId:
        typeof data === 'object' &&
        data &&
        typeof (data as { operationId?: unknown }).operationId === 'string'
          ? (data as { operationId: string }).operationId
          : null,
      result: { response: data },
    };
  }
  throw new HttpError({
    statusCode: 503,
    code: 'BACKUP_PROVIDER_DISABLED',
    message: 'Backup provider is disabled.',
  });
};
