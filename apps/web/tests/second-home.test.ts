import type { ServicesCatalogResponse } from '@mohandishub/shared';
import { describe, expect, it } from 'vitest';

import { getServiceActionByRole, getSuggestionRoleKey } from '../lib/second-home';
import {
  filterCatalogByRole,
  getServicesForCategory,
  resolveCatalogWithFallback,
} from '../lib/services/catalog';

const catalogFixture: ServicesCatalogResponse = {
  categories: [
    {
      id: 'cat-1',
      slug: 'cat-1',
      name: 'Category 1',
      roleVisibility: ['customer', 'expert', 'business', 'admin'],
    },
    {
      id: 'cat-2',
      slug: 'cat-2',
      name: 'Category 2',
      roleVisibility: ['business'],
    },
  ],
  services: [
    {
      id: 'svc-1',
      slug: 'svc-1',
      name: 'Service 1',
      categoryId: 'cat-1',
      roleVisibility: ['customer', 'business'],
    },
    {
      id: 'svc-2',
      slug: 'svc-2',
      name: 'Service 2',
      categoryId: 'cat-2',
      roleVisibility: ['business'],
    },
  ],
};

describe('second-home role mapping', () => {
  it('maps unknown role to unknown', () => {
    expect(getSuggestionRoleKey(null)).toBe('unknown');
  });

  it('maps role to action button intent', () => {
    expect(getServiceActionByRole('customer')).toBe('request');
    expect(getServiceActionByRole('expert')).toBe('offer');
    expect(getServiceActionByRole('business')).toBe('offer');
    expect(getServiceActionByRole('admin')).toBe('activity');
  });
});

describe('services catalog helpers', () => {
  it('filters categories and services by role', () => {
    const filtered = filterCatalogByRole(catalogFixture, 'customer');

    expect(filtered.categories).toHaveLength(1);
    expect(filtered.categories[0]?.id).toBe('cat-1');
    expect(filtered.services).toHaveLength(1);
    expect(filtered.services[0]?.id).toBe('svc-1');
  });

  it('filters services by selected category', () => {
    const services = getServicesForCategory(catalogFixture, 'cat-2');
    expect(services).toHaveLength(1);
    expect(services[0]?.id).toBe('svc-2');
  });

  it('uses fallback when remote loader fails', async () => {
    const result = await resolveCatalogWithFallback(async () => {
      throw new Error('network');
    });

    expect(result.fallbackUsed).toBe(true);
    expect(result.catalog.categories.length).toBeGreaterThan(0);
    expect(result.catalog.services.length).toBeGreaterThan(0);
  });
});
