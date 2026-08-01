import type { Dictionary } from '@/lib/i18n/types';

const advertisementStatusLabels = (dictionary: Dictionary): Record<string, string> => ({
  pending_review: dictionary.advertisements?.statusPendingReview ?? 'Awaiting review',
  pending_payment: dictionary.advertisements?.statusPendingPayment ?? 'Pending payment',
  scheduled: dictionary.advertisements?.statusScheduled ?? 'Approved',
  active: dictionary.advertisements?.statusActive ?? 'Active',
  expired: dictionary.advertisements?.statusExpired ?? 'Ended',
  rejected: dictionary.advertisements?.statusRejected ?? 'Rejected',
  paused_by_admin: dictionary.advertisements?.statusPausedByAdmin ?? 'Paused',
  cancelled: dictionary.advertisements?.statusCancelled ?? 'Cancelled',
});

export const formatAdminAdvertisementStatus = (dictionary: Dictionary, status: unknown): string => {
  if (typeof status === 'string') {
    return advertisementStatusLabels(dictionary)[status] ?? status.replace(/_/g, ' ');
  }
  if (typeof status === 'number' || typeof status === 'boolean' || typeof status === 'bigint') {
    return `${status}`;
  }
  return '';
};
