import type { ServicesCatalogResponse, UserRole } from '@mohandishub/shared';
import { useMemo, useState } from 'react';

import { getServicesForCategory } from '@/lib/services/catalog';
import { getServiceActionByRole } from '@/lib/second-home';

type ServiceSelectorDictionary = {
  categoryLabel: string;
  serviceLabel: string;
  chooseCategory: string;
  chooseService: string;
  noServicesForCategory: string;
  requestService: string;
  offerService: string;
  viewActivity: string;
  catalogFallbackNotice: string;
};

type ServiceSelectorProps = {
  role: UserRole;
  catalog: ServicesCatalogResponse;
  fallbackUsed: boolean;
  dictionary: ServiceSelectorDictionary;
};

export const ServiceSelector = ({
  role,
  catalog,
  fallbackUsed,
  dictionary,
}: ServiceSelectorProps) => {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');

  const services = useMemo(() => {
    if (!selectedCategoryId) {
      return [];
    }
    return getServicesForCategory(catalog, selectedCategoryId);
  }, [catalog, selectedCategoryId]);

  const action = getServiceActionByRole(role);
  const actionLabel =
    action === 'request'
      ? dictionary.requestService
      : action === 'activity'
        ? dictionary.viewActivity
        : dictionary.offerService;

  return (
    <section className="app-home-card">
      <h2 className="app-home-section-title">{dictionary.serviceLabel}</h2>
      {fallbackUsed ? <p className="app-home-inline-note">{dictionary.catalogFallbackNotice}</p> : null}

      <div className="app-home-form-grid">
        <label className="app-home-field-group">
          <span>{dictionary.categoryLabel}</span>
          <select
            value={selectedCategoryId}
            onChange={(event) => {
              const nextCategoryId = event.target.value;
              setSelectedCategoryId(nextCategoryId);
              setSelectedServiceId('');
            }}
            className="app-home-select"
          >
            <option value="">{dictionary.chooseCategory}</option>
            {catalog.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label className="app-home-field-group">
          <span>{dictionary.serviceLabel}</span>
          <select
            value={selectedServiceId}
            onChange={(event) => setSelectedServiceId(event.target.value)}
            className="app-home-select"
            disabled={!selectedCategoryId || services.length === 0}
          >
            <option value="">{dictionary.chooseService}</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedCategoryId && services.length === 0 ? (
        <p className="app-home-inline-note">{dictionary.noServicesForCategory}</p>
      ) : null}

      <button type="button" className="app-home-primary-button" disabled={!selectedServiceId}>
        {actionLabel}
      </button>
    </section>
  );
};
