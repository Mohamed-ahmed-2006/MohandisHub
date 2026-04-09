export type UserRole = 'customer' | 'expert' | 'business' | 'craftsman' | 'admin';
export type RegisterableRole = Exclude<UserRole, 'admin'>;
export type ProviderRole = 'expert' | 'business' | 'craftsman';
export type IndividualProviderRole = 'expert' | 'craftsman';

/** Roles allowed to request wallet withdrawals (InstaPay or crypto). */
export type WithdrawalEligibleRole = 'expert' | 'craftsman' | 'business';

export type RoleMeta = {
  title: string;
  description: string;
};

export const PROVIDER_ROLES: readonly ProviderRole[] = ['expert', 'business', 'craftsman'];
export const INDIVIDUAL_PROVIDER_ROLES: readonly IndividualProviderRole[] = ['expert', 'craftsman'];

export const isProviderRole = (role: string): role is ProviderRole =>
  (PROVIDER_ROLES as readonly string[]).includes(role);

export const isIndividualProviderRole = (role: string): role is IndividualProviderRole =>
  (INDIVIDUAL_PROVIDER_ROLES as readonly string[]).includes(role);

export const isCustomerRole = (role: string): role is 'customer' => role === 'customer';

export const canManageNeeds = (role: string): role is 'customer' => isCustomerRole(role);

export const canBidOnNeeds = (role: string): role is ProviderRole => isProviderRole(role);

export const canAccessProviderAnalytics = (role: string): role is ProviderRole =>
  isProviderRole(role);

export const canManageReservationAvailability = (role: string): role is ProviderRole =>
  isProviderRole(role);

export const canRequestWithdrawal = (role: string): role is WithdrawalEligibleRole =>
  role === 'expert' || role === 'craftsman' || role === 'business';

export const ROLE_META: Record<UserRole, RoleMeta> = {
  customer: {
    title: 'Customer',
    description: 'Request engineering help, consultations, fixes, and site visits.',
  },
  expert: {
    title: 'Expert',
    description: 'Offer professional engineering services and paid consultations.',
  },
  business: {
    title: 'Business',
    description: 'Provide structured engineering services with a company profile.',
  },
  craftsman: {
    title: 'Craftsman',
    description: 'Offer hands-on trade services such as mechanics, plumbing, welding, and repairs.',
  },
  admin: {
    title: 'Admin',
    description: 'Platform administrator — reviews and approves verification requests.',
  },
};

export const ROLE_PERMISSION_MATRIX = {
  customer: {
    manageNeeds: true,
    bidOnNeeds: false,
    manageProviderServices: false,
    manageReservationAvailability: false,
    requestWithdrawal: false,
    accessAdminPanel: false,
  },
  expert: {
    manageNeeds: false,
    bidOnNeeds: true,
    manageProviderServices: true,
    manageReservationAvailability: true,
    requestWithdrawal: true,
    accessAdminPanel: false,
  },
  craftsman: {
    manageNeeds: false,
    bidOnNeeds: true,
    manageProviderServices: true,
    manageReservationAvailability: true,
    requestWithdrawal: true,
    accessAdminPanel: false,
  },
  business: {
    manageNeeds: false,
    bidOnNeeds: true,
    manageProviderServices: true,
    manageReservationAvailability: true,
    requestWithdrawal: true,
    accessAdminPanel: false,
  },
  admin: {
    manageNeeds: false,
    bidOnNeeds: false,
    manageProviderServices: false,
    manageReservationAvailability: false,
    requestWithdrawal: false,
    accessAdminPanel: true,
  },
} as const;
