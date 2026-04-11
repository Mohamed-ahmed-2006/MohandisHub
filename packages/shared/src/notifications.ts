// ---------------------------------------------------------------------------
// Notifications — shared types for API and frontend
// ---------------------------------------------------------------------------

/** System event types that trigger notifications; admin-sent uses 'admin'. */
export type NotificationType =
  | 'job_application'
  | 'job_interview_booked'
  | 'application_status'
  | 'milestone_submitted'
  | 'milestone_reviewed'
  | 'new_message'
  | 'price_negotiation'
  | 'admin';

export interface NotificationPayload {
  jobId?: string;
  applicationId?: string;
  reservationId?: string;
  negotiationId?: string;
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
