'use client';

import { useCallback, useEffect, useState } from 'react';
import type { JobMilestone } from '@mohandishub/shared';
import { jobsApiClient } from '@/lib/jobs/client';

type Props = {
  accessToken: string;
  applicationId: string;
};

export const BusinessMilestoneManager = ({ accessToken, applicationId }: Props) => {
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
    } catch (err: any) {
      alert(err.message || 'Failed to create milestone');
    } finally {
      setCreating(false);
    }
  };

  const handleReview = async (milestoneId: string, status: 'approved' | 'rejected') => {
    try {
      await jobsApiClient.reviewMilestone(accessToken, milestoneId, status);
      void loadMilestones();
    } catch (err: any) {
      alert(err.message || 'Failed to review milestone');
    }
  };

  if (loading) return <p style={{ fontSize: '0.9rem', color: '#666' }}>Loading milestones...</p>;

  return (
    <div style={{ marginTop: '1rem', padding: '1rem', background: '#fff', border: '1px solid #ddd', borderRadius: '4px' }}>
      <h5 style={{ marginBottom: '0.5rem' }}>Project Milestones</h5>
      
      {milestones.length === 0 ? (
        <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>No milestones created yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1rem' }}>
          {milestones.map(m => (
            <li key={m.id} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #eee' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <strong>{m.title}</strong>
                <span>{m.amount} EGP - <span className={`badge badge--${m.status}`}>{m.status}</span></span>
              </div>
              
              {m.status === 'submitted' && (
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button className="dashboard-primary-btn dashboard-primary-btn--small" onClick={() => handleReview(m.id, 'approved')}>Approve</button>
                  <button className="dashboard-btn dashboard-btn--secondary dashboard-btn--small" onClick={() => handleReview(m.id, 'rejected')}>Reject</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => void handleCreate(e)} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
        <input name="title" className="dashboard-input" placeholder="Milestone Title" required style={{ flex: 2 }} />
        <input name="amount" type="number" className="dashboard-input" placeholder="Amount (EGP)" required style={{ flex: 1 }} />
        <button type="submit" className="dashboard-primary-btn dashboard-primary-btn--small" disabled={creating} style={{ height: '42px' }}>
          {creating ? 'Adding...' : 'Add'}
        </button>
      </form>
    </div>
  );
};
