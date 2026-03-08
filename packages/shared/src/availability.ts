// ---------------------------------------------------------------------------
// Availability slot types — shared between API and frontend
// ---------------------------------------------------------------------------

export type SlotStatus = 'available' | 'booked' | 'blocked';

export type AvailabilitySlot = {
  id: string;
  providerId: string;
  startAt: string;
  endAt: string;
  status: SlotStatus;
  bookingId: string | null;
  createdAt: string;
};

export type CreateSlotBody = {
  startAt: string;
  endAt: string;
};

export type CreateSlotsBody = {
  slots: Array<{ startAt: string; endAt: string }>;
};

export type UpdateSlotBody = {
  status?: SlotStatus;
  startAt?: string;
  endAt?: string;
};
