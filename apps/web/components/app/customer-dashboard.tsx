'use client';

import type { ServiceCategory } from '@mohandishub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Dictionary, Locale } from '@/lib/i18n/types';
import type { Bid, Need } from '@/lib/needs/client';
import { needsApiClient } from '@/lib/needs/client';

type Props = {
  locale: Locale;
  dictionary: Dictionary;
  accessToken: string;
  categories: ServiceCategory[];
};

export const CustomerDashboard = ({ locale, dictionary, accessToken, categories }: Props) => {
  const [myNeeds, setMyNeeds] = useState<Need[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNeed, setSelectedNeed] = useState<Need | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [loadingBids, setLoadingBids] = useState(false);

  const d = dictionary.needs ?? ({} as Record<string, string>);
  const categoryName = (cat: ServiceCategory) => (locale === 'ar' ? cat.nameAr : cat.nameEn);

  const loadNeeds = useCallback(async () => {
    setLoading(true);
    try {
      const data = await needsApiClient.listMyNeeds(accessToken);
      setMyNeeds(data.rows);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadNeeds();
  }, [loadNeeds]);

  useEffect(() => {
    const handler = () => {
      setShowForm(true);
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener('customer-dashboard-post-need', handler);
    return () => window.removeEventListener('customer-dashboard-post-need', handler);
  }, []);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const form = e.currentTarget;
    const title = (form.elements.namedItem('title') as HTMLInputElement).value.trim();
    const description = (
      form.elements.namedItem('description') as HTMLTextAreaElement
    ).value.trim();
    const budgetType = (form.elements.namedItem('budgetType') as HTMLSelectElement).value as
      | 'fixed'
      | 'hourly';
    const budgetAmountRaw = parseFloat(
      (form.elements.namedItem('budgetAmount') as HTMLInputElement).value,
    );
    const budgetAmount =
      Number.isFinite(budgetAmountRaw) && budgetAmountRaw >= 1 ? budgetAmountRaw : 0;
    const categoryIdVal = (form.elements.namedItem('categoryId') as HTMLSelectElement).value.trim();
    const timelineDaysRaw = parseInt(
      (form.elements.namedItem('timelineDays') as HTMLInputElement).value,
      10,
    );
    const timelineDays =
      Number.isInteger(timelineDaysRaw) && timelineDaysRaw >= 1 ? timelineDaysRaw : undefined;

    if (budgetAmount < 1) {
      setError(d.budgetPlaceholder ?? 'Please enter a valid budget amount (at least 1).');
      setSaving(false);
      return;
    }

    const data: Parameters<typeof needsApiClient.createNeed>[1] = {
      title,
      description,
      budgetType,
      budgetAmount,
      currency: 'EGP',
    };
    if (
      categoryIdVal &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(categoryIdVal)
    ) {
      data.categoryId = categoryIdVal;
    }
    if (timelineDays != null) data.timelineDays = timelineDays;

    try {
      await needsApiClient.createNeed(accessToken, data);
      setShowForm(false);
      void loadNeeds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const viewBids = async (need: Need) => {
    setSelectedNeed(need);
    setLoadingBids(true);
    try {
      const b = await needsApiClient.listBidsForNeed(accessToken, need.id);
      setBids(b);
    } catch {
      setBids([]);
    } finally {
      setLoadingBids(false);
    }
  };

  const handleAward = async (bidId: string) => {
    if (!selectedNeed) return;
    try {
      await needsApiClient.awardBid(accessToken, selectedNeed.id, bidId);
      setSelectedNeed(null);
      void loadNeeds();
    } catch {
      /* ignore */
    }
  };

  return (
    <section className="dashboard-section" ref={sectionRef}>
      <div className="dashboard-section-header">
        <h2 className="dashboard-section-title">{d.myNeeds ?? 'My Needs'}</h2>
        <button type="button" className="dashboard-primary-btn" onClick={() => setShowForm(true)}>
          {d.postNeed ?? 'Post a Need'}
        </button>
      </div>

      {showForm && (
        <div className="plan-modal-overlay" onClick={() => setShowForm(false)}>
          <div
            className="plan-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560 }}
          >
            <h3 className="plan-modal-title">{d.postNeed ?? 'Post a Need'}</h3>
            <form className="dashboard-form" onSubmit={(e) => void handleCreate(e)}>
              {error && <p className="dashboard-error">{error}</p>}
              <input
                name="title"
                className="dashboard-input"
                placeholder={d.titlePlaceholder ?? 'Title'}
                required
              />
              <textarea
                name="description"
                className="dashboard-textarea"
                placeholder={d.descPlaceholder ?? 'Describe what you need...'}
                required
              />
              <div className="dashboard-form-row">
                <select name="categoryId" className="dashboard-select">
                  <option value="">{d.anyCategory ?? 'Category (optional)'}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {categoryName(c)}
                    </option>
                  ))}
                </select>
                <select name="budgetType" className="dashboard-select" required>
                  <option value="fixed">{d.fixed ?? 'Fixed'}</option>
                  <option value="hourly">{d.hourly ?? 'Hourly'}</option>
                </select>
              </div>
              <div className="dashboard-form-row">
                <input
                  name="budgetAmount"
                  type="number"
                  min="1"
                  step="0.01"
                  className="dashboard-input"
                  placeholder={d.budgetPlaceholder ?? 'Budget amount'}
                  required
                />
                <input
                  name="timelineDays"
                  type="number"
                  min="1"
                  className="dashboard-input"
                  placeholder={d.timelinePlaceholder ?? 'Timeline (days)'}
                />
              </div>
              <div
                className="dashboard-form-row"
                style={{ justifyContent: 'flex-end', gap: '0.5rem' }}
              >
                <button
                  type="button"
                  className="plan-modal-cancel"
                  onClick={() => {
                    setShowForm(false);
                    setError(null);
                  }}
                >
                  {dictionary.common.back}
                </button>
                <button type="submit" className="dashboard-primary-btn" disabled={saving}>
                  {saving ? '...' : (d.submitNeed ?? 'Submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <p>{dictionary.admin?.loading ?? 'Loading...'}</p>
      ) : myNeeds.length === 0 ? (
        <p className="dashboard-empty">
          {d.noNeeds ?? 'No needs posted yet. Post your first need!'}
        </p>
      ) : (
        <div className="dashboard-cards">
          {myNeeds.map((need) => (
            <div key={need.id} className="dashboard-card">
              <h3 className="dashboard-card-title">{need.title}</h3>
              <p className="dashboard-card-meta">
                {need.budget_type === 'fixed' ? (d.fixed ?? 'Fixed') : (d.hourly ?? 'Hourly')}:{' '}
                {parseFloat(need.budget_amount).toFixed(2)} {need.currency}
              </p>
              <p className="dashboard-card-meta">
                {d.bidsCount ?? 'Bids'}: {need.bid_count ?? 0} — {need.status}
              </p>
              {need.status === 'open' && (
                <button
                  type="button"
                  className="dashboard-link-btn"
                  onClick={() => void viewBids(need)}
                >
                  {d.viewBids ?? 'View Bids'}
                </button>
              )}
              {need.status === 'awarded' && (
                <span className="dashboard-badge dashboard-badge--awarded">
                  {d.awarded ?? 'Awarded'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {selectedNeed && (
        <div className="plan-modal-overlay" onClick={() => setSelectedNeed(null)}>
          <div
            className="plan-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560 }}
          >
            <h3 className="plan-modal-title">
              {d.bidsFor ?? 'Bids for'}: {selectedNeed.title}
            </h3>
            {loadingBids ? (
              <p>Loading...</p>
            ) : bids.length === 0 ? (
              <p>{d.noBids ?? 'No bids yet.'}</p>
            ) : (
              <div className="dashboard-bids-list">
                {bids.map((bid) => (
                  <div key={bid.id} className="dashboard-bid-item">
                    <div>
                      <strong>{bid.expert_name}</strong>
                      <p className="dashboard-card-meta">{bid.message}</p>
                      <p className="dashboard-card-meta">
                        {parseFloat(bid.amount).toFixed(2)} {bid.currency}
                        {bid.delivery_days && ` — ${bid.delivery_days} days`}
                      </p>
                    </div>
                    {bid.status === 'pending' && (
                      <button
                        type="button"
                        className="dashboard-primary-btn"
                        onClick={() => void handleAward(bid.id)}
                      >
                        {d.award ?? 'Award'}
                      </button>
                    )}
                    {bid.status === 'accepted' && (
                      <span className="dashboard-badge dashboard-badge--awarded">Accepted</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="plan-modal-cancel"
              style={{ marginTop: '1rem' }}
              onClick={() => setSelectedNeed(null)}
            >
              {dictionary.common.back}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
