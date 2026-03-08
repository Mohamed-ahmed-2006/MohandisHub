'use client';

import type { ServiceCategory } from '@mohandishub/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import type { Bid, Need } from '@/lib/needs/client';
import { needsApiClient } from '@/lib/needs/client';

type Props = {
  locale: Locale;
  dictionary: Dictionary;
  accessToken: string;
  categories: ServiceCategory[];
};

export const ExpertDashboard = ({
  locale,
  dictionary,
  accessToken,
  categories: _categories,
}: Props) => {
  const [openNeeds, setOpenNeeds] = useState<Need[]>([]);
  const [myBids, setMyBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);
  const [bidNeed, setBidNeed] = useState<Need | null>(null);
  const [bidError, setBidError] = useState<string | null>(null);
  const [bidding, setBidding] = useState(false);
  const [tab, setTab] = useState<'needs' | 'bids'>('needs');

  const d = dictionary.needs ?? ({} as Record<string, string>);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [needsData, bidsData] = await Promise.all([
        needsApiClient.listOpenNeeds(accessToken),
        needsApiClient.listMyBids(accessToken),
      ]);
      setOpenNeeds(needsData.rows);
      setMyBids(bidsData.rows);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleBid = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!bidNeed) return;
    setBidding(true);
    setBidError(null);
    const form = e.currentTarget;
    try {
      const amountRaw = (form.elements.namedItem('amount') as HTMLInputElement).value;
      const amount = Number.parseFloat(amountRaw);
      const message = (form.elements.namedItem('message') as HTMLTextAreaElement).value.trim();
      if (!Number.isFinite(amount) || amount < 1) {
        setBidError('Please enter a valid bid amount (at least 1).');
        setBidding(false);
        return;
      }
      if (message.length < 5) {
        setBidError('Please enter at least 5 characters in your proposal.');
        setBidding(false);
        return;
      }
      const bidData: { amount: number; message: string; deliveryDays?: number } = {
        amount,
        message,
      };
      const dd = parseInt((form.elements.namedItem('deliveryDays') as HTMLInputElement).value, 10);
      if (Number.isInteger(dd) && dd > 0 && dd <= 365) bidData.deliveryDays = dd;
      if (!Number.isNaN(dd) && (dd < 1 || dd > 365)) {
        setBidError('Delivery days must be between 1 and 365.');
        setBidding(false);
        return;
      }
      await needsApiClient.createBid(accessToken, bidNeed.id, bidData);
      setBidNeed(null);
      void loadData();
    } catch (err) {
      setBidError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBidding(false);
    }
  };

  const suggestions = dictionary.appHome?.suggestions?.expert;
  const suggestTitle = suggestions?.title ?? 'Suggested actions for experts';
  const suggestItems = suggestions?.items ?? [];
  const suggestCta = suggestions?.ctaLabel ?? 'Manage Services';

  return (
    <section className="dashboard-section">
      {suggestItems.length > 0 && (
        <div className="dashboard-suggestions">
          <h3 className="dashboard-section-title" style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>
            {suggestTitle}
          </h3>
          <ul className="dashboard-suggestions-list">
            {suggestItems.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
          <Link
            href={buildLocalePath(locale, '/app/services')}
            className="dashboard-link-btn"
            style={{ marginTop: '0.5rem', display: 'inline-block' }}
          >
            {suggestCta}
          </Link>
        </div>
      )}
      <div className="dashboard-tabs">
        <button
          type="button"
          className={`dashboard-tab ${tab === 'needs' ? 'dashboard-tab--active' : ''}`}
          onClick={() => setTab('needs')}
        >
          {d.availableNeeds ?? 'Available Needs'}
        </button>
        <button
          type="button"
          className={`dashboard-tab ${tab === 'bids' ? 'dashboard-tab--active' : ''}`}
          onClick={() => setTab('bids')}
        >
          {d.myBids ?? 'My Bids'}
        </button>
      </div>

      {loading ? (
        <p>{dictionary.admin?.loading ?? 'Loading...'}</p>
      ) : tab === 'needs' ? (
        openNeeds.length === 0 ? (
          <p className="dashboard-empty">{d.noOpenNeeds ?? 'No open needs at the moment.'}</p>
        ) : (
          <div className="dashboard-cards">
            {openNeeds.map((need) => (
              <div key={need.id} className="dashboard-card">
                <h3 className="dashboard-card-title">{need.title}</h3>
                <p className="dashboard-card-desc">
                  {need.description.slice(0, 120)}
                  {need.description.length > 120 ? '...' : ''}
                </p>
                <p className="dashboard-card-meta">
                  {need.budget_type === 'fixed' ? (d.fixed ?? 'Fixed') : (d.hourly ?? 'Hourly')}:{' '}
                  {parseFloat(need.budget_amount).toFixed(2)} {need.currency}
                  {need.timeline_days && ` — ${need.timeline_days} days`}
                </p>
                {need.category_name_en && (
                  <p className="dashboard-card-meta">
                    {locale === 'ar' ? need.category_name_ar : need.category_name_en}
                  </p>
                )}
                <p className="dashboard-card-meta">
                  {d.postedBy ?? 'By'}: {need.customer_name}
                </p>
                <button
                  type="button"
                  className="dashboard-primary-btn"
                  onClick={() => {
                    setBidNeed(need);
                    setBidError(null);
                  }}
                >
                  {d.placeBid ?? 'Place Bid'}
                </button>
              </div>
            ))}
          </div>
        )
      ) : myBids.length === 0 ? (
        <p className="dashboard-empty">{d.noBids ?? "You haven't placed any bids yet."}</p>
      ) : (
        <div className="dashboard-cards">
          {myBids.map((bid) => (
            <div key={bid.id} className="dashboard-card">
              <h3 className="dashboard-card-title">{bid.need_title}</h3>
              <p className="dashboard-card-meta">
                {parseFloat(bid.amount).toFixed(2)} {bid.currency}
                {bid.delivery_days && ` — ${bid.delivery_days} days`}
              </p>
              <span className={`dashboard-badge dashboard-badge--${bid.status}`}>{bid.status}</span>
            </div>
          ))}
        </div>
      )}

      {bidNeed && (
        <div className="plan-modal-overlay" onClick={() => setBidNeed(null)}>
          <div
            className="plan-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 480 }}
          >
            <h3 className="plan-modal-title">
              {d.placeBid ?? 'Place Bid'}: {bidNeed.title}
            </h3>
            {bidError && <p className="dashboard-error">{bidError}</p>}
            <form className="dashboard-form" onSubmit={(e) => void handleBid(e)}>
              <input
                name="amount"
                type="number"
                min="1"
                step="0.01"
                className="dashboard-input"
                placeholder={d.bidAmountPlaceholder ?? 'Your bid amount'}
                required
              />
              <textarea
                name="message"
                className="dashboard-textarea"
                placeholder={d.bidMessagePlaceholder ?? 'Why are you the right fit?'}
                minLength={5}
                required
              />
              <input
                name="deliveryDays"
                type="number"
                min="1"
                max="365"
                className="dashboard-input"
                placeholder={d.bidDeliveryPlaceholder ?? 'Delivery days (optional)'}
              />
              <div className="dashboard-form-row">
                <button
                  type="button"
                  className="plan-modal-cancel"
                  onClick={() => setBidNeed(null)}
                >
                  {dictionary.common.back}
                </button>
                <button type="submit" className="dashboard-primary-btn" disabled={bidding}>
                  {bidding ? '...' : (d.submitBid ?? 'Submit Bid')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};
