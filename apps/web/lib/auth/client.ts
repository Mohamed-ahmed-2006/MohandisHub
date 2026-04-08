import type {
  ApiErrorBody,
  ApiSuccessBody,
  AuthUser,
  AuthMessageResult,
  ForgotPasswordBody,
  LoginBody,
  OtpChannel,
  RegisterBody,
  ResetPasswordBody,
  SendOtpResult,
  VerifyOtpResult,
} from '@mohandishub/shared';

import { getAuthApiBaseUrl } from '@/lib/env';

type AuthEnvelope = {
  user: AuthUser;
  tokens: {
    accessToken: string;
    expiresIn: number;
  };
};

type ApiRequestOptions = {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  accessToken?: string;
};

export type ApiClientError = {
  code: string;
  message: string;
  details?: unknown;
  status: number;
};

export class ApiClientRequestError extends Error implements ApiClientError {
  public readonly code: string;
  public readonly details?: unknown;
  public readonly status: number;

  public constructor({ code, message, details, status }: ApiClientError) {
    super(message);
    this.name = 'ApiClientRequestError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const isApiClientError = (error: unknown): error is ApiClientError =>
  error instanceof ApiClientRequestError;

const isApiErrorBody = (value: unknown): value is ApiErrorBody => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const maybeError = (value as { error?: unknown }).error;

  if (!maybeError || typeof maybeError !== 'object') {
    return false;
  }

  const code = (maybeError as { code?: unknown }).code;
  const message = (maybeError as { message?: unknown }).message;

  return typeof code === 'string' && typeof message === 'string';
};

const apiRequest = async <T>({
  method,
  path,
  body,
  accessToken,
}: ApiRequestOptions): Promise<T> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const requestInit: RequestInit = {
    method,
    credentials: 'include',
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  };

  const response = await fetch(`${getAuthApiBaseUrl()}${path}`, requestInit);

  if (!response.ok) {
    const rawErrorBody: unknown = await response.json().catch(() => null);

    if (isApiErrorBody(rawErrorBody)) {
      throw new ApiClientRequestError({
        code: rawErrorBody.error.code,
        message: rawErrorBody.error.message,
        status: response.status,
        ...(rawErrorBody.error.details !== undefined
          ? {
              details: rawErrorBody.error.details,
            }
          : {}),
      });
    }

    throw new ApiClientRequestError({
      code: 'HTTP_ERROR',
      message: `Request failed with status ${response.status}`,
      status: response.status,
    });
  }

  const rawBody = (await response.json()) as ApiSuccessBody<T>;

  return rawBody.data;
};

export const authApiClient = {
  register: async (payload: RegisterBody): Promise<AuthEnvelope> => {
    return apiRequest<AuthEnvelope>({
      method: 'POST',
      path: '/api/auth/register',
      body: payload,
    });
  },
  login: async (payload: LoginBody): Promise<AuthEnvelope> => {
    return apiRequest<AuthEnvelope>({
      method: 'POST',
      path: '/api/auth/login',
      body: payload,
    });
  },
  forgotPassword: async (payload: ForgotPasswordBody): Promise<AuthMessageResult> => {
    return apiRequest<AuthMessageResult>({
      method: 'POST',
      path: '/api/auth/forgot-password',
      body: payload,
    });
  },
  resetPassword: async (payload: ResetPasswordBody): Promise<AuthMessageResult> => {
    return apiRequest<AuthMessageResult>({
      method: 'POST',
      path: '/api/auth/reset-password',
      body: payload,
    });
  },
  refresh: async (): Promise<AuthEnvelope> => {
    return apiRequest<AuthEnvelope>({
      method: 'POST',
      path: '/api/auth/refresh',
    });
  },
  me: async (accessToken: string): Promise<AuthUser> => {
    return apiRequest<AuthUser>({
      method: 'GET',
      path: '/api/auth/me',
      accessToken,
    });
  },
  logout: async (): Promise<{ message: string }> => {
    return apiRequest<{ message: string }>({
      method: 'POST',
      path: '/api/auth/logout',
    });
  },
  sendOtp: async (accessToken: string, channel: OtpChannel): Promise<SendOtpResult> => {
    return apiRequest<SendOtpResult>({
      method: 'POST',
      path: '/api/otp/send',
      body: { channel },
      accessToken,
    });
  },
  verifyOtp: async (
    accessToken: string,
    channel: OtpChannel,
    code: string,
  ): Promise<VerifyOtpResult> => {
    return apiRequest<VerifyOtpResult>({
      method: 'POST',
      path: '/api/otp/verify',
      body: { channel, code },
      accessToken,
    });
  },
};
