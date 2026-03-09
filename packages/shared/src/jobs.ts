export type JobStatus = 'open' | 'closed';
export type JobApplicationStatus = 'pending' | 'reviewed' | 'accepted' | 'rejected';

export interface Job {
  id: string;
  businessId: string;
  businessName?: string | undefined;
  title: string;
  description: string;
  requirements?: string | null | undefined;
  salaryRange?: string | null | undefined;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
}

export interface JobApplication {
  id: string;
  jobId: string;
  expertId: string;
  expertName?: string | undefined;
  coverLetter?: string | null | undefined;
  status: JobApplicationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateJobDto {
  title: string;
  description: string;
  requirements?: string | undefined;
  salaryRange?: string | undefined;
}

export interface ApplyJobDto {
  coverLetter?: string | undefined;
}

export type MilestoneStatus = 'pending' | 'active' | 'submitted' | 'approved' | 'rejected';

export interface JobMilestone {
  id: string;
  jobApplicationId: string;
  title: string;
  amount: string;
  status: MilestoneStatus;
  createdAt: string;
  updatedAt: string;
}

export interface JobSubmission {
  id: string;
  milestoneId: string;
  submissionNotes?: string | null;
  attachments?: any; // JSONB
  createdAt: string;
}

export interface CreateMilestoneDto {
  title: string;
  amount: number;
}

export interface SubmitMilestoneDto {
  submissionNotes?: string;
  attachments?: any;
}

export interface JobApplicationMessage {
  id: string;
  jobApplicationId: string;
  senderId: string;
  senderName?: string;
  content: string;
  createdAt: string;
}

