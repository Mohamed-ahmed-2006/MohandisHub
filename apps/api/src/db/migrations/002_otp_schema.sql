-- ============================================================================
-- MohandisHub OTP Schema — v002
-- 6-digit verification codes for email and phone
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Verification codes table — stores OTP codes with rate-limiting support
-- --------------------------------------------------------------------------
CREATE TABLE verification_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel         VARCHAR(10) NOT NULL
                    CHECK (channel IN ('email', 'phone')),
  destination     VARCHAR(255) NOT NULL,        -- email address or phone number
  code_hash       VARCHAR(255) NOT NULL,        -- SHA-256 of the 6-digit code
  attempts        SMALLINT NOT NULL DEFAULT 0,  -- how many wrong guesses so far
  max_attempts    SMALLINT NOT NULL DEFAULT 5,  -- lock after N wrong guesses
  verified_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_verification_codes_user_channel
  ON verification_codes (user_id, channel, created_at DESC);

CREATE INDEX idx_verification_codes_destination
  ON verification_codes (destination, created_at DESC);

-- --------------------------------------------------------------------------
-- 2. Rate-limit table — prevents OTP spam (per user + channel)
-- --------------------------------------------------------------------------
CREATE TABLE otp_rate_limits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel         VARCHAR(10) NOT NULL
                    CHECK (channel IN ('email', 'phone')),
  sent_count      SMALLINT NOT NULL DEFAULT 1,
  window_start    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel)
);
