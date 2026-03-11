-- Platform verification badge: earned when profile is complete and user has deposited >= 1000 EGP.
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN users.platform_verified_at IS 'Set when user earns the platform verification badge (profile complete + 1000 EGP deposit).';
