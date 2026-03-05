import type { UserRole } from './roles.js';

export type ServiceCategory = {
  id: string;
  slug: string;
  name: string;
  roleVisibility: UserRole[];
};

export type EngineeringService = {
  id: string;
  slug: string;
  name: string;
  categoryId: string;
  roleVisibility: UserRole[];
};

export type ServicesCatalogResponse = {
  categories: ServiceCategory[];
  services: EngineeringService[];
};
