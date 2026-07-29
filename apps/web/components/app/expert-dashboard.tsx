'use client';

import type { ServiceCategory } from '@mohandishub/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { AwardOfferCard } from './award-offer-card';
import { ExpertJobsTab } from './expert-jobs-tab';

import { useToast } from '@/components/app/toast';
import { useAppStatus } from '@/components/app-status-provider';
import { ImagePreviewModal } from '@/components/ui/image-preview-modal';
import { toAbsoluteAssetUrl } from '@/lib/asset-url';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import type { Bid, BidMessage, Need } from '@/lib/needs/client';
import { needsApiClient } from '@/lib/needs/client';
import { uploadFile } from '@/lib/upload/client';

type Props = {
  locale: Locale;
  dictionary: Dictionary;
  accessToken: string;
  categories: ServiceCategory[];
  providerRole?: 'expert' | 'craftsman';
};

export const ExpertDashboard = ({
  locale,
  dictionary,
  accessToken,
  categories: _categories,
  providerRole = 'expert',
}: Props) => {
  const { addToast } = useToast();
  const { status } = useAppStatus();
  const hourlyPricingEnabled = status?.featureHourlyPricingEnabled === true;
  const [openNeeds, setOpenNeeds] = useState<Need[]>([]);
  const [myBids, setMyBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);
  const [bidNeed, setBidNeed] = useState<Pick<Need, 'id' | 'title' | 'budget_type'> | null>(null);
  const [editingBid, setEditingBid] = useState<Bid | null>(null);
  const [bidError, setBidError] = useState<string | null>(null);
  const [bidding, setBidding] = useState(false);
  const [tab, setTab] = useState<'needs' | 'bids' | 'jobs'>('needs');
  const [bidAmountInput, setBidAmountInput] = useState<string>('');

  const [chatBid, setChatBid] = useState<Bid | null>(null);
  const [messages, setMessages] = useState<BidMessage[]>([]);
  const [msgContent, setMsgContent] = useState('');
  const [bidMsgAttachmentUrl, setBidMsgAttachmentUrl] = useState<string | null>(null);
  const [bidMsgUploading, setBidMsgUploading] = useState(false);
  const [bidImagePreview, setBidImagePreview] = useState<string | null>(null);

  const openChat = async (bid: Bid) => {
    setChatBid(bid);
    setBidMsgAttachmentUrl(null);
    setMessages([]);
    try {
      const msgs = await needsApiClient.listBidMessages(accessToken, bid.need_id, bid.id);
      setMessages(msgs);
    } catch {
      // ignore
    }
  };

  const sendMsg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatBid) return;
    const text = msgContent.trim();
    const attach = bidMsgAttachmentUrl?.trim() ?? '';
    if (!text && !attach) return;
    try {
      await needsApiClient.createBidMessage(accessToken, chatBid.need_id, chatBid.id, {
        content: text,
        ...(attach ? { attachmentUrl: attach } : {}),
      });
      setMsgContent('');
      setBidMsgAttachmentUrl(null);
      void openChat(chatBid);
    } catch {
      // ignore
    }
  };

  const handleDeleteBid = async (needId: string, bidId: string) => {
    if (!confirm('Are you sure you want to delete this bid?')) return;
    try {
      await needsApiClient.deleteBid(accessToken, needId, bidId);
      void loadData();
    } catch (err: unknown) {
      addToast('Error', err instanceof Error ? err.message : 'Failed to delete bid');
    }
  };

  const d = dictionary.needs ?? ({} as Record<string, string>);
  const tr = (en: string, ar: string) => (locale === 'ar' ? ar : en);

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
    if (!bidNeed && !editingBid) return;
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
      const bidData: {
        amount: number;
        message: string;
        deliveryDays?: number;
        estimatedHours?: number;
      } = {
        amount,
        message,
      };

      const ddRaw = form.elements.namedItem('deliveryDays') as HTMLInputElement | null;
      if (ddRaw) {
        const dd = parseInt(ddRaw.value, 10);
        if (Number.isInteger(dd) && dd > 0 && dd <= 365) bidData.deliveryDays = dd;
        if (!Number.isNaN(dd) && (dd < 1 || dd > 365)) {
          setBidError('Delivery days must be between 1 and 365.');
          setBidding(false);
          return;
        }
      }

      const ehRaw = form.elements.namedItem('estimatedHours') as HTMLInputElement | null;
      if (ehRaw) {
        const eh = parseInt(ehRaw.value, 10);
        if (Number.isInteger(eh) && eh > 0) bidData.estimatedHours = eh;
      }

      if (editingBid) {
        await needsApiClient.updateBid(accessToken, editingBid.need_id, editingBid.id, bidData);
        setEditingBid(null);
      } else if (bidNeed) {
        await needsApiClient.createBid(accessToken, bidNeed.id, bidData);
        setBidNeed(null);
      }
      void loadData();
    } catch (err) {
      setBidError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBidding(false);
    }
  };

  const suggestions = dictionary.appHome?.suggestions?.[providerRole];
  const suggestTitle = suggestions?.title ?? 'Suggested actions for providers';
  const suggestItems = (suggestions?.items ?? []) as string[];
  const suggestCta = suggestions?.ctaLabel ?? 'Manage Services';

  const pendingAwardBids = myBids.filter(
    (b) => b.status === 'awarded' || b.status === 'pending_activation',
  );

  return (
    <section className="dashboard-section">
      {pendingAwardBids.length > 0 && (
        <div className="dashboard-award-offers" style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {pendingAwardBids.map((bid) => (
            <AwardOfferCard
              key={bid.id}
              bidId={bid.id}
              {...(bid.need_title ? { needTitle: bid.need_title } : {})}
              onResolved={() => void loadData()}
            />
          ))}
        </div>
      )}
      {suggestItems.length > 0 && (
        <div className="dashboard-suggestions">
          <h3
            className="dashboard-section-title"
            style={{ fontSize: '1rem', marginBottom: '0.5rem' }}
          >
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
        <button
          type="button"
          className={`dashboard-tab ${tab === 'jobs' ? 'dashboard-tab--active' : ''}`}
          onClick={() => setTab('jobs')}
        >
          Jobs
        </button>
      </div>

      {loading ? (
        <p>{dictionary.admin?.loading ?? 'Loading...'}</p>
      ) : tab === 'needs' ? (
        openNeeds.length === 0 ? (
          <p className="dashboard-empty">{d.noOpenNeeds ?? 'No open needs at the moment.'}</p>
        ) : (
          <div className="dashboard-cards">
            {openNeeds.map((need) => {
              const existingBid = myBids.find((b) => b.need_id === need.id);
              return (
                <div key={need.id} className="dashboard-card">
                  <h3 className="dashboard-card-title">{need.title}</h3>
                  <p className="dashboard-card-desc">
                    {need.description.slice(0, 120)}
                    {need.description.length > 120 ? '...' : ''}
                  </p>
                  <p className="dashboard-card-meta">
                    {hourlyPricingEnabled
                      ? need.budget_type === 'fixed'
                        ? (d.fixed ?? 'Fixed')
                        : (d.hourly ?? 'Hourly')
                      : tr('Budget', 'الميزانية')}
                    : {parseFloat(need.budget_amount).toFixed(2)} {need.currency}
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
                  {existingBid ? (
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button
                        type="button"
                        className="dashboard-btn dashboard-btn--secondary"
                        onClick={() => {
                          setEditingBid(existingBid);
                          setBidNeed(need);
                          setBidAmountInput(existingBid.amount);
                          setBidError(null);
                        }}
                        disabled={existingBid.status !== 'pending'}
                      >
                        Edit Bid
                      </button>
                      <button
                        type="button"
                        className="dashboard-btn dashboard-btn--danger"
                        onClick={() => void handleDeleteBid(need.id, existingBid.id)}
                        disabled={existingBid.status !== 'pending'}
                      >
                        Delete Bid
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="dashboard-primary-btn"
                      style={{ marginTop: '0.5rem' }}
                      onClick={() => {
                        setBidNeed(need);
                        setEditingBid(null);
                        setBidError(null);
                        setBidAmountInput('');
                      }}
                    >
                      {d.placeBid ?? 'Place Bid'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : tab === 'bids' ? (
        myBids.length === 0 ? (
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
                <span className={`dashboard-badge dashboard-badge--${bid.status}`}>
                  {bid.status}
                </span>
                {bid.has_unread && (
                  <span
                    className="dashboard-badge"
                    style={{
                      background: 'hsl(var(--destructive))',
                      color: '#fff',
                      marginInlineStart: '0.5rem',
                    }}
                  >
                    New Message
                  </span>
                )}
                {bid.status === 'pending' && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--secondary dashboard-btn--small"
                      onClick={() => {
                        const relatedNeed = openNeeds.find((n) => n.id === bid.need_id);
                        setEditingBid(bid);
                        setBidNeed(
                          relatedNeed || {
                            id: bid.need_id,
                            title: bid.need_title || 'Need',
                            budget_type: bid.estimated_hours ? 'hourly' : 'fixed',
                          },
                        );
                        setBidAmountInput(bid.amount);
                        setBidError(null);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--danger dashboard-btn--small"
                      onClick={() => void handleDeleteBid(bid.need_id, bid.id)}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--secondary dashboard-btn--small"
                      onClick={() => void openChat(bid)}
                    >
                      Chat
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        <ExpertJobsTab accessToken={accessToken} dictionary={dictionary} />
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
                placeholder={d.bidAmountPlaceholder ?? 'Your total bid amount (EGP)'}
                value={bidAmountInput}
                onChange={(e) => setBidAmountInput(e.target.value)}
                required
              />
              <p
                className="dashboard-form-hint"
                style={{ marginTop: '-0.5rem', marginBottom: '0.5rem' }}
              >
                {bidAmountInput && !isNaN(Number(bidAmountInput)) ? (
                  <>
                    You will receive approximately{' '}
                    <strong>{(Number(bidAmountInput) * 0.9).toFixed(2)} EGP</strong> after the 10%
                    platform commission.
                  </>
                ) : (
                  <>
                    Note: A platform commission (typically ~10%) will be deducted from this total
                    upon payout.
                  </>
                )}
              </p>
              {bidNeed.budget_type === 'hourly' && (
                <input
                  name="estimatedHours"
                  type="number"
                  min="1"
                  max="168"
                  className="dashboard-input"
                  defaultValue={editingBid?.estimated_hours ?? ''}
                  placeholder={
                    hourlyPricingEnabled
                      ? 'Estimated hours per week'
                      : tr('Estimated hours', 'الساعات المقدرة')
                  }
                  required
                />
              )}
              <textarea
                name="message"
                className="dashboard-textarea"
                placeholder={d.bidMessagePlaceholder ?? 'Why are you the right fit?'}
                defaultValue={editingBid?.message ?? ''}
                minLength={5}
                required
              />
              {bidNeed.budget_type !== 'hourly' && (
                <input
                  name="deliveryDays"
                  type="number"
                  min="1"
                  max="365"
                  className="dashboard-input"
                  defaultValue={editingBid?.delivery_days ?? ''}
                  placeholder={d.bidDeliveryPlaceholder ?? 'Delivery days (optional)'}
                />
              )}
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
      {chatBid && (
        <div className="plan-modal-overlay" onClick={() => setChatBid(null)}>
          <div
            className="plan-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 480 }}
          >
            <h3 className="plan-modal-title">Pre-Award Chat: {chatBid.need_title}</h3>
            <div
              style={{
                maxHeight: '300px',
                overflowY: 'auto',
                marginBottom: '1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              {messages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    padding: '0.5rem',
                    background: 'hsl(var(--muted))',
                    color: 'hsl(var(--foreground))',
                    borderRadius: '4px',
                  }}
                >
                  <strong>{m.sender_name}</strong>: <span>{m.content}</span>
                  {m.attachment_url ? (
                    <button
                      type="button"
                      className="dashboard-need-chat-attach-thumb-wrap"
                      onClick={() => setBidImagePreview(toAbsoluteAssetUrl(m.attachment_url!))}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={toAbsoluteAssetUrl(m.attachment_url)}
                        alt=""
                        className="dashboard-need-chat-attach-thumb"
                      />
                    </button>
                  ) : null}
                </div>
              ))}
              {messages.length === 0 && <p className="dashboard-empty">No messages yet.</p>}
            </div>
            {bidMsgAttachmentUrl ? (
              <div className="dashboard-need-chat-pending" style={{ marginBottom: '0.5rem' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={bidMsgAttachmentUrl}
                  alt=""
                  className="dashboard-need-chat-attach-thumb"
                />
                <button
                  type="button"
                  className="dashboard-link-btn"
                  onClick={() => setBidMsgAttachmentUrl(null)}
                >
                  {tr('Remove image', 'إزالة الصورة')}
                </button>
              </div>
            ) : null}
            <label
              className="dashboard-need-chat-file"
              style={{ display: 'block', marginBottom: '0.5rem' }}
            >
              <span className="dashboard-need-chat-file-label">
                {tr('Attach image', 'إرفاق صورة')}
              </span>
              <input
                type="file"
                accept="image/*"
                disabled={bidMsgUploading || Boolean(bidMsgAttachmentUrl)}
                onChange={(ev) => {
                  const file = ev.target.files?.[0];
                  ev.target.value = '';
                  if (!file) return;
                  void (async () => {
                    setBidMsgUploading(true);
                    try {
                      const { url } = await uploadFile(accessToken, file);
                      setBidMsgAttachmentUrl(toAbsoluteAssetUrl(url));
                    } catch {
                      addToast('Error', tr('Upload failed', 'فشل الرفع'));
                    } finally {
                      setBidMsgUploading(false);
                    }
                  })();
                }}
              />
            </label>
            <form
              onSubmit={(e) => {
                void sendMsg(e);
              }}
              className="dashboard-need-chat-form"
            >
              <input
                className="dashboard-input"
                value={msgContent}
                onChange={(e) => setMsgContent(e.target.value)}
                placeholder={tr('Type a message…', 'اكتب رسالة…')}
              />
              <button
                type="submit"
                className="dashboard-primary-btn"
                disabled={bidMsgUploading || (!msgContent.trim() && !bidMsgAttachmentUrl)}
              >
                Send
              </button>
            </form>
            <button
              type="button"
              className="plan-modal-cancel"
              style={{ marginTop: '1rem' }}
              onClick={() => setChatBid(null)}
            >
              {dictionary.common.back}
            </button>
          </div>
        </div>
      )}
      {bidImagePreview && (
        <ImagePreviewModal
          imageUrl={bidImagePreview}
          onClose={() => setBidImagePreview(null)}
          accessToken={accessToken}
        />
      )}
    </section>
  );
};
