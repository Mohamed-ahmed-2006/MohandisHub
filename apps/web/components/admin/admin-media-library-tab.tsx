'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

import { adminApiClient, type AdminMediaAsset, type AdminMediaUsageType } from '@/lib/admin/client';
import type { Dictionary } from '@/lib/i18n/types';
import { uploadFile } from '@/lib/upload/client';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  refreshSession?: () => Promise<string | null>;
};

const usageOptions: AdminMediaUsageType[] = ['banner', 'announcement', 'hero', 'general'];

export function AdminMediaLibraryTab({ dictionary, accessToken, refreshSession }: Props) {
  const [assets, setAssets] = useState<AdminMediaAsset[]>([]);
  const [usageType, setUsageType] = useState<AdminMediaUsageType>('banner');
  const [title, setTitle] = useState('');
  const [altText, setAltText] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [active, setActive] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientOptions = refreshSession ? { refreshSession } : undefined;

  const load = async () => {
    const rows = await adminApiClient.listMediaAssets(accessToken, usageType, clientOptions);
    setAssets(rows);
  };

  useEffect(() => {
    void load();
  }, [usageType]);

  const onCreate = async () => {
    if (!file || !title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const uploaded = await uploadFile(accessToken, file);
      await adminApiClient.createMediaAsset(
        accessToken,
        {
          title: title.trim(),
          altText: altText.trim() || null,
          usageType,
          imageUrl: uploaded.url,
          active,
          sortOrder: Number.parseInt(sortOrder || '0', 10) || 0,
        },
        clientOptions,
      );
      setTitle('');
      setAltText('');
      setSortOrder('0');
      setActive(true);
      setFile(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create media asset');
    } finally {
      setSaving(false);
    }
  };

  const onToggle = async (asset: AdminMediaAsset) => {
    await adminApiClient.updateMediaAsset(
      accessToken,
      asset.id,
      { active: !asset.active },
      clientOptions,
    );
    await load();
  };

  const onDelete = async (asset: AdminMediaAsset) => {
    await adminApiClient.deleteMediaAsset(accessToken, asset.id, clientOptions);
    await load();
  };

  return (
    <section className="admin-tab-content content-stack">
      <h2 className="admin-tab-title">Media library</h2>
      <p className="admin-section-desc">
        Upload reusable images for banners, announcements, and hero sections across the app.
      </p>

      <div className="admin-settings-section">
        <div className="admin-toolbar">
          <select
            className="admin-toolbar-select"
            value={usageType}
            onChange={(e) => setUsageType(e.target.value as AdminMediaUsageType)}
          >
            {usageOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <input
            className="admin-toolbar-input"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="admin-toolbar-input"
            placeholder="Alt text"
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
          />
          <input
            className="admin-toolbar-input"
            type="number"
            min={0}
            placeholder="Sort"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
          <label className="admin-toolbar-checkbox">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active
          </label>
          <input
            className="admin-toolbar-input"
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            disabled={saving || !file || !title.trim()}
            onClick={() => void onCreate()}
          >
            {saving ? (dictionary.common?.loading ?? 'Loading...') : 'Upload asset'}
          </button>
        </div>
        {error ? <p className="admin-error-banner">{error}</p> : null}
      </div>

      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Preview</th>
              <th>Title</th>
              <th>Usage</th>
              <th>Status</th>
              <th>Order</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={asset.id}>
                <td>
                  <Image
                    src={asset.image_url}
                    alt={asset.alt_text ?? asset.title}
                    width={84}
                    height={50}
                    unoptimized
                    style={{ objectFit: 'cover', borderRadius: 8 }}
                  />
                </td>
                <td>{asset.title}</td>
                <td>{asset.usage_type}</td>
                <td>{asset.active ? 'Active' : 'Hidden'}</td>
                <td>{asset.sort_order}</td>
                <td>
                  <div className="admin-actions-row">
                    <button
                      type="button"
                      className="admin-btn admin-btn--small"
                      onClick={() => void onToggle(asset)}
                    >
                      {asset.active ? 'Hide' : 'Show'}
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--danger admin-btn--small"
                      onClick={() => void onDelete(asset)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {assets.length === 0 ? (
              <tr>
                <td colSpan={6} className="admin-empty">
                  No assets yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
