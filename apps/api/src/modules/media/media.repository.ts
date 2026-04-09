import { getPool } from '../../db/pool.js';

export type MediaItemRow = {
  id: string;
  title: string;
  alt_text: string | null;
  usage_type: string;
  image_url: string;
  active: boolean;
  sort_order: number;
  starts_at: Date | null;
  ends_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};

async function ensureTable() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS media_assets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      alt_text TEXT NULL,
      usage_type TEXT NOT NULL,
      image_url TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      starts_at TIMESTAMPTZ NULL,
      ends_at TIMESTAMPTZ NULL,
      created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_media_assets_usage_active_sort
      ON media_assets (usage_type, active, sort_order, created_at DESC);
  `);
}

export async function listMediaAssets(usageType?: string): Promise<MediaItemRow[]> {
  await ensureTable();
  const db = getPool();
  if (usageType) {
    const { rows } = await db.query<MediaItemRow>(
      `SELECT * FROM media_assets
       WHERE usage_type = $1
       ORDER BY sort_order ASC, created_at DESC`,
      [usageType],
    );
    return rows;
  }
  const { rows } = await db.query<MediaItemRow>(
    `SELECT * FROM media_assets
     ORDER BY usage_type ASC, sort_order ASC, created_at DESC`,
  );
  return rows;
}

export async function listActiveMediaAssets(usageType: string): Promise<MediaItemRow[]> {
  await ensureTable();
  const db = getPool();
  const { rows } = await db.query<MediaItemRow>(
    `SELECT * FROM media_assets
     WHERE usage_type = $1
       AND active = true
       AND (starts_at IS NULL OR starts_at <= now())
       AND (ends_at IS NULL OR ends_at >= now())
     ORDER BY sort_order ASC, created_at DESC`,
    [usageType],
  );
  return rows;
}

export async function createMediaAsset(input: {
  title: string;
  altText: string | null;
  usageType: string;
  imageUrl: string;
  active: boolean;
  sortOrder: number;
  startsAt: Date | null;
  endsAt: Date | null;
  createdBy: string | null;
}): Promise<MediaItemRow> {
  await ensureTable();
  const db = getPool();
  const { rows } = await db.query<MediaItemRow>(
    `INSERT INTO media_assets
      (title, alt_text, usage_type, image_url, active, sort_order, starts_at, ends_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      input.title,
      input.altText,
      input.usageType,
      input.imageUrl,
      input.active,
      input.sortOrder,
      input.startsAt,
      input.endsAt,
      input.createdBy,
    ],
  );
  return rows[0]!;
}

export async function updateMediaAsset(
  id: string,
  input: Partial<{
    title: string;
    altText: string | null;
    usageType: string;
    imageUrl: string;
    active: boolean;
    sortOrder: number;
    startsAt: Date | null;
    endsAt: Date | null;
  }>,
): Promise<MediaItemRow | null> {
  await ensureTable();
  const db = getPool();
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.title !== undefined) {
    fields.push(`title = $${idx++}`);
    values.push(input.title);
  }
  if (input.altText !== undefined) {
    fields.push(`alt_text = $${idx++}`);
    values.push(input.altText);
  }
  if (input.usageType !== undefined) {
    fields.push(`usage_type = $${idx++}`);
    values.push(input.usageType);
  }
  if (input.imageUrl !== undefined) {
    fields.push(`image_url = $${idx++}`);
    values.push(input.imageUrl);
  }
  if (input.active !== undefined) {
    fields.push(`active = $${idx++}`);
    values.push(input.active);
  }
  if (input.sortOrder !== undefined) {
    fields.push(`sort_order = $${idx++}`);
    values.push(input.sortOrder);
  }
  if (input.startsAt !== undefined) {
    fields.push(`starts_at = $${idx++}`);
    values.push(input.startsAt);
  }
  if (input.endsAt !== undefined) {
    fields.push(`ends_at = $${idx++}`);
    values.push(input.endsAt);
  }

  if (fields.length === 0) return null;

  fields.push(`updated_at = now()`);
  values.push(id);
  const { rows } = await db.query<MediaItemRow>(
    `UPDATE media_assets
     SET ${fields.join(', ')}
     WHERE id = $${idx}
     RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

export async function deleteMediaAsset(id: string): Promise<boolean> {
  await ensureTable();
  const db = getPool();
  const { rowCount } = await db.query('DELETE FROM media_assets WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}
