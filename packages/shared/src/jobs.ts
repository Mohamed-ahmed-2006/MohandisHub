export type JobStatus = 'open' | 'closed';
export type JobApplicationStatus =
  | 'pending'
  | 'reviewed'
  | 'interview_invited'
  | 'interview_booked'
  | 'interview_completed'
  | 'accepted'
  | 'rejected';

export type JobApplicationSubmissionType = 'profile_snapshot' | 'cv_upload';

export interface Job {
  id: string;
  businessId: string;
  businessName?: string | undefined;
  title: string;
  description: string;
  requirements?: string | null | undefined;
  salaryRange?: string | null | undefined;
  applicationFeeAmount: number;
  interviewEnabled: boolean;
  interviewInstructions?: string | null | undefined;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
}

export interface JobApplication {
  id: string;
  jobId: string;
  expertId: string;
  expertName?: string | undefined;
  jobTitle?: string | undefined;
  businessName?: string | undefined;
  coverLetter?: string | null | undefined;
  submissionType: JobApplicationSubmissionType;
  profileSnapshot: unknown | null;
  cvFileUrl: string | null;
  applicationFeeAmount: number;
  applicationCommissionAmount: number;
  businessPayoutAmount: number;
  interviewInvitationSentAt: string | null;
  interviewReservationId: string | null;
  status: JobApplicationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateJobDto {
  title: string;
  description: string;
  requirements?: string | undefined;
  salaryRange?: string | undefined;
  applicationFeeAmount: number;
  interviewEnabled?: boolean;
  interviewInstructions?: string | undefined;
}

export interface ApplyJobDto {
  coverLetter?: string | undefined;
  submissionType: JobApplicationSubmissionType;
  cvFileUrl?: string | undefined;
}

export interface CreateJobInterviewSlotDto {
  startAt: string;
  endAt: string;
  supportsOnline?: boolean;
  supportsOffline?: boolean;
}

export interface UpdateJobInterviewSlotDto {
  startAt?: string;
  endAt?: string;
  status?: 'available' | 'booked' | 'blocked';
  supportsOnline?: boolean;
  supportsOffline?: boolean;
}

export interface BookJobInterviewDto {
  slotId: string;
  mode: 'online' | 'offline';
}

export type MilestoneStatus =
  | 'pending'
  | 'active'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'refunded';

export interface JobMilestone {
  id: string;
  jobApplicationId: string;
  title: string;
  amount: string;
  walletHoldId: string | null;
  commissionAmount: string;
  providerPayoutAmount: string;
  settledAt: string | null;
  status: MilestoneStatus;
  createdAt: string;
  updatedAt: string;
}

export interface JobSubmission {
  id: string;
  milestoneId: string;
  submissionNotes?: string | null;
  attachments?: unknown; // JSONB
  createdAt: string;
}

export interface CreateMilestoneDto {
  title: string;
  amount: number;
}

export interface SubmitMilestoneDto {
  submissionNotes?: string;
  attachments?: unknown;
}

export interface JobApplicationMessage {
  id: string;
  jobApplicationId: string;
  senderId: string;
  senderName?: string;
  content: string;
  createdAt: string;
}
