/**
 * Run the expert_profiles.identity_verification_method migration.
 * Usage: from repo root, run: npm run migrate:expert-verification
 * Or from apps/api: npx tsx scripts/run-expert-verification-migration.ts
 * Requires DATABASE_URL in apps/api/.env
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from apps/api
config({ path: join(__dirname, '../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL. Set it in apps/api/.env');
  process.exit(1);
}

const sql = `
-- Add identity_verification_method to expert_profiles
ALTER TABLE expert_profiles
  ADD COLUMN IF NOT EXISTS identity_verification_method VARCHAR(20) NULL
    CHECK (identity_verification_method IS NULL OR identity_verification_method IN ('didit', 'manual'));

COMMENT ON COLUMN expert_profiles.identity_verification_method IS 'How identity was verified: didit = external KYC (Didit), manual = admin-reviewed identity_documents';
`;

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    await client.query(sql);
    console.log('Migration applied: expert_profiles.identity_verification_method column added.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
