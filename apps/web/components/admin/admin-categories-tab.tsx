'use client';

import type { ServiceCategory } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import { adminApiClient } from '@/lib/admin/client';
import type { Dictionary } from '@/lib/i18n/types';
import { CategoryIcon, CATEGORY_ICON_NAMES } from '@/components/ui/category-icon';

type Props = { dictionary: Dictionary; accessToken: string };

export const AdminCategoriesTab = ({ dictionary, accessToken }: Props) => {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ServiceCategory | null>(null);
  const [formData, setFormData] = useState({
    nameEn: '',
    nameAr: '',
    slug: '',
    icon: '',
    sortOrder: 0,
  });

  const d = dictionary.admin.categoriesMgmt;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApiClient.getCategories(accessToken);
      setCategories(data);
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
    setEditing(null);
    setFormData({ nameEn: '', nameAr: '', slug: '', icon: '', sortOrder: 0 });
    setShowForm(true);
  };

  const openEdit = (cat: ServiceCategory) => {
    setEditing(cat);
    setFormData({
      nameEn: cat.nameEn,
      nameAr: cat.nameAr,
      slug: cat.slug,
      icon: cat.icon ?? '',
      sortOrder: cat.sortOrder,
    });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    try {
      if (editing) {
        const updateBody: {
          nameEn: string;
          nameAr: string;
          slug: string;
          icon?: string;
          sortOrder: number;
        } = {
          nameEn: formData.nameEn,
          nameAr: formData.nameAr,
          slug: formData.slug,
          sortOrder: formData.sortOrder,
        };
        if (formData.icon) updateBody.icon = formData.icon;
        await adminApiClient.updateCategory(accessToken, editing.id, updateBody);
      } else {
        const createBody: {
          nameEn: string;
          nameAr: string;
          slug: string;
          icon?: string;
          sortOrder: number;
        } = {
          nameEn: formData.nameEn,
          nameAr: formData.nameAr,
          slug: formData.slug,
          sortOrder: formData.sortOrder,
        };
        if (formData.icon) createBody.icon = formData.icon;
        await adminApiClient.createCategory(accessToken, createBody);
      }
      setShowForm(false);
      void load();
    } catch {
      /* empty */
    }
  };

  const handleDelete = async (catId: string) => {
    if (!confirm(d.confirmDelete)) return;
    try {
      await adminApiClient.deleteCategory(accessToken, catId);
      void load();
    } catch {
      /* empty */
    }
  };

  return (
    <>
      <div className="admin-toolbar">
        <button type="button" className="admin-btn admin-btn--primary" onClick={openCreate}>
          {d.create}
        </button>
      </div>

      {loading ? (
        <p className="admin-empty">{dictionary.admin.loading}</p>
      ) : categories.length === 0 ? (
        <p className="admin-empty">{d.noCategories}</p>
      ) : (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{d.nameEn}</th>
                <th>{d.nameAr}</th>
                <th>{d.slug}</th>
                <th>{d.icon}</th>
                <th>{d.sortOrder}</th>
                <th>{d.active}</th>
                <th>{d.actions}</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat.id}>
                  <td>{cat.nameEn}</td>
                  <td>{cat.nameAr}</td>
                  <td>{cat.slug}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      <CategoryIcon name={cat.icon} size={18} />
                      {cat.icon ?? '—'}
                    </span>
                  </td>
                  <td>{cat.sortOrder}</td>
                  <td>
                    <span
                      className={`admin-badge ${cat.isActive ? 'admin-badge--active' : 'admin-badge--inactive'}`}
                    >
                      {cat.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div className="admin-actions-row">
                      <button
                        type="button"
                        className="admin-btn admin-btn--small"
                        onClick={() => openEdit(cat)}
                      >
                        {dictionary.admin.users.edit}
                      </button>
                      <button
                        type="button"
                        className="admin-btn admin-btn--small admin-btn--danger"
                        onClick={() => void handleDelete(cat.id)}
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
            <h2 className="admin-modal-title">{editing ? d.edit : d.create}</h2>
            <div className="admin-form-group">
              <label className="admin-form-label">{d.nameEn}</label>
              <input
                className="admin-form-input"
                value={formData.nameEn}
                onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })}
              />
            </div>
            <div className="admin-form-group">
              <label className="admin-form-label">{d.nameAr}</label>
              <input
                className="admin-form-input"
                dir="rtl"
                value={formData.nameAr}
                onChange={(e) => setFormData({ ...formData, nameAr: e.target.value })}
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
              <label className="admin-form-label">{d.icon}</label>
              <select
                className="admin-form-select"
                value={formData.icon || ''}
                onChange={(e) => setFormData({ ...formData, icon: e.target.value || '' })}
              >
                <option value="">— None —</option>
                {CATEGORY_ICON_NAMES.map((iconName) => (
                  <option key={iconName} value={iconName}>
                    {iconName}
                  </option>
                ))}
              </select>
              {formData.icon && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem' }}>
                  <CategoryIcon name={formData.icon} size={20} />
                  <span className="admin-form-label" style={{ marginBottom: 0 }}>{formData.icon}</span>
                </span>
              )}
            </div>
            <div className="admin-form-group">
              <label className="admin-form-label">{d.sortOrder}</label>
              <input
                className="admin-form-input"
                type="number"
                value={formData.sortOrder}
                onChange={(e) =>
                  setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })
                }
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
                {editing ? dictionary.common.save : dictionary.common.submit}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
