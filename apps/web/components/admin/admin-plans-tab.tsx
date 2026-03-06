'use client';

import type { Plan } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import { adminApiClient } from '@/lib/admin/client';
import type { Dictionary } from '@/lib/i18n/types';

type Props = { dictionary: Dictionary; accessToken: string };

export const AdminPlansTab = ({ dictionary, accessToken }: Props) => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [formData, setFormData] = useState<{
    slug: string;
    name: string;
    price: number;
    description: string;
    billingCycle: Plan['billingCycle'];
    features: string;
  }>({ slug: '', name: '', price: 0, description: '', billingCycle: 'monthly', features: '' });

  const d = dictionary.admin.plansMgmt;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApiClient.getPlans(accessToken);
      setPlans(data);
    } catch {
      /* empty */
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditingPlan(null);
    setFormData({
      slug: '',
      name: '',
      price: 0,
      description: '',
      billingCycle: 'monthly',
      features: '',
    });
    setShowForm(true);
  };

  const openEdit = (plan: Plan) => {
    setEditingPlan(plan);
    setFormData({
      slug: plan.slug,
      name: plan.name,
      price: plan.price,
      description: plan.description ?? '',
      billingCycle: plan.billingCycle,
      features: plan.features.join(', '),
    });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    const featuresArr = formData.features
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);
    const baseBody = {
      slug: formData.slug,
      name: formData.name,
      price: formData.price,
      billingCycle: formData.billingCycle,
      features: featuresArr,
    };
    const bodyWithDesc = formData.description
      ? { ...baseBody, description: formData.description }
      : baseBody;
    try {
      if (editingPlan) {
        await adminApiClient.updatePlan(accessToken, editingPlan.id, bodyWithDesc);
      } else {
        await adminApiClient.createPlan(accessToken, bodyWithDesc);
      }
      setShowForm(false);
      void load();
    } catch {
      /* empty */
    }
  };

  const handleDelete = async (planId: string) => {
    if (!confirm(d.confirmDelete)) return;
    try {
      await adminApiClient.deletePlan(accessToken, planId);
      void load();
    } catch {
      /* empty */
    }
  };

  return (
    <>
      <div className="admin-toolbar">
        <button type="button" className="admin-btn admin-btn--primary" onClick={openCreate}>
          {d.createPlan}
        </button>
      </div>

      {loading ? (
        <p className="admin-empty">{dictionary.admin.loading}</p>
      ) : plans.length === 0 ? (
        <p className="admin-empty">{d.noPlans}</p>
      ) : (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{d.name}</th>
                <th>{d.slug}</th>
                <th>{d.price}</th>
                <th>{d.billingCycle}</th>
                <th>{d.active}</th>
                <th>{d.actions}</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id}>
                  <td>{plan.name}</td>
                  <td>{plan.slug}</td>
                  <td>
                    {plan.price} {plan.currency}
                  </td>
                  <td>{plan.billingCycle}</td>
                  <td>
                    <span
                      className={`admin-badge ${plan.isActive ? 'admin-badge--active' : 'admin-badge--inactive'}`}
                    >
                      {plan.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div className="admin-actions-row">
                      <button
                        type="button"
                        className="admin-btn admin-btn--small"
                        onClick={() => openEdit(plan)}
                      >
                        {dictionary.admin.users.edit}
                      </button>
                      <button
                        type="button"
                        className="admin-btn admin-btn--small admin-btn--danger"
                        onClick={() => void handleDelete(plan.id)}
                      >
                        {dictionary.admin.users.delete}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="admin-modal-overlay" onClick={() => setShowForm(false)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal-title">{editingPlan ? d.editPlan : d.createPlan}</h2>

            <div className="admin-form-group">
              <label className="admin-form-label">{d.name}</label>
              <input
                className="admin-form-input"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="admin-form-group">
              <label className="admin-form-label">{d.slug}</label>
              <input
                className="admin-form-input"
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
              />
            </div>
            <div className="admin-form-group">
              <label className="admin-form-label">{d.price}</label>
              <input
                className="admin-form-input"
                type="number"
                value={formData.price}
                onChange={(e) =>
                  setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })
                }
              />
            </div>
            <div className="admin-form-group">
              <label className="admin-form-label">{d.description}</label>
              <textarea
                className="admin-form-textarea"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div className="admin-form-group">
              <label className="admin-form-label">{d.billingCycle}</label>
              <select
                className="admin-form-select"
                value={formData.billingCycle}
                onChange={(e) =>
                  setFormData({ ...formData, billingCycle: e.target.value as Plan['billingCycle'] })
                }
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
                <option value="one_time">One-time</option>
              </select>
            </div>
            <div className="admin-form-group">
              <label className="admin-form-label">{d.features}</label>
              <input
                className="admin-form-input"
                value={formData.features}
                onChange={(e) => setFormData({ ...formData, features: e.target.value })}
                placeholder="Feature 1, Feature 2, ..."
              />
            </div>

            <div className="admin-modal-actions">
              <button type="button" className="admin-btn" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={() => void handleSubmit()}
              >
                {editingPlan ? dictionary.common.save : dictionary.common.submit}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
