'use client';

import type {
  CreateNegotiationBody,
  NegotiationDetailResponse,
  RespondNegotiationBody,
  ServiceSearchResult,
} from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import { Drawer } from '@/components/ui/drawer';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { negotiationsApiClient } from '@/lib/negotiations/client';

type NegotiationCopy = Record<string, string | undefined>;

function ncopy(d: Dictionary): NegotiationCopy {
  return (d as { negotiation?: NegotiationCopy }).negotiation ?? {};
}

type Props = {
  open: boolean;
  onClose: () => void;
  service: ServiceSearchResult;
  accessToken: string;
  locale?: Locale;
  dictionary: Dictionary;
  onBookWithAgreedPrice: (negotiationId: string, agreedPrice: number) => void;
};

export function NegotiationModal({
  open,
  onClose,
  service,
  accessToken,
  locale = 'en',
  dictionary,
  onBookWithAgreedPrice,
}: Props) {
  const sp = ncopy(dictionary);
  const tr = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<NegotiationDetailResponse | null>(null);
  const [offerPrice, setOfferPrice] = useState('');
  const [offerMessage, setOfferMessage] = useState('');
  const [counterPrice, setCounterPrice] = useState('');
  const [counterMessage, setCounterMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await negotiationsApiClient.list(accessToken, {
        role: 'customer',
        serviceId: service.id,
        limit: 10,
      });
      const active = list.items.find((x) => x.status === 'pending' || x.status === 'accepted');
      if (active) {
        const d = await negotiationsApiClient.get(accessToken, active.id);
        setDetail(d);
      } else {
        setDetail(null);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : (sp.loadError ?? (locale === 'ar' ? 'فشل التحميل.' : 'Failed to load.')),
      );
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, service.id, sp.loadError, locale]);

  useEffect(() => {
    if (!open) return;
    void load();
    setOfferPrice(service.price != null ? String(service.price) : '');
    setOfferMessage('');
    setCounterPrice('');
    setCounterMessage('');
  }, [open, load, service.price]);

  const handleCreate = async () => {
    const p = parseFloat(offerPrice);
    if (!Number.isFinite(p) || p <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const body: CreateNegotiationBody = {
        serviceId: service.id,
        offeredPrice: p,
      };
      const msg = offerMessage.trim();
      if (msg) body.message = msg;
      const d = await negotiationsApiClient.create(accessToken, body);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('Failed to send offer.', 'فشل إرسال العرض.'));
    } finally {
      setBusy(false);
    }
  };

  const handleRespond = async (
    decision: 'accept' | 'reject' | 'counter',
    extra?: { counterPrice?: number; validForHours?: 24 | 48 | 168 },
  ) => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const msg = decision === 'counter' ? counterMessage.trim() : '';
      const body: RespondNegotiationBody = { decision };
      if (decision === 'counter' && extra?.counterPrice != null)
        body.counterPrice = extra.counterPrice;
      if (extra?.validForHours != null) body.validForHours = extra.validForHours;
      if (decision === 'counter' && msg) body.message = msg;
      const d = await negotiationsApiClient.respond(accessToken, detail.negotiation.id, body);
      setDetail(d);
      setCounterPrice('');
      setCounterMessage('');
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('Action failed.', 'فشلت العملية.'));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await negotiationsApiClient.cancel(accessToken, detail.negotiation.id);
      setDetail(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('Cancel failed.', 'فشل الإلغاء.'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const neg = detail?.negotiation;
  const rounds = detail?.rounds ?? [];
  const isCustomerTurn = neg?.status === 'pending' && neg.latestOfferedBy !== neg.customerId;
  const waitingOnProvider = neg?.status === 'pending' && neg.latestOfferedBy === neg.customerId;

  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      pending: sp.statusPending ?? 'Pending',
      accepted: sp.statusAccepted ?? 'Accepted',
      rejected: sp.statusRejected ?? 'Rejected',
      expired: sp.statusExpired ?? 'Expired',
      cancelled: sp.statusCancelled ?? 'Cancelled',
      consumed: sp.statusConsumed ?? 'Used',
    };
    return map[s] ?? s;
  };

  return (
    <Drawer open={open} onClose={onClose} className="negotiation-modal" zIndex={1150}>
      <div className="negotiation-modal-inner">
        <div className="negotiation-modal-header">
          <h2 className="negotiation-modal-title">
            {sp.title ?? tr('Price negotiation', 'تفاوض السعر')}
          </h2>
          <button
            type="button"
            className="negotiation-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="negotiation-modal-service">{service.title}</p>
        <p className="negotiation-modal-slot-warning">{sp.slotWarning}</p>

        {error && <p className="dashboard-error negotiation-modal-error">{error}</p>}

        {loading ? (
          <p>{dictionary.common?.loading ?? tr('Loading...', 'جاري التحميل...')}</p>
        ) : !detail ? (
          <div className="negotiation-create">
            <label className="negotiation-label">
              {sp.listedPrice ?? 'Listed price'}:{' '}
              {service.price != null ? `${service.price} ${service.currency ?? 'EGP'}` : '—'}
            </label>
            <label className="negotiation-label" htmlFor="neg-offer-price">
              {sp.yourOffer ?? 'Your offer'}
            </label>
            <input
              id="neg-offer-price"
              type="number"
              min={0}
              step="0.01"
              className="dashboard-input negotiation-input"
              value={offerPrice}
              onChange={(e) => setOfferPrice(e.target.value)}
            />
            <label className="negotiation-label" htmlFor="neg-offer-msg">
              {sp.optionalMessage}
            </label>
            <textarea
              id="neg-offer-msg"
              className="dashboard-textarea negotiation-textarea"
              rows={2}
              value={offerMessage}
              onChange={(e) => setOfferMessage(e.target.value)}
            />
            <button
              type="button"
              className="dashboard-btn dashboard-btn--primary negotiation-submit"
              disabled={busy}
              onClick={() => void handleCreate()}
            >
              {sp.submitOffer ?? tr('Send offer', 'إرسال العرض')}
            </button>
          </div>
        ) : (
          <div className="negotiation-active">
            <p className="negotiation-status">
              <strong>{statusLabel(neg!.status)}</strong>
            </p>
            {neg!.status === 'accepted' && neg!.agreedPrice != null && (
              <p className="negotiation-agreed">
                {tr('Agreed', 'متفق')}: {neg!.agreedPrice} {neg!.currency}
                {neg!.agreedValidUntil && (
                  <>
                    {' '}
                    · {sp.agreedUntil}:{' '}
                    {new Date(neg!.agreedValidUntil).toLocaleString(
                      locale === 'ar' ? 'ar-EG' : undefined,
                    )}
                  </>
                )}
              </p>
            )}

            <h3 className="negotiation-rounds-title">{sp.rounds}</h3>
            <ul className="negotiation-rounds-list">
              {rounds.map((r) => (
                <li key={r.id} className="negotiation-round-item">
                  <span className="negotiation-round-amount">
                    {r.amount} {neg!.currency}
                  </span>
                  <span className="negotiation-round-meta">
                    {r.offeredBy === neg!.customerId ? tr('You', 'أنت') : service.providerName}
                    {r.message ? ` — ${r.message}` : ''}
                  </span>
                  <span className="negotiation-round-time">
                    {new Date(r.createdAt).toLocaleString(locale === 'ar' ? 'ar-EG' : undefined)}
                  </span>
                </li>
              ))}
            </ul>

            {neg!.status === 'pending' && isCustomerTurn && (
              <div className="negotiation-actions">
                <div className="negotiation-action-row">
                  <button
                    type="button"
                    className="dashboard-btn dashboard-btn--primary"
                    disabled={busy}
                    onClick={() => void handleRespond('accept')}
                  >
                    {sp.accept ?? tr('Accept', 'قبول')}
                  </button>
                  <button
                    type="button"
                    className="dashboard-btn dashboard-btn--secondary"
                    disabled={busy}
                    onClick={() => void handleRespond('reject')}
                  >
                    {sp.reject ?? tr('Reject', 'رفض')}
                  </button>
                </div>
                <label className="negotiation-label" htmlFor="neg-counter">
                  {sp.counterPrice}
                </label>
                <input
                  id="neg-counter"
                  type="number"
                  min={0}
                  step="0.01"
                  className="dashboard-input negotiation-input"
                  value={counterPrice}
                  onChange={(e) => setCounterPrice(e.target.value)}
                />
                <textarea
                  className="dashboard-textarea negotiation-textarea"
                  rows={2}
                  placeholder={sp.optionalMessage}
                  value={counterMessage}
                  onChange={(e) => setCounterMessage(e.target.value)}
                />
                <button
                  type="button"
                  className="dashboard-btn dashboard-btn--secondary"
                  disabled={busy || !counterPrice}
                  onClick={() => {
                    const p = parseFloat(counterPrice);
                    if (!Number.isFinite(p) || p <= 0) return;
                    void handleRespond('counter', { counterPrice: p });
                  }}
                >
                  {sp.counter ?? tr('Counter-offer', 'عرض مضاد')}
                </button>
              </div>
            )}

            {neg!.status === 'pending' && waitingOnProvider && (
              <p className="negotiation-waiting">{sp.waitingProvider}</p>
            )}

            {neg!.status === 'accepted' && neg!.agreedPrice != null && (
              <button
                type="button"
                className="dashboard-btn dashboard-btn--primary negotiation-book"
                disabled={busy}
                onClick={() => {
                  onBookWithAgreedPrice(neg!.id, neg!.agreedPrice!);
                  onClose();
                }}
              >
                {sp.bookWithAgreed ?? tr('Book at agreed price', 'احجز بالسعر المتفق عليه')}
              </button>
            )}

            {(neg!.status === 'rejected' ||
              neg!.status === 'expired' ||
              neg!.status === 'cancelled') && (
              <button
                type="button"
                className="dashboard-btn dashboard-btn--secondary"
                disabled={busy}
                onClick={() => {
                  setDetail(null);
                  setOfferPrice(service.price != null ? String(service.price) : '');
                }}
              >
                {sp.startNew ?? tr('Start new negotiation', 'بدء تفاوض جديد')}
              </button>
            )}

            {neg!.status === 'pending' && (
              <button
                type="button"
                className="dashboard-btn dashboard-btn--secondary negotiation-cancel"
                disabled={busy}
                onClick={() => void handleCancel()}
              >
                {sp.cancelNegotiation ?? tr('Cancel negotiation', 'إلغاء التفاوض')}
              </button>
            )}

            <button
              type="button"
              className="dashboard-btn dashboard-btn--secondary"
              onClick={() => void load()}
            >
              {sp.refresh ?? tr('Refresh', 'تحديث')}
            </button>
          </div>
        )}
      </div>
    </Drawer>
  );
}
