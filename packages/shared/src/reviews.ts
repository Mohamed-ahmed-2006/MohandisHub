// ---------------------------------------------------------------------------
// Review types — shared between API and frontend
// ---------------------------------------------------------------------------

export type Review = {
  id: string;
  reviewerId: string;
  targetUserId: string;
  targetType: 'expert' | 'business' | 'customer';
  reservationId: string | null;
  bookingId: string | null;
  needId: string | null;
  rating: number;
  comment: string | null;
  createdAt: string;
  reviewerName?: string;
};

export type CreateReviewBody = {
  reservationId?: string;
  bookingId?: string;
  needId?: string;
  rating: number;
  comment?: string;
};
