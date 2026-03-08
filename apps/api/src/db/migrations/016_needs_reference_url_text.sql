-- Allow storing JSON array of URLs (up to 5)
ALTER TABLE needs ALTER COLUMN reference_url TYPE TEXT;
