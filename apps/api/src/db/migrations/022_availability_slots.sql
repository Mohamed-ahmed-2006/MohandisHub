-- ============================================================================
-- MohandisHub — v022: Availability slots for provider calendar
-- ============================================================================

CREATE TABLE IF NOT EXISTS availability_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'booked', 'blocked')),
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_slot_end_after_start CHECK (end_at > start_at)
);

CREATE TRIGGER set_availability_slots_updated_at
  BEFORE UPDATE ON availability_slots
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_availability_slots_provider ON availability_slots(provider_id);
CREATE INDEX IF NOT EXISTS idx_availability_slots_start ON availability_slots(start_at);
CREATE INDEX IF NOT EXISTS idx_availability_slots_status ON availability_slots(status);
