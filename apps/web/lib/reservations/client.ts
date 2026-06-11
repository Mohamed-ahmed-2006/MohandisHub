import type {
  ApiErrorBody,
  ApiSuccessBody,
  CallExtensionBody,
  CallHeartbeatBody,
  CallJoinBody,
  CancelReservationBody,
  ConfirmCheckInBody,
  CreateReservationBody,
  CreateReservationSlotBody,
  DecideReservationBody,
  EndCallBody,
  FinishReservationBody,
  ProposeLocationBody,
  Reservation,
  ReservationCallSnapshot,
  ReservationDispute,
  ReservationLocationProposal,
  ReservationProfile,
  ReservationSlot,
  ReservationTimelineEvent,
  RespondLocationBody,
  UpdateReservationProfileBody,
  UpdateReservationSlotBody,
} from '@mohandishub/shared';

import { ApiClientRequestError } from '@/lib/auth/client';
import { fetchWithAuthRetry } from '@/lib/auth/fetch-with-auth-retry';
import { getApiBaseUrl } from '@/lib/env';

const createIdempotencyKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;

async function apiReq<T>(path: string, token: string, opts?: RequestInit): Promise<T> {
  const res = await fetchWithAuthRetry(
    `${getApiBaseUrl()}${path}`,
    {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(opts?.headers ?? {}),
      },
    },
    token,
  );
  if (!res.ok) {
    const rawErrorBody: unknown = await res.json().catch(() => null);
    const maybeError = rawErrorBody as ApiErrorBody | null;

    if (maybeError?.error) {
      throw new ApiClientRequestError({
        code: maybeError.error.code,
        message: maybeError.error.message,
        status: res.status,
        details: maybeError.error.details,
      });
    }

    throw new ApiClientRequestError({
      code: 'HTTP_ERROR',
      message: `Request failed with status ${res.status}`,
      status: res.status,
    });
  }
  const json = (await res.json()) as ApiSuccessBody<T>;
  return json.data;
}

export const reservationsApiClient = {
  getMyProfile: (token: string): Promise<ReservationProfile> =>
    apiReq('/api/reservations/profile/me', token),

  getProviderProfile: (token: string, providerId: string): Promise<ReservationProfile> =>
    apiReq(`/api/reservations/profile/${providerId}`, token),

  updateMyProfile: (
    token: string,
    body: UpdateReservationProfileBody,
  ): Promise<ReservationProfile> =>
    apiReq('/api/reservations/profile/me', token, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  listSlots: (
    token: string,
    params: { providerId?: string; from: string; to: string; availableOnly?: boolean },
  ): Promise<{ items: ReservationSlot[] }> => {
    const q = new URLSearchParams();
    if (params.providerId) q.set('providerId', params.providerId);
    q.set('from', params.from);
    q.set('to', params.to);
    if (params.availableOnly) q.set('availableOnly', 'true');
    return apiReq(`/api/reservations/slots?${q.toString()}`, token);
  },

  createSlot: (token: string, body: CreateReservationSlotBody): Promise<ReservationSlot> =>
    apiReq('/api/reservations/slots', token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateSlot: (
    token: string,
    slotId: string,
    body: UpdateReservationSlotBody,
  ): Promise<ReservationSlot> =>
    apiReq(`/api/reservations/slots/${slotId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteSlot: (token: string, slotId: string): Promise<{ deleted: boolean }> =>
    apiReq(`/api/reservations/slots/${slotId}`, token, {
      method: 'DELETE',
    }),

  createReservation: (
    token: string,
    body: CreateReservationBody,
    idempotencyKey?: string,
  ): Promise<Reservation> =>
    apiReq('/api/reservations', token, {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey ?? createIdempotencyKey(),
      },
      body: JSON.stringify(body),
    }),

  listMyReservations: (
    token: string,
    params: { role?: 'customer' | 'provider'; page?: number; limit?: number },
  ): Promise<{
    items: Reservation[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> => {
    const q = new URLSearchParams();
    if (params.role) q.set('role', params.role);
    if (params.page) q.set('page', String(params.page));
    if (params.limit) q.set('limit', String(params.limit));
    return apiReq(`/api/reservations/my${q.toString() ? `?${q.toString()}` : ''}`, token);
  },

  getReservationById: (token: string, reservationId: string): Promise<Reservation> =>
    apiReq(`/api/reservations/${reservationId}`, token),

  decideReservation: (
    token: string,
    reservationId: string,
    body: DecideReservationBody,
  ): Promise<Reservation> =>
    apiReq(`/api/reservations/${reservationId}/decision`, token, {
      method: 'POST',
      headers: {
        'Idempotency-Key': createIdempotencyKey(),
      },
      body: JSON.stringify(body),
    }),

  cancelReservation: (
    token: string,
    reservationId: string,
    body: CancelReservationBody,
  ): Promise<Reservation> =>
    apiReq(`/api/reservations/${reservationId}/cancel`, token, {
      method: 'POST',
      headers: {
        'Idempotency-Key': createIdempotencyKey(),
      },
      body: JSON.stringify(body),
    }),

  listReservationTimeline: (
    token: string,
    reservationId: string,
  ): Promise<ReservationTimelineEvent[]> =>
    apiReq(`/api/reservations/${reservationId}/timeline`, token),

  listLocationProposals: (
    token: string,
    reservationId: string,
  ): Promise<ReservationLocationProposal[]> =>
    apiReq(`/api/reservations/${reservationId}/location`, token),

  proposeLocation: (
    token: string,
    reservationId: string,
    body: ProposeLocationBody,
  ): Promise<ReservationLocationProposal> =>
    apiReq(`/api/reservations/${reservationId}/location/propose`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  respondLocation: (
    token: string,
    reservationId: string,
    body: RespondLocationBody,
  ): Promise<{ proposal: ReservationLocationProposal; reservation: Reservation }> =>
    apiReq(`/api/reservations/${reservationId}/location/respond`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getOfflineCheckinCodes: (
    token: string,
    reservationId: string,
  ): Promise<{
    myCode: string;
    expiresAt: string;
    myVerifiedAt: string | null;
    counterpartyVerifiedAt: string | null;
  }> => apiReq(`/api/reservations/${reservationId}/offline/checkin-codes`, token),

  confirmOfflineCheckin: (
    token: string,
    reservationId: string,
    body: ConfirmCheckInBody,
  ): Promise<{
    reservation: Reservation;
    myVerifiedAt: string | null;
    counterpartyVerifiedAt: string | null;
  }> =>
    apiReq(`/api/reservations/${reservationId}/offline/checkin`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  finishReservation: (
    token: string,
    reservationId: string,
    body: FinishReservationBody,
  ): Promise<{ reservation: Reservation; dispute?: ReservationDispute }> =>
    apiReq(`/api/reservations/${reservationId}/finish`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  joinCall: (
    token: string,
    reservationId: string,
    body: CallJoinBody,
  ): Promise<{
    token: string;
    appId: string;
    channel: string;
    uid: number;
    tokenExpiresAt: number;
    snapshot: ReservationCallSnapshot;
  }> =>
    apiReq(`/api/reservations/${reservationId}/call/join`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  callHeartbeat: (
    token: string,
    reservationId: string,
    body: CallHeartbeatBody,
  ): Promise<ReservationCallSnapshot> =>
    apiReq(`/api/reservations/${reservationId}/call/heartbeat`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  callExtension: (
    token: string,
    reservationId: string,
    body: CallExtensionBody,
  ): Promise<ReservationCallSnapshot> =>
    apiReq(`/api/reservations/${reservationId}/call/extension`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  endCall: (
    token: string,
    reservationId: string,
    body: EndCallBody,
  ): Promise<ReservationCallSnapshot> =>
    apiReq(`/api/reservations/${reservationId}/call/end`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  callSnapshot: (token: string, reservationId: string): Promise<ReservationCallSnapshot> =>
    apiReq(`/api/reservations/${reservationId}/call/snapshot`, token),

  renewCallToken: (
    token: string,
    reservationId: string,
  ): Promise<{
    token: string;
    appId: string;
    channel: string;
    uid: number;
    tokenExpiresAt: number;
  }> =>
    apiReq(`/api/reservations/${reservationId}/call/renew-token`, token, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
