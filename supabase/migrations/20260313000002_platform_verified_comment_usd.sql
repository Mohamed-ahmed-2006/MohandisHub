-- Align platform_verified_at comment with implementation (wallet is USD).
COMMENT ON COLUMN users.platform_verified_at IS 'Set when user earns the platform verification badge (profile complete + 1000 USD deposit).';
