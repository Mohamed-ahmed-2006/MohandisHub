import type {
  ApiSuccessBody,
  CallExtensionBody,
  CallHeartbeatBody,
  CallJoinBody,
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
  RespondLocationBody,
  UpdateReservationProfileBody,
  UpdateReservationSlotBody,
} from '@mohandishub/shared';

import { getApiBaseUrl } from '@/lib/env';

async function apiReq<T>(path: string, token: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? 'Request failed');
  }
  const json = (await res.json()) as ApiSuccessBody<T>;
  return json.data;
}

export const reservationsApiClient = {
  getMyProfile: (token: string): Promise<ReservationProfile> =>
    apiReq('/api/reservations/profile/me', token),

  getProviderProfile: (token: string, providerId: string): Promise<ReservationProfile> =>
    apiReq(`/api/reservations/profile/${providerId}`, token),

  updateMyProfile: (token: string, body: UpdateReservationProfileBody): Promise<ReservationProfile> =>
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

  updateSlot: (token: string, slotId: string, body: UpdateReservationSlotBody): Promise<ReservationSlot> =>
    apiReq(`/api/reservations/slots/${slotId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteSlot: (token: string, slotId: string): Promise<{ deleted: boolean }> =>
    apiReq(`/api/reservations/slots/${slotId}`, token, {
      method: 'DELETE',
    }),

  createReservation: (token: string, body: CreateReservationBody): Promise<Reservation> =>
    apiReq('/api/reservations', token, {
      method: 'POST',
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
      body: JSON.stringify(body),
    }),

  listLocationProposals: (token: string, reservationId: string): Promise<ReservationLocationProposal[]> =>
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
};
