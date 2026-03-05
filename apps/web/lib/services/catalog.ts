import type { EngineeringService, ServicesCatalogResponse, UserRole } from '@mohandishub/shared';

import { fetchServicesCatalog } from '../api';
import { fallbackServicesCatalog } from './catalog-seed';

type CatalogLoader = () => Promise<ServicesCatalogResponse>;

export const filterCatalogByRole = (
  catalog: ServicesCatalogResponse,
  role: UserRole,
): ServicesCatalogResponse => {
  const categories = catalog.categories.filter((category) => category.roleVisibility.includes(role));
  const categoryIds = new Set(categories.map((category) => category.id));
  const services = catalog.services.filter(
    (service) => service.roleVisibility.includes(role) && categoryIds.has(service.categoryId),
  );

  return { categories, services };
};

export const getServicesForCategory = (
  catalog: ServicesCatalogResponse,
  categoryId: string,
): EngineeringService[] => {
  return catalog.services.filter((service) => service.categoryId === categoryId);
};

export const resolveCatalogWithFallback = async (
  remoteLoader: CatalogLoader,
): Promise<{ catalog: ServicesCatalogResponse; fallbackUsed: boolean }> => {
  try {
    const remote = await remoteLoader();
    const hasData = remote.categories.length > 0 && remote.services.length > 0;

    if (hasData) {
      return { catalog: remote, fallbackUsed: false };
    }
  } catch {
    // Fallback below.
  }

  return { catalog: fallbackServicesCatalog, fallbackUsed: true };
};

export const loadCatalogForRole = async (
  role: UserRole,
  accessToken?: string | null,
): Promise<{ catalog: ServicesCatalogResponse; fallbackUsed: boolean }> => {
  const resolved = await resolveCatalogWithFallback(() => fetchServicesCatalog(accessToken ?? undefined));
  return {
    catalog: filterCatalogByRole(resolved.catalog, role),
    fallbackUsed: resolved.fallbackUsed,
  };
};
