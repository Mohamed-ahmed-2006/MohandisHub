// ---------------------------------------------------------------------------
// Booking types — shared between API and frontend
// ---------------------------------------------------------------------------

export type BookingStatus =
  | 'pending_payment'
  | 'paid'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'refunded';

export type Booking = {
  id: string;
  customerId: string;
  providerId: string;
  serviceId: string | null;
  needId: string | null;
  amount: number;
  currency: string;
  commissionAmount: number;
  providerAmount: number;
  status: BookingStatus;
  slotStartAt: string | null;
  slotEndAt: string | null;
  paymentTransactionId: string | null;
  createdAt: string;
  updatedAt: string;
  serviceTitle?: string;
  providerName?: string;
  customerName?: string;
};

export type CreateBookingBody = {
  serviceId: string;
  slotStartAt: string;
  slotEndAt: string;
};

export type UpdateBookingBody = {
  status?: BookingStatus;
};
