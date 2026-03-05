import type {
  AcademicRecord,
  ApiErrorBody,
  ApiSuccessBody,
  AuthUser,
  BusinessProfile,
  ExpertProfile,
  IdentityDocument,
  LoginBody,
  RegisterBody,
  SendOtpResult,
  VerifyOtpResult,
} from '@mohandishub/shared';

import { getApiBaseUrl } from '@/lib/env';

type AuthEnvelope = {
  user: AuthUser;
  tokens: {
    accessToken: string;
    expiresIn: number;
  };
};

type ApiRequestOptions = {
  method: 'GET' | 'POST' | 'PATCH';
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

  const response = await fetch(`${getApiBaseUrl()}${path}`, requestInit);

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
  sendOtp: async (
    accessToken: string,
    channel: 'email' | 'phone',
  ): Promise<SendOtpResult> => {
    return apiRequest<SendOtpResult>({
      method: 'POST',
      path: '/api/otp/send',
      body: { channel },
      accessToken,
    });
  },
  verifyOtp: async (
    accessToken: string,
    channel: 'email' | 'phone',
    code: string,
  ): Promise<VerifyOtpResult> => {
    return apiRequest<VerifyOtpResult>({
      method: 'POST',
      path: '/api/otp/verify',
      body: { channel, code },
      accessToken,
    });
  },
  initiateVerification: async (
    accessToken: string,
    params: { email: string; displayName: string },
  ): Promise<{ requestId: string; redirectUrl?: string; sessionToken?: string }> => {
    return apiRequest<{ requestId: string; redirectUrl?: string; sessionToken?: string }>({
      method: 'POST',
      path: '/api/verification/initiate',
      body: params,
      accessToken,
    });
  },
  getVerificationStatus: async (
    accessToken: string,
  ): Promise<{ verificationStatus: string }> => {
    return apiRequest<{ verificationStatus: string }>({
      method: 'GET',
      path: '/api/verification/status',
      accessToken,
    });
  },
};

/** Profiles API (requires auth). Pass accessToken from useAuth(). */
export const profilesApiClient = {
  getExpertProfile: async (accessToken: string): Promise<ExpertProfile> => {
    return apiRequest<ExpertProfile>({
      method: 'GET',
      path: '/api/profiles/expert',
      accessToken,
    });
  },
  updateExpertProfile: async (
    accessToken: string,
    body: Partial<{
      title: string;
      headline: string;
      bio: string;
      specializations: string[];
      yearsOfExperience: number;
      hourlyRate: number;
      city: string;
      country: string;
      employer: string;
      jobTitle: string;
      linkedinUrl: string;
      portfolioUrl: string;
      languages: string[];
      educationSummary: string;
      profileVisibility: 'public' | 'unlisted' | 'draft';
      profileCompletedAt: string | null;
    }>,
  ): Promise<ExpertProfile> => {
    return apiRequest<ExpertProfile>({
      method: 'PATCH',
      path: '/api/profiles/expert',
      body,
      accessToken,
    });
  },
  getBusinessProfile: async (accessToken: string): Promise<BusinessProfile> => {
    return apiRequest<BusinessProfile>({
      method: 'GET',
      path: '/api/profiles/business',
      accessToken,
    });
  },
  updateBusinessProfile: async (
    accessToken: string,
    body: Partial<{
      companyName: string;
      tradeLicenseNumber: string;
      taxId: string;
      commercialRegister: string;
      industry: string;
      companySize: string;
      website: string;
      companyEmail: string;
      companyPhone: string;
      address: string;
      logoUrl: string;
      city: string;
      country: string;
      description: string;
      ownerFullName: string;
      ownerTitle: string;
      ownerEmail: string;
      ownerPhone: string;
      socialFacebook: string;
      socialLinkedin: string;
      socialTwitter: string;
      employeesCount: number;
      foundedYear: number;
      profileVisibility: 'public' | 'unlisted' | 'draft';
      profileCompletedAt: string | null;
    }>,
  ): Promise<BusinessProfile> => {
    return apiRequest<BusinessProfile>({
      method: 'PATCH',
      path: '/api/profiles/business',
      body,
      accessToken,
    });
  },
  submitIdentityDocument: async (
    accessToken: string,
    body: {
      documentType: 'national_id' | 'driving_license' | 'passport';
      fullNameOnDoc: string;
      documentNumber?: string;
      dateOfBirth?: string;
      nationality?: string;
      frontImageUrl?: string;
      backImageUrl?: string;
      selfieImageUrl?: string;
    },
  ): Promise<IdentityDocument> => {
    return apiRequest<IdentityDocument>({
      method: 'POST',
      path: '/api/profiles/identity-documents',
      body,
      accessToken,
    });
  },
  getIdentityDocuments: async (accessToken: string): Promise<IdentityDocument[]> => {
    return apiRequest<IdentityDocument[]>({
      method: 'GET',
      path: '/api/profiles/identity-documents',
      accessToken,
    });
  },
  submitAcademicRecord: async (
    accessToken: string,
    body: {
      recordType: 'degree' | 'diploma' | 'certificate' | 'license';
      title: string;
      institution: string;
      fieldOfStudy?: string;
      graduationYear?: number;
      grade?: string;
      certificateImageUrl?: string;
      transcriptImageUrl?: string;
    },
  ): Promise<AcademicRecord> => {
    return apiRequest<AcademicRecord>({
      method: 'POST',
      path: '/api/profiles/academic-records',
      body,
      accessToken,
    });
  },
  getAcademicRecords: async (accessToken: string): Promise<AcademicRecord[]> => {
    return apiRequest<AcademicRecord[]>({
      method: 'GET',
      path: '/api/profiles/academic-records',
      accessToken,
    });
  },
};
