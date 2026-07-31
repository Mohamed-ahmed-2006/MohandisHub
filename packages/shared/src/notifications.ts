// ---------------------------------------------------------------------------
// Notifications — shared types for API and frontend
// ---------------------------------------------------------------------------

/** System event types that trigger notifications; admin-sent uses 'admin'. */
export type NotificationType =
  // Jobs
  | 'job_application'
  | 'job_interview_booked'
  | 'application_status'
  | 'milestone_submitted'
  | 'milestone_reviewed'
  | 'new_message'
  // Reservations
  | 'reservation_created'
  | 'reservation_accepted'
  | 'reservation_rejected'
  | 'reservation_cancelled'
  | 'reservation_completed'
  | 'reservation_started'
  | 'reservation_disputed'
  | 'reservation_dispute_resolved'
  | 'reservation_expired'
  | 'reservation_location_proposed'
  // Negotiations
  | 'price_negotiation'
  // Needs / bids
  | 'need_bid_received'
  | 'need_bid_awarded'
  | 'need_bid_rejected'
  | 'need_bid_paid'
  | 'need_closed'
  // Services (admin moderation)
  | 'service_approved'
  | 'service_rejected'
  | 'service_paused_by_admin'
  // Reviews
  | 'review_received'
  | 'review_report_resolved'
  | 'review_dispute_resolved'
  // Wallet (legacy)
  | 'wallet_deposit_approved'
  | 'wallet_deposit_rejected'
  | 'wallet_withdrawal_completed'
  | 'wallet_withdrawal_rejected'
  | 'wallet_deposit_confirmed'
  // MHC
  | 'mhc_purchase_completed'
  | 'mhc_purchase_failed'
  // Advertisements — weekly billing and automatic renewal
  | 'advertisement_activated'
  | 'advertisement_renewed'
  | 'advertisement_renewal_failed_credits'
  | 'advertisement_renewal_failed_pricing'
  | 'advertisement_renewal_required'
  | 'advertisement_renewal_reminder'
  | 'advertisement_auto_renew_stopped_max_weeks'
  | 'advertisement_auto_renew_stopped_end_date'
  | 'advertisement_auto_renew_enabled'
  | 'advertisement_auto_renew_disabled'
  // Chat
  | 'chat_message'
  // System
  | 'admin'
  | 'demo';

export interface NotificationPayload {
  jobId?: string;
  applicationId?: string;
  reservationId?: string;
  negotiationId?: string;
  needId?: string;
  bidId?: string;
  serviceId?: string;
  reviewId?: string;
  conversationId?: string;
  depositId?: string;
  withdrawalId?: string;
  advertisementId?: string;
  /** i18n template params for notification bodies (optional) */
  [key: string]: unknown;
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  payload: NotificationPayload | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResponse {
  items: Notification[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Base path for in-app navigation when clicking a notification.
 * Frontend may append query (e.g. ?id=) or use payload for detail routes.
 */
/** Base paths match Next.js routes under `/[locale]/app/…`. */
export const NOTIFICATION_NAVIGATION_MAP: Partial<Record<NotificationType, string>> = {
  job_application: '/app/projects',
  job_interview_booked: '/app/projects',
  application_status: '/app/projects',
  milestone_submitted: '/app/projects',
  milestone_reviewed: '/app/projects',
  new_message: '/app/projects',
  reservation_created: '/app/bookings',
  reservation_accepted: '/app/bookings',
  reservation_rejected: '/app/bookings',
  reservation_cancelled: '/app/bookings',
  reservation_completed: '/app/bookings',
  reservation_started: '/app/bookings',
  reservation_disputed: '/app/bookings',
  reservation_dispute_resolved: '/app/bookings',
  reservation_expired: '/app/bookings',
  reservation_location_proposed: '/app/bookings',
  price_negotiation: '/app/negotiations',
  need_bid_received: '/app',
  need_bid_awarded: '/app',
  need_bid_rejected: '/app',
  need_bid_paid: '/app',
  need_closed: '/app',
  service_approved: '/app/services',
  service_rejected: '/app/services',
  service_paused_by_admin: '/app/services',
  review_received: '/app/profile',
  review_report_resolved: '/app/profile',
  review_dispute_resolved: '/app/profile',
  wallet_deposit_approved: '/app/history',
  wallet_deposit_rejected: '/app/history',
  wallet_withdrawal_completed: '/app/history',
  wallet_withdrawal_rejected: '/app/history',
  wallet_deposit_confirmed: '/app/history',
  mhc_purchase_completed: '/app/credits',
  mhc_purchase_failed: '/app/credits',
  // Every advertisement event lands on the campaign it is about, including the
  // one caused by an empty balance. Sending that one straight to /app/credits
  // was tempting and wrong: the credits screen knows nothing about the campaign,
  // so a provider who topped up there had no way back and no way to retry. The
  // campaign panel carries all three things they need together — Add credits,
  // the campaign itself, and Retry renewal — so that is where the link goes.
  advertisement_activated: '/app/advertisements',
  advertisement_renewed: '/app/advertisements',
  advertisement_renewal_failed_credits: '/app/advertisements',
  advertisement_renewal_failed_pricing: '/app/advertisements',
  advertisement_renewal_required: '/app/advertisements',
  advertisement_renewal_reminder: '/app/advertisements',
  advertisement_auto_renew_stopped_max_weeks: '/app/advertisements',
  advertisement_auto_renew_stopped_end_date: '/app/advertisements',
  advertisement_auto_renew_enabled: '/app/advertisements',
  advertisement_auto_renew_disabled: '/app/advertisements',
  chat_message: '/app/chat',
  admin: '/app',
  demo: '/app',
};
