export type UserRole = 'customer' | 'expert' | 'business' | 'admin';

export type RoleMeta = {
  title: string;
  description: string;
};

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
  admin: {
    title: 'Admin',
    description: 'Platform administrator — reviews and approves verification requests.',
  },
};
