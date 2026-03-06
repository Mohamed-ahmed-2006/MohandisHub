// ---------------------------------------------------------------------------
// Plan types — shared between API and frontend
// ---------------------------------------------------------------------------

export type BillingCycle = 'monthly' | 'quarterly' | 'yearly' | 'one_time';

export type Plan = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  durationDays: number | null;
  trialDays: number;
  maxServices: number | null;
  maxProjects: number | null;
  features: string[];
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type CreatePlanBody = {
  slug: string;
  name: string;
  description?: string;
  price: number;
  currency?: string;
  billingCycle?: BillingCycle;
  durationDays?: number;
  trialDays?: number;
  maxServices?: number;
  maxProjects?: number;
  features?: string[];
  sortOrder?: number;
};

export type UpdatePlanBody = Partial<CreatePlanBody> & {
  isActive?: boolean;
};
