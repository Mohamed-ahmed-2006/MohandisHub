'use client';

import type { Service, ServiceCategory, UpdateServiceBody } from '@mohandishub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAppStatus } from '@/components/app-status-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { toAbsoluteAssetUrl } from '@/lib/asset-url';
import { EGYPTIAN_CITIES } from '@/lib/data/egyptian-cities';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { servicesApiClient } from '@/lib/services/client';
import { uploadFile } from '@/lib/upload/client';

import '@/app/dashboard.css';
import './services-screen.css';

type Props = {
  locale: Locale;
  dictionary: Dictionary;
};

const MAX_SERVICE_IMAGES = 10;

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
  const [createImages, setCreateImages] = useState<string[]>([]);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [editImages, setEditImages] = useState<string[]>([]);
  const [imageUploadBusy, setImageUploadBusy] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const sp = dictionary.servicesPage ?? ({} as Record<string, string>);
  const np = (dictionary as { negotiation?: Record<string, string> }).negotiation ?? {};
  const { status } = useAppStatus();
  const hourlyPricingEnabled = status?.featureHourlyPricingEnabled === true;

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
    if (
      authUser.role !== 'expert' &&
      authUser.role !== 'craftsman' &&
      authUser.role !== 'business'
    ) {
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

  const pickServiceImages = useCallback(
    async (fileList: FileList | null, current: string[], setUrls: (next: string[]) => void) => {
      if (!accessToken || !fileList?.length) return;
      const room = MAX_SERVICE_IMAGES - current.length;
      if (room <= 0) return;
      setImageUploadBusy(true);
      setError(null);
      try {
        const next = [...current];
        const take = Math.min(fileList.length, room);
        for (let i = 0; i < take; i++) {
          const file = fileList.item(i);
          if (!file) continue;
          const { url } = await uploadFile(accessToken, file);
          next.push(toAbsoluteAssetUrl(url));
        }
        setUrls(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setImageUploadBusy(false);
      }
    },
    [accessToken],
  );

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
      const priceType = hourlyPricingEnabled
        ? ((form.elements.namedItem('priceType') as HTMLSelectElement)?.value as 'fixed' | 'hourly')
        : 'fixed';
      const isNegotiable = (form.elements.namedItem('isNegotiable') as HTMLInputElement)?.checked;
      const description = (form.elements.namedItem('description') as HTMLTextAreaElement)?.value?.trim();
      const city = (form.elements.namedItem('city') as HTMLSelectElement)?.value?.trim();
      const country = (form.elements.namedItem('country') as HTMLInputElement)?.value?.trim();
      const body: Parameters<typeof servicesApiClient.createService>[1] = {
        title,
        submitForReview: true,
      };
      if (description?.trim()) body.description = description.trim();
      if (categoryId) body.categoryId = categoryId;
      if (price != null && Number.isFinite(price)) body.price = price;
      if (hourlyPricingEnabled && priceType) body.priceType = priceType;
      else body.priceType = 'fixed';
      body.isNegotiable = !!isNegotiable;
      if (city?.trim()) body.city = city.trim();
      if (country?.trim()) body.country = country.trim();
      if (createImages.length > 0) body.images = createImages.slice(0, MAX_SERVICE_IMAGES);
      await servicesApiClient.createService(accessToken, body);
      setShowCreate(false);
      setCreateImages([]);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create service');
    } finally {
      setCreating(false);
    }
  };

  const handleAction = async (service: Service, action: 'submit' | 'pause' | 'activate') => {
    if (!accessToken) return;
    setError(null);
    try {
      if (action === 'submit') {
        await servicesApiClient.submitService(accessToken, service.id);
      } else if (action === 'pause') {
        await servicesApiClient.pauseService(accessToken, service.id);
      } else {
        await servicesApiClient.activateService(accessToken, service.id);
      }
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const openEdit = (service: Service) => {
    setError(null);
    setEditingService(service);
    setEditImages([...(service.images ?? [])].slice(0, MAX_SERVICE_IMAGES));
  };

  const handleSaveEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken || !editingService) return;
    setSavingEdit(true);
    setError(null);
    const form = e.currentTarget;
    const title = (form.elements.namedItem('title') as HTMLInputElement)?.value?.trim();
    if (!title || title.length < 3) {
      setError('Title must be at least 3 characters.');
      setSavingEdit(false);
      return;
    }
    try {
      const description = (form.elements.namedItem('description') as HTMLTextAreaElement)?.value?.trim();
      const priceRaw = (form.elements.namedItem('price') as HTMLInputElement)?.value;
      const price = priceRaw?.trim() ? parseFloat(priceRaw.trim()) : undefined;
      const priceType = hourlyPricingEnabled
        ? ((form.elements.namedItem('priceType') as HTMLSelectElement)?.value as 'fixed' | 'hourly')
        : 'fixed';
      const isNegotiable = (form.elements.namedItem('isNegotiable') as HTMLInputElement)?.checked;
      const categoryId = (form.elements.namedItem('categoryId') as HTMLSelectElement)?.value;
      const city = (form.elements.namedItem('city') as HTMLSelectElement)?.value?.trim();
      const country = (form.elements.namedItem('country') as HTMLInputElement)?.value?.trim();
      const body: UpdateServiceBody = {
        title,
        isNegotiable: !!isNegotiable,
        images: editImages.slice(0, MAX_SERVICE_IMAGES),
      };
      if (description) body.description = description;
      if (typeof price === 'number' && Number.isFinite(price)) body.price = price;
      if (hourlyPricingEnabled) body.priceType = priceType;
      if (categoryId) body.categoryId = categoryId;
      if (city) body.city = city;
      if (country) body.country = country;
      await servicesApiClient.updateService(accessToken, editingService.id, body);
      setEditingService(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update service');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (service: Service) => {
    if (!accessToken) return;
    const ok = window.confirm(`Delete "${service.title}"?`);
    if (!ok) return;
    try {
      await servicesApiClient.deleteService(accessToken, service.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete service');
    }
  };

  const categoryName = (cat: ServiceCategory) => (locale === 'ar' ? cat.nameAr : cat.nameEn);

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
            onClick={() => {
              setCreateImages([]);
              setError(null);
              setShowCreate(true);
            }}
          >
            {sp.addService ?? 'Add Service'}
          </button>
        </div>

        <section
          className="services-negotiations-teaser dashboard-card"
          style={{ marginBottom: '1.25rem', padding: '1rem 1.15rem' }}
          aria-label={np.providerSectionTitle ?? 'Price negotiations'}
        >
          <p className="dashboard-card-meta" style={{ marginBottom: '0.75rem', maxWidth: '42rem' }}>
            {np.servicesPageTeaser ??
              'Customer price offers are managed in a dedicated inbox so your service list stays easy to scan.'}
          </p>
          <Link href={buildLocalePath(locale, '/app/negotiations')} className="dashboard-primary-btn">
            {np.openInbox ?? dictionary.nav?.negotiations ?? 'Open price negotiations'}
          </Link>
        </section>

        {loading ? (
          <p>{dictionary.admin?.loading ?? 'Loading...'}</p>
        ) : services.length === 0 ? (
          <div className="dashboard-empty-state">
            <p className="dashboard-empty">{sp.noServices ?? sp.addFirstService}</p>
            <button
              type="button"
              className="dashboard-primary-btn"
              onClick={() => {
                setCreateImages([]);
                setError(null);
                setShowCreate(true);
              }}
            >
              {sp.addService ?? 'Add Service'}
            </button>
          </div>
        ) : (
          <div className="dashboard-cards">
            {services.map((s) => (
              <div key={s.id} className="dashboard-card">
                {s.images?.length ? (
                  <div className="service-card-thumbs" aria-hidden>
                    {s.images.slice(0, 4).map((u) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={u}
                        src={toAbsoluteAssetUrl(u)}
                        alt=""
                        className="service-card-thumb"
                      />
                    ))}
                  </div>
                ) : null}
                <h3 className="dashboard-card-title">{s.title}</h3>
                {s.description && (
                  <p className="dashboard-card-desc">
                    {s.description.slice(0, 120)}
                    {s.description.length > 120 ? '...' : ''}
                  </p>
                )}
                <p className="dashboard-card-meta">
                  {s.price != null
                    ? `${s.price} ${s.currency}${hourlyPricingEnabled && s.priceType === 'hourly' ? '/hr' : ''}`
                    : s.isNegotiable
                      ? 'Negotiable'
                      : '-'}
                  {s.city && ` . ${s.city}`}
                </p>
                <span className={`dashboard-badge dashboard-badge--${s.status.replace('_', '-')}`}>
                  {getStatusLabel(s.status, sp as Record<string, string>)}
                </span>
                <div className="dashboard-card-actions" style={{ marginTop: '0.5rem' }}>
                  <button type="button" className="dashboard-link-btn" onClick={() => openEdit(s)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="dashboard-link-btn"
                    onClick={() => void handleDelete(s)}
                  >
                    Delete
                  </button>
                  {(s.status === 'draft' || s.status === 'rejected') && (
                    <button
                      type="button"
                      className="dashboard-link-btn"
                      onClick={() => void handleAction(s, 'submit')}
                    >
                      {s.status === 'rejected' ? (sp.resubmit ?? 'Resubmit') : (sp.submit ?? 'Submit')}
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
          <div
            className="plan-modal-overlay"
            onClick={() => {
              setShowCreate(false);
              setCreateImages([]);
            }}
          >
            <div className="plan-modal service-create-modal" onClick={(e) => e.stopPropagation()}>
              <h3 className="plan-modal-title">{sp.createService ?? 'Create Service'}</h3>
              {error && <p className="dashboard-error">{error}</p>}
              <form className="dashboard-form service-create-form" onSubmit={(e) => void handleCreate(e)}>
                <div className="service-create-grid">
                  <div className="service-create-field service-create-field--full">
                    <label className="service-create-label">{sp.titleLabel ?? 'Title'}</label>
                    <p className="service-create-hint">
                      {sp.titlePlaceholder ?? 'Use clear words customers can search for.'}
                    </p>
                    <input
                      name="title"
                      type="text"
                      className="dashboard-input service-create-input"
                      placeholder={sp.titlePlaceholder}
                      minLength={3}
                      maxLength={300}
                      required
                    />
                  </div>

                  <div className="service-create-field service-create-field--full">
                    <label className="service-create-label">{sp.descriptionLabel ?? 'Description'}</label>
                    <p className="service-create-hint">
                      {sp.descriptionPlaceholder ??
                        'Describe deliverables, workflow, and expected response time.'}
                    </p>
                    <textarea
                      name="description"
                      className="dashboard-textarea service-create-input"
                      placeholder={sp.descriptionPlaceholder}
                      rows={4}
                    />
                  </div>

                  <div className="service-create-field">
                    <label className="service-create-label">{sp.categoryLabel ?? 'Category'}</label>
                    <select name="categoryId" className="dashboard-select service-create-input">
                      <option value="">-</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {categoryName(c)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="service-create-field">
                    <label className="service-create-label">{sp.priceLabel ?? 'Price'}</label>
                    <input
                      name="price"
                      type="number"
                      min="0"
                      step="0.01"
                      className="dashboard-input service-create-input"
                      placeholder={sp.pricePlaceholder}
                    />
                  </div>

                  {hourlyPricingEnabled ? (
                    <div className="service-create-field">
                      <label className="service-create-label">Type</label>
                      <select name="priceType" className="dashboard-select service-create-input">
                        <option value="fixed">{sp.priceTypeFixed ?? 'Fixed'}</option>
                        <option value="hourly">{sp.priceTypeHourly ?? 'Hourly'}</option>
                      </select>
                    </div>
                  ) : null}

                  <label className="service-create-checkbox service-create-field service-create-field--full" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input name="isNegotiable" type="checkbox" />
                    <span>Price is negotiable</span>
                  </label>

                  <div className="service-create-field">
                    <label className="service-create-label">{sp.cityLabel ?? 'City'}</label>
                    <select name="city" className="home-search-select service-create-city-select">
                      <option value="">
                        {dictionary.homeSearch?.chooseCity ?? 'Choose city'}
                      </option>
                      {EGYPTIAN_CITIES.map((cityOption) => (
                        <option key={cityOption} value={cityOption}>
                          {cityOption}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="service-create-field">
                    <label className="service-create-label">{sp.countryLabel ?? 'Country'}</label>
                    <input
                      name="country"
                      type="text"
                      className="dashboard-input service-create-input"
                      defaultValue="Egypt"
                      disabled
                    />
                  </div>

                  <div className="service-create-field service-create-field--full">
                    <label className="service-create-label">
                      Gallery ({createImages.length}/{MAX_SERVICE_IMAGES})
                    </label>
                    <p className="service-create-hint">JPEG/PNG/WebP — up to {MAX_SERVICE_IMAGES} images.</p>
                    <div className="service-images-row">
                      {createImages.map((u, idx) => (
                        <div key={`${u}-${idx}`} className="service-image-tile">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt="" className="service-image-tile-img" />
                          <button
                            type="button"
                            className="service-image-remove"
                            aria-label="Remove"
                            onClick={() => setCreateImages((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="service-image-file-input"
                      disabled={imageUploadBusy || createImages.length >= MAX_SERVICE_IMAGES}
                      onChange={(ev) => {
                        void pickServiceImages(ev.target.files, createImages, setCreateImages);
                        ev.target.value = '';
                      }}
                    />
                  </div>

                </div>

                <div className="service-create-actions">
                  <button
                    type="button"
                    className="plan-modal-cancel"
                    onClick={() => {
                      setShowCreate(false);
                      setCreateImages([]);
                    }}
                  >
                    {dictionary.common?.back ?? 'Back'}
                  </button>
                  <button type="submit" className="dashboard-primary-btn" disabled={creating || imageUploadBusy}>
                    {imageUploadBusy ? 'Uploading…' : creating ? '...' : 'Publish'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {editingService && (
          <div className="plan-modal-overlay" onClick={() => setEditingService(null)}>
            <div className="plan-modal service-create-modal" onClick={(e) => e.stopPropagation()}>
              <h3 className="plan-modal-title">Edit service</h3>
              {error && <p className="dashboard-error">{error}</p>}
              <form
                key={editingService.id}
                className="dashboard-form service-create-form"
                onSubmit={(e) => void handleSaveEdit(e)}
              >
                <div className="service-create-grid">
                  <div className="service-create-field service-create-field--full">
                    <label className="service-create-label">{sp.titleLabel ?? 'Title'}</label>
                    <input
                      name="title"
                      type="text"
                      className="dashboard-input service-create-input"
                      defaultValue={editingService.title}
                      minLength={3}
                      maxLength={300}
                      required
                    />
                  </div>

                  <div className="service-create-field service-create-field--full">
                    <label className="service-create-label">{sp.descriptionLabel ?? 'Description'}</label>
                    <textarea
                      name="description"
                      className="dashboard-textarea service-create-input"
                      defaultValue={editingService.description ?? ''}
                      rows={4}
                    />
                  </div>

                  <div className="service-create-field">
                    <label className="service-create-label">{sp.categoryLabel ?? 'Category'}</label>
                    <select
                      name="categoryId"
                      className="dashboard-select service-create-input"
                      defaultValue={editingService.categoryId ?? ''}
                    >
                      <option value="">-</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {categoryName(c)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="service-create-field">
                    <label className="service-create-label">{sp.priceLabel ?? 'Price'}</label>
                    <input
                      name="price"
                      type="number"
                      min="0"
                      step="0.01"
                      className="dashboard-input service-create-input"
                      placeholder={sp.pricePlaceholder}
                      defaultValue={editingService.price != null ? String(editingService.price) : ''}
                    />
                  </div>

                  {hourlyPricingEnabled ? (
                    <div className="service-create-field">
                      <label className="service-create-label">Type</label>
                      <select
                        name="priceType"
                        className="dashboard-select service-create-input"
                        defaultValue={editingService.priceType}
                      >
                        <option value="fixed">{sp.priceTypeFixed ?? 'Fixed'}</option>
                        <option value="hourly">{sp.priceTypeHourly ?? 'Hourly'}</option>
                      </select>
                    </div>
                  ) : null}

                  <label
                    className="service-create-checkbox service-create-field service-create-field--full"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                  >
                    <input
                      name="isNegotiable"
                      type="checkbox"
                      defaultChecked={editingService.isNegotiable}
                    />
                    <span>Price is negotiable</span>
                  </label>

                  <div className="service-create-field">
                    <label className="service-create-label">{sp.cityLabel ?? 'City'}</label>
                    <select
                      name="city"
                      className="home-search-select service-create-city-select"
                      defaultValue={editingService.city ?? ''}
                    >
                      <option value="">
                        {dictionary.homeSearch?.chooseCity ?? 'Choose city'}
                      </option>
                      {EGYPTIAN_CITIES.map((cityOption) => (
                        <option key={cityOption} value={cityOption}>
                          {cityOption}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="service-create-field">
                    <label className="service-create-label">{sp.countryLabel ?? 'Country'}</label>
                    <input
                      name="country"
                      type="text"
                      className="dashboard-input service-create-input"
                      defaultValue={editingService.country ?? 'Egypt'}
                      disabled
                    />
                  </div>

                  <div className="service-create-field service-create-field--full">
                    <label className="service-create-label">
                      Gallery ({editImages.length}/{MAX_SERVICE_IMAGES})
                    </label>
                    <p className="service-create-hint">JPEG/PNG/WebP — up to {MAX_SERVICE_IMAGES} images.</p>
                    <div className="service-images-row">
                      {editImages.map((u, idx) => (
                        <div key={`${u}-${idx}`} className="service-image-tile">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt="" className="service-image-tile-img" />
                          <button
                            type="button"
                            className="service-image-remove"
                            aria-label="Remove"
                            onClick={() => setEditImages((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="service-image-file-input"
                      disabled={imageUploadBusy || editImages.length >= MAX_SERVICE_IMAGES}
                      onChange={(ev) => {
                        void pickServiceImages(ev.target.files, editImages, setEditImages);
                        ev.target.value = '';
                      }}
                    />
                  </div>
                </div>

                <div className="service-create-actions">
                  <button type="button" className="plan-modal-cancel" onClick={() => setEditingService(null)}>
                    {dictionary.common?.back ?? 'Back'}
                  </button>
                  <button type="submit" className="dashboard-primary-btn" disabled={savingEdit || imageUploadBusy}>
                    {imageUploadBusy ? 'Uploading…' : savingEdit ? '...' : 'Save'}
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
