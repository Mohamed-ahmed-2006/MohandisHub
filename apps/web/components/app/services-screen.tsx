'use client';

import type { Service, ServiceCategory } from '@mohandishub/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { servicesApiClient } from '@/lib/services/client';

import '@/app/dashboard.css';

type Props = {
  locale: Locale;
  dictionary: Dictionary;
};

const getStatusLabel = (status: string, sp: Record<string, string>): string => {
  const keyMap: Record<string, string> = {
    draft: 'statusDraft',
    pending_review: 'statusPending',
    active: 'statusActive',
    paused: 'statusPaused',
    rejected: 'statusRejected',
    archived: 'Archived',
  };
  const key = keyMap[status];
  return (key && sp[key]) ?? status;
};

export const ServicesScreen = ({ locale, dictionary }: Props) => {
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();

  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sp = dictionary.servicesPage ?? ({} as Record<string, string>);

  useEffect(() => {
    if (!isReady) return;
    if (!isAuthenticated || !authUser) {
      router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
      return;
    }
    if (!authGuard.emailVerified) {
      router.replace(buildLocalePath(locale, '/verify-email'));
      return;
    }
    if (authUser.role !== 'expert' && authUser.role !== 'business') {
      router.replace(buildLocalePath(locale, '/app'));
      return;
    }
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cats = await servicesApiClient.getCategories();
      setCategories(cats);
      if (accessToken) {
        const data = await servicesApiClient.listMyServices(accessToken, 1, 50);
        setServices(data.items);
      } else {
        setServices([]);
      }
    } catch {
      setServices([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken) return;
    setCreating(true);
    setError(null);
    const form = e.currentTarget;
    const title = (form.elements.namedItem('title') as HTMLInputElement)?.value?.trim();
    if (!title || title.length < 3) {
      setError('Title must be at least 3 characters.');
      setCreating(false);
      return;
    }
    try {
      const categoryId = (form.elements.namedItem('categoryId') as HTMLSelectElement)?.value;
      const priceRaw = (form.elements.namedItem('price') as HTMLInputElement)?.value;
      const price = priceRaw ? parseFloat(priceRaw) : undefined;
      const priceType = (form.elements.namedItem('priceType') as HTMLSelectElement)
        ?.value as 'fixed' | 'hourly' | 'negotiable';
      const description = (form.elements.namedItem('description') as HTMLTextAreaElement)?.value?.trim();
      const city = (form.elements.namedItem('city') as HTMLInputElement)?.value?.trim();
      const country = (form.elements.namedItem('country') as HTMLInputElement)?.value?.trim();
      const submitForReview = (form.elements.namedItem('submitForReview') as HTMLInputElement)?.checked;

      const body: Parameters<typeof servicesApiClient.createService>[1] = {
        title,
        submitForReview: !!submitForReview,
      };
      if (description?.trim()) body.description = description.trim();
      if (categoryId) body.categoryId = categoryId;
      if (price != null && Number.isFinite(price)) body.price = price;
      if (priceType) body.priceType = priceType;
      if (city?.trim()) body.city = city.trim();
      if (country?.trim()) body.country = country.trim();
      await servicesApiClient.createService(accessToken, body);
      setShowCreate(false);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create service');
    } finally {
      setCreating(false);
    }
  };

  const handleAction = async (
    service: Service,
    action: 'submit' | 'pause' | 'activate',
  ) => {
    if (!accessToken) return;
    try {
      if (action === 'submit') {
        await servicesApiClient.submitService(accessToken, service.id);
      } else if (action === 'pause') {
        await servicesApiClient.pauseService(accessToken, service.id);
      } else {
        await servicesApiClient.activateService(accessToken, service.id);
      }
      void load();
    } catch {
      // ignore
    }
  };

  const categoryName = (cat: ServiceCategory) =>
    locale === 'ar' ? cat.nameAr : cat.nameEn;

  if (!isReady || !authUser) {
    return (
      <main className="profile-screen-main">
        <Container className="profile-screen-container">
          <p>{dictionary.appHome?.loading ?? 'Loading...'}</p>
        </Container>
      </main>
    );
  }

  return (
    <main className="profile-screen-main">
      <Container className="profile-screen-container">
        <div className="dashboard-section-header">
          <h1 className="dashboard-section-title">
            {sp.title ?? dictionary.nav?.myServices ?? 'My Services'}
          </h1>
          <button
            type="button"
            className="dashboard-primary-btn"
            onClick={() => setShowCreate(true)}
          >
            {sp.addService ?? 'Add Service'}
          </button>
        </div>

        {loading ? (
          <p>{dictionary.admin?.loading ?? 'Loading...'}</p>
        ) : services.length === 0 ? (
          <div className="dashboard-empty-state">
            <p className="dashboard-empty">{sp.noServices ?? sp.addFirstService}</p>
            <button
              type="button"
              className="dashboard-primary-btn"
              onClick={() => setShowCreate(true)}
            >
              {sp.addService ?? 'Add Service'}
            </button>
          </div>
        ) : (
          <div className="dashboard-cards">
            {services.map((s) => (
              <div key={s.id} className="dashboard-card">
                <h3 className="dashboard-card-title">{s.title}</h3>
                {s.description && (
                  <p className="dashboard-card-desc">
                    {s.description.slice(0, 120)}
                    {s.description.length > 120 ? '...' : ''}
                  </p>
                )}
                <p className="dashboard-card-meta">
                  {s.price != null
                    ? `${s.price} ${s.currency} ${s.priceType === 'hourly' ? '/hr' : ''}`
                    : s.priceType === 'negotiable'
                      ? 'Negotiable'
                      : '—'}
                  {s.city && ` · ${s.city}`}
                </p>
                <span
                  className={`dashboard-badge dashboard-badge--${s.status.replace('_', '-')}`}
                >
                  {getStatusLabel(s.status, sp as Record<string, string>)}
                </span>
                <div className="dashboard-card-actions" style={{ marginTop: '0.5rem' }}>
                  {s.status === 'draft' && (
                    <button
                      type="button"
                      className="dashboard-link-btn"
                      onClick={() => void handleAction(s, 'submit')}
                    >
                      {sp.submit ?? 'Submit'}
                    </button>
                  )}
                  {s.status === 'active' && (
                    <button
                      type="button"
                      className="dashboard-link-btn"
                      onClick={() => void handleAction(s, 'pause')}
                    >
                      {sp.pause ?? 'Pause'}
                    </button>
                  )}
                  {s.status === 'paused' && (
                    <button
                      type="button"
                      className="dashboard-link-btn"
                      onClick={() => void handleAction(s, 'activate')}
                    >
                      {sp.activate ?? 'Activate'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {showCreate && (
          <div className="plan-modal-overlay" onClick={() => setShowCreate(false)}>
            <div
              className="plan-modal"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 480 }}
            >
              <h3 className="plan-modal-title">
                {sp.createService ?? 'Create Service'}
              </h3>
              {error && <p className="dashboard-error">{error}</p>}
              <form className="dashboard-form" onSubmit={(e) => void handleCreate(e)}>
                <div className="dashboard-form-label-inline">
                  <label>{sp.titleLabel ?? 'Title'}</label>
                  <input
                    name="title"
                    type="text"
                    className="dashboard-input"
                    placeholder={sp.titlePlaceholder}
                    minLength={3}
                    maxLength={300}
                    required
                  />
                </div>
                <div className="dashboard-form-label-inline">
                  <label>{sp.descriptionLabel ?? 'Description'}</label>
                  <textarea
                    name="description"
                    className="dashboard-textarea"
                    placeholder={sp.descriptionPlaceholder}
                    rows={3}
                  />
                </div>
                <div className="dashboard-form-label-inline">
                  <label>{sp.categoryLabel ?? 'Category'}</label>
                  <select name="categoryId" className="dashboard-select">
                    <option value="">—</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {categoryName(c)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="dashboard-form-row">
                  <div className="dashboard-form-label-inline">
                    <label>{sp.priceLabel ?? 'Price'}</label>
                    <input
                      name="price"
                      type="number"
                      min="0"
                      step="0.01"
                      className="dashboard-input"
                      placeholder={sp.pricePlaceholder}
                    />
                  </div>
                  <div className="dashboard-form-label-inline">
                    <label>Type</label>
                    <select name="priceType" className="dashboard-select">
                      <option value="fixed">{sp.priceTypeFixed ?? 'Fixed'}</option>
                      <option value="hourly">{sp.priceTypeHourly ?? 'Hourly'}</option>
                      <option value="negotiable">{sp.priceTypeNegotiable ?? 'Negotiable'}</option>
                    </select>
                  </div>
                </div>
                <div className="dashboard-form-row">
                  <div className="dashboard-form-label-inline">
                    <label>{sp.cityLabel ?? 'City'}</label>
                    <input name="city" type="text" className="dashboard-input" />
                  </div>
                  <div className="dashboard-form-label-inline">
                    <label>{sp.countryLabel ?? 'Country'}</label>
                    <input
                      name="country"
                      type="text"
                      className="dashboard-input"
                      defaultValue="Egypt"
                    />
                  </div>
                </div>
                <div className="dashboard-form-label-inline">
                  <label>
                    <input name="submitForReview" type="checkbox" />
                    {sp.submitForReview ?? 'Submit for review immediately'}
                  </label>
                </div>
                <div className="dashboard-form-row">
                  <button
                    type="button"
                    className="plan-modal-cancel"
                    onClick={() => setShowCreate(false)}
                  >
                    {dictionary.common?.back ?? 'Back'}
                  </button>
                  <button
                    type="submit"
                    className="dashboard-primary-btn"
                    disabled={creating}
                  >
                    {creating ? '...' : (sp.saveDraft ?? 'Save')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </Container>
    </main>
  );
};
