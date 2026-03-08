-- Optional link/screenshot URL for needs
ALTER TABLE needs ADD COLUMN IF NOT EXISTS reference_url VARCHAR(500);
