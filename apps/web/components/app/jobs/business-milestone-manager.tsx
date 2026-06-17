'use client';

import type { JobMilestone } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import type { JobsCopy } from './jobs-copy';
import { formatMilestoneStatus } from './jobs-copy';

import { useToast } from '@/components/app/toast';
import { jobsApiClient } from '@/lib/jobs/client';

type Props = {
  accessToken: string;
  applicationId: string;
  copy: JobsCopy;
};

export const BusinessMilestoneManager = ({ accessToken, applicationId, copy }: Props) => {
  const { addToast } = useToast();
  const [milestones, setMilestones] = useState<JobMilestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const loadMilestones = useCallback(async () => {
    try {
      const res = await jobsApiClient.getMilestones(accessToken, applicationId);
      setMilestones(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [accessToken, applicationId]);

  useEffect(() => {
    void loadMilestones();
  }, [loadMilestones]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreating(true);
    const form = e.currentTarget;
    try {
      await jobsApiClient.createMilestone(accessToken, applicationId, {
        title: (form.elements.namedItem('title') as HTMLInputElement).value,
        amount: parseFloat((form.elements.namedItem('amount') as HTMLInputElement).value),
      });
      form.reset();
      void loadMilestones();
    } catch (err: unknown) {
      addToast('Error', err instanceof Error ? err.message : copy.failedToCreateMilestone);
    } finally {
      setCreating(false);
    }
  };

  const handleReview = async (milestoneId: string, status: 'approved' | 'rejected') => {
    try {
      await jobsApiClient.reviewMilestone(accessToken, milestoneId, status);
      void loadMilestones();
      addToast('Success', status === 'approved' ? copy.milestoneApproved : copy.milestoneRejected);
    } catch (err: unknown) {
      addToast('Error', err instanceof Error ? err.message : copy.failedToReviewMilestone);
    }
  };

  if (loading) return <p style={{ fontSize: '0.9rem', color: '#666' }}>{copy.loadingMilestones}</p>;

  return (
    <div
      style={{
        marginTop: '1rem',
        padding: '1rem',
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: '4px',
      }}
    >
      <h5 style={{ marginBottom: '0.5rem' }}>{copy.projectMilestones}</h5>

      {milestones.length === 0 ? (
        <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
          {copy.noMilestones}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1rem' }}>
          {milestones.map((m) => (
            <li
              key={m.id}
              style={{
                marginBottom: '1rem',
                paddingBottom: '1rem',
                borderBottom: '1px solid #eee',
              }}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}
              >
                <strong>{m.title}</strong>
                <span>
                  {m.amount} EGP -{' '}
                  <span className={`badge badge--${m.status}`}>
                    {formatMilestoneStatus(m.status, copy)}
                  </span>
                </span>
              </div>
              <p className="dashboard-card-meta">
                {copy.businessGets}: {m.providerPayoutAmount} EGP | {copy.platformGets}:{' '}
                {m.commissionAmount} EGP
              </p>

              {m.status === 'submitted' && (
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button
                    className="dashboard-primary-btn dashboard-primary-btn--small"
                    onClick={() => {
                      void handleReview(m.id, 'approved');
                    }}
                  >
                    {copy.accept}
                  </button>
                  <button
                    className="dashboard-btn dashboard-btn--secondary dashboard-btn--small"
                    onClick={() => {
                      void handleReview(m.id, 'rejected');
                    }}
                  >
                    {copy.reject}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => void handleCreate(e)}
        style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}
      >
        <input
          name="title"
          className="dashboard-input"
          placeholder={copy.milestoneTitlePlaceholder}
          required
          style={{ flex: 2 }}
        />
        <input
          name="amount"
          type="number"
          className="dashboard-input"
          placeholder={copy.milestoneAmountPlaceholder}
          required
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          className="dashboard-primary-btn dashboard-primary-btn--small"
          disabled={creating}
          style={{ height: '42px' }}
        >
          {creating ? copy.adding : copy.add}
        </button>
      </form>
    </div>
  );
};
