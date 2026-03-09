-- ============================================================================
-- MohandisHub - v032: Reservation V2 + Wallet Holds + Legacy booking migration
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1) App settings for reservation pricing
-- --------------------------------------------------------------------------
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS reservation_acceptance_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reservation_voice_minute_rate NUMERIC(10,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reservation_video_minute_rate NUMERIC(10,2) NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS reservation_min_prejoin_minutes INT NOT NULL DEFAULT 5;

-- --------------------------------------------------------------------------
-- 2) Transactions type extension for hold/release ledger entries
-- --------------------------------------------------------------------------
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (
    type IN (
      'deposit',
      'withdrawal',
      'payment',
      'refund',
      'adjustment',
      'bonus',
      'commission',
      'hold',
      'release'
    )
  );

-- --------------------------------------------------------------------------
-- 3) Wallet holds
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
  status VARCHAR(20) NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'released', 'captured', 'cancelled')),
  reference_type VARCHAR(40) NOT NULL DEFAULT 'reservation',
  reference_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wallet_holds_wallet ON wallet_holds(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_holds_user ON wallet_holds(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_holds_status ON wallet_holds(status);
CREATE INDEX IF NOT EXISTS idx_wallet_holds_ref ON wallet_holds(reference_type, reference_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'trigger_set_updated_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_wallet_holds_updated_at'
      AND tgrelid = 'wallet_holds'::regclass
  ) THEN
    CREATE TRIGGER set_wallet_holds_updated_at
      BEFORE UPDATE ON wallet_holds
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- 4) Reservation provider profile
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservation_profiles (
  provider_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auto_accept BOOLEAN NOT NULL DEFAULT false,
  online_voice_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  online_video_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  offline_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'trigger_set_updated_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_reservation_profiles_updated_at'
      AND tgrelid = 'reservation_profiles'::regclass
  ) THEN
    CREATE TRIGGER set_reservation_profiles_updated_at
      BEFORE UPDATE ON reservation_profiles
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- 5) Reservation slots and reservations
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservation_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'booked', 'blocked')),
  supports_online BOOLEAN NOT NULL DEFAULT true,
  supports_offline BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_reservation_slot_end_after_start CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS idx_reservation_slots_provider ON reservation_slots(provider_id);
CREATE INDEX IF NOT EXISTS idx_reservation_slots_start ON reservation_slots(start_at);
CREATE INDEX IF NOT EXISTS idx_reservation_slots_status ON reservation_slots(status);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'trigger_set_updated_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_reservation_slots_updated_at'
      AND tgrelid = 'reservation_slots'::regclass
  ) THEN
    CREATE TRIGGER set_reservation_slots_updated_at
      BEFORE UPDATE ON reservation_slots
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id),
  provider_id UUID NOT NULL REFERENCES users(id),
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  slot_id UUID REFERENCES reservation_slots(id) ON DELETE SET NULL,
  mode VARCHAR(20) NOT NULL CHECK (mode IN ('online', 'offline')),
  online_type VARCHAR(20) CHECK (online_type IN ('voice', 'video')),
  status VARCHAR(40) NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'accepted',
      'rejected',
      'awaiting_start',
      'in_session',
      'waiting_customer_done',
      'completed',
      'cancelled',
      'disputed',
      'expired'
    )),
  requested_start_at TIMESTAMPTZ NOT NULL,
  requested_end_at TIMESTAMPTZ NOT NULL,
  expert_price_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
  admin_acceptance_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  admin_minute_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  fixed_price_hold_id UUID REFERENCES wallet_holds(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  auto_rejected BOOLEAN NOT NULL DEFAULT false,
  suggested_slots JSONB NOT NULL DEFAULT '[]'::jsonb,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  legacy_booking_id UUID,
  final_location_text TEXT,
  final_location_lat NUMERIC(10,7),
  final_location_lng NUMERIC(10,7),
  accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_disconnect_at TIMESTAMPTZ,
  customer_done_due_at TIMESTAMPTZ,
  disconnect_auto_release_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_reservation_end_after_start CHECK (requested_end_at > requested_start_at),
  CONSTRAINT chk_online_type_for_online CHECK (
    (mode = 'online' AND online_type IS NOT NULL)
    OR (mode = 'offline' AND online_type IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_reservations_customer ON reservations(customer_id);
CREATE INDEX IF NOT EXISTS idx_reservations_provider ON reservations(provider_id);
CREATE INDEX IF NOT EXISTS idx_reservations_service ON reservations(service_id);
CREATE INDEX IF NOT EXISTS idx_reservations_slot ON reservations(slot_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_start ON reservations(requested_start_at);
CREATE INDEX IF NOT EXISTS idx_reservations_legacy_booking ON reservations(legacy_booking_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'trigger_set_updated_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_reservations_updated_at'
      AND tgrelid = 'reservations'::regclass
  ) THEN
    CREATE TRIGGER set_reservations_updated_at
      BEFORE UPDATE ON reservations
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- 6) Offline proposals/check-ins + online call/session + disputes
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservation_location_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  proposed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_text TEXT NOT NULL,
  lat NUMERIC(10,7),
  lng NUMERIC(10,7),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  responded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_res_loc_prop_reservation ON reservation_location_proposals(reservation_id);

CREATE TABLE IF NOT EXISTS reservation_checkin_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code VARCHAR(12) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reservation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_res_checkin_reservation ON reservation_checkin_codes(reservation_id);

CREATE TABLE IF NOT EXISTS reservation_call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL UNIQUE REFERENCES reservations(id) ON DELETE CASCADE,
  agora_channel VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'paused', 'ended')),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  billing_started_at TIMESTAMPTZ,
  billing_paused_at TIMESTAMPTZ,
  last_billed_at TIMESTAMPTZ,
  billed_minutes INTEGER NOT NULL DEFAULT 0,
  extension_status VARCHAR(20) NOT NULL DEFAULT 'none'
    CHECK (extension_status IN ('none', 'pending', 'approved', 'rejected')),
  extension_requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  extension_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_res_call_sessions_reservation ON reservation_call_sessions(reservation_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'trigger_set_updated_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_reservation_call_sessions_updated_at'
      AND tgrelid = 'reservation_call_sessions'::regclass
  ) THEN
    CREATE TRIGGER set_reservation_call_sessions_updated_at
      BEFORE UPDATE ON reservation_call_sessions
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS reservation_call_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_session_id UUID NOT NULL REFERENCES reservation_call_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agora_uid INTEGER NOT NULL,
  joined_at TIMESTAMPTZ,
  left_at TIMESTAMPTZ,
  is_connected BOOLEAN NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (call_session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_res_call_participants_session ON reservation_call_participants(call_session_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'trigger_set_updated_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_reservation_call_participants_updated_at'
      AND tgrelid = 'reservation_call_participants'::regclass
  ) THEN
    CREATE TRIGGER set_reservation_call_participants_updated_at
      BEFORE UPDATE ON reservation_call_participants
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS reservation_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  opened_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason VARCHAR(40) NOT NULL
    CHECK (reason IN ('customer_report', 'timeout_no_done', 'manual', 'system')),
  description TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'open'
    CHECK (status IN (
      'open',
      'resolved_customer',
      'resolved_provider',
      'resolved_partial',
      'dismissed'
    )),
  resolution_notes TEXT,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_res_disputes_reservation ON reservation_disputes(reservation_id);
CREATE INDEX IF NOT EXISTS idx_res_disputes_status ON reservation_disputes(status);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'trigger_set_updated_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_reservation_disputes_updated_at'
      AND tgrelid = 'reservation_disputes'::regclass
  ) THEN
    CREATE TRIGGER set_reservation_disputes_updated_at
      BEFORE UPDATE ON reservation_disputes
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- 7) Legacy bookings/slots migration into Reservation V2
-- --------------------------------------------------------------------------
INSERT INTO reservation_profiles (provider_id)
SELECT DISTINCT provider_id
FROM services
WHERE provider_id IS NOT NULL
ON CONFLICT (provider_id) DO NOTHING;

INSERT INTO reservation_profiles (provider_id)
SELECT DISTINCT provider_id
FROM bookings
WHERE provider_id IS NOT NULL
ON CONFLICT (provider_id) DO NOTHING;

INSERT INTO reservation_slots (
  provider_id,
  start_at,
  end_at,
  status,
  supports_online,
  supports_offline
)
SELECT
  a.provider_id,
  a.start_at,
  a.end_at,
  CASE a.status
    WHEN 'available' THEN 'available'
    WHEN 'blocked' THEN 'blocked'
    ELSE 'booked'
  END,
  true,
  true
FROM availability_slots a
ON CONFLICT DO NOTHING;

INSERT INTO reservations (
  customer_id,
  provider_id,
  service_id,
  mode,
  online_type,
  status,
  requested_start_at,
  requested_end_at,
  expert_price_amount,
  currency,
  admin_acceptance_fee,
  admin_minute_rate,
  accepted_at,
  started_at,
  completed_at,
  legacy_booking_id
)
SELECT
  b.customer_id,
  b.provider_id,
  b.service_id,
  'online',
  'voice',
  CASE b.status
    WHEN 'pending_payment' THEN 'pending'
    WHEN 'paid' THEN 'accepted'
    WHEN 'scheduled' THEN 'awaiting_start'
    WHEN 'in_progress' THEN 'in_session'
    WHEN 'completed' THEN 'completed'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'refunded' THEN 'cancelled'
    ELSE 'pending'
  END,
  COALESCE(b.slot_start_at, b.created_at),
  COALESCE(b.slot_end_at, b.created_at + interval '1 hour'),
  b.amount,
  b.currency,
  b.commission_amount,
  0,
  CASE WHEN b.status IN ('paid', 'scheduled', 'in_progress', 'completed') THEN b.updated_at ELSE NULL END,
  CASE WHEN b.status IN ('in_progress', 'completed') THEN b.updated_at ELSE NULL END,
  CASE WHEN b.status = 'completed' THEN b.updated_at ELSE NULL END,
  b.id
FROM bookings b
ON CONFLICT DO NOTHING;

UPDATE reservations r
SET slot_id = s.id
FROM reservation_slots s
WHERE r.slot_id IS NULL
  AND s.provider_id = r.provider_id
  AND s.start_at <= r.requested_start_at
  AND s.end_at >= r.requested_end_at;

ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_booking_id_fkey;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL;

UPDATE reviews rv
SET reservation_id = r.id
FROM reservations r
WHERE rv.booking_id IS NOT NULL
  AND r.legacy_booking_id = rv.booking_id
  AND rv.reservation_id IS NULL;

-- --------------------------------------------------------------------------
-- 8) Final cutover: drop old booking/availability schema
-- --------------------------------------------------------------------------
DROP TABLE IF EXISTS availability_slots;
DROP TABLE IF EXISTS bookings;
