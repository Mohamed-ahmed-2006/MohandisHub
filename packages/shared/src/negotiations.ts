// ---------------------------------------------------------------------------
// Price negotiations — customer / provider counter-offers before booking
// ---------------------------------------------------------------------------

export type NegotiationStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'consumed';

export type PriceNegotiation = {
  id: string;
  serviceId: string;
  customerId: string;
  providerId: string;
  status: NegotiationStatus;
  originalPrice: number | null;
  agreedPrice: number | null;
  latestAmount: number;
  latestOfferedBy: string;
  currency: string;
  expiresAt: string;
  agreedValidUntil: string | null;
  createdAt: string;
  updatedAt: string;
  serviceTitle?: string;
  customerName?: string;
  providerName?: string;
};

export type NegotiationRound = {
  id: string;
  negotiationId: string;
  offeredBy: string;
  amount: number;
  message: string | null;
  createdAt: string;
};

export type CreateNegotiationBody = {
  serviceId: string;
  offeredPrice: number;
  message?: string;
};

export type RespondNegotiationBody = {
  decision: 'accept' | 'reject' | 'counter';
  counterPrice?: number;
  message?: string;
  /** Required when decision is 'accept'; hours until agreed price expires for booking */
  validForHours?: number;
};

export type NegotiationDetailResponse = {
  negotiation: PriceNegotiation;
  rounds: NegotiationRound[];
};

export type NegotiationListResponse = {
  items: PriceNegotiation[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};
