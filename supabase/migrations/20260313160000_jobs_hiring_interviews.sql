-- MohandisHub - Hiring applications + interview reservations

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS job_interview_fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS application_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS interview_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS interview_instructions TEXT;

ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS submission_type VARCHAR(30) NOT NULL DEFAULT 'profile_snapshot',
  ADD COLUMN IF NOT EXISTS profile_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS cv_file_url TEXT,
  ADD COLUMN IF NOT EXISTS application_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS application_commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS business_payout_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS interview_invitation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS interview_reservation_id UUID;

ALTER TABLE job_applications DROP CONSTRAINT IF EXISTS job_applications_status_check;
ALTER TABLE job_applications
  ADD CONSTRAINT job_applications_status_check
  CHECK (
    status IN (
      'pending',
      'reviewed',
      'interview_invited',
      'interview_booked',
      'interview_completed',
      'accepted',
      'rejected'
    )
  );

ALTER TABLE job_applications DROP CONSTRAINT IF EXISTS job_applications_submission_type_check;
ALTER TABLE job_applications
  ADD CONSTRAINT job_applications_submission_type_check
  CHECK (submission_type IN ('profile_snapshot', 'cv_upload'));

ALTER TABLE reservation_slots
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(30) NOT NULL DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE CASCADE;

ALTER TABLE reservation_slots DROP CONSTRAINT IF EXISTS reservation_slots_purpose_check;
ALTER TABLE reservation_slots
  ADD CONSTRAINT reservation_slots_purpose_check
  CHECK (purpose IN ('service', 'job_interview'));

UPDATE reservation_slots SET purpose = 'service' WHERE purpose IS NULL;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(30) NOT NULL DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_application_id UUID REFERENCES job_applications(id) ON DELETE SET NULL;

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_purpose_check;
ALTER TABLE reservations
  ADD CONSTRAINT reservations_purpose_check
  CHECK (purpose IN ('service', 'job_interview'));

UPDATE reservations SET purpose = 'service' WHERE purpose IS NULL;

CREATE INDEX IF NOT EXISTS idx_reservation_slots_purpose_job
ON reservation_slots(purpose, job_id, provider_id, start_at);

CREATE INDEX IF NOT EXISTS idx_reservations_purpose_job
ON reservations(purpose, job_id, job_application_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_job_interview_reservation_per_application
ON reservations(job_application_id)
WHERE purpose = 'job_interview'
  AND job_application_id IS NOT NULL
  AND status IN ('pending', 'accepted', 'awaiting_start', 'in_session', 'waiting_customer_done');

ALTER TABLE job_applications
  ADD CONSTRAINT job_applications_interview_reservation_id_fkey
  FOREIGN KEY (interview_reservation_id)
  REFERENCES reservations(id)
  ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION sync_job_application_from_interview_reservation()
RETURNS trigger AS $$
BEGIN
  IF NEW.purpose <> 'job_interview' OR NEW.job_application_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('accepted', 'awaiting_start', 'in_session', 'waiting_customer_done') THEN
    UPDATE job_applications
    SET status = 'interview_booked',
        interview_reservation_id = NEW.id,
        updated_at = now()
    WHERE id = NEW.job_application_id
      AND status <> 'accepted';
  ELSIF NEW.status = 'completed' THEN
    UPDATE job_applications
    SET status = 'interview_completed',
        interview_reservation_id = NEW.id,
        updated_at = now()
    WHERE id = NEW.job_application_id
      AND status <> 'accepted';
  ELSIF NEW.status IN ('rejected', 'cancelled', 'expired') THEN
    UPDATE job_applications
    SET status = 'interview_invited',
        interview_reservation_id = NULL,
        updated_at = now()
    WHERE id = NEW.job_application_id
      AND status NOT IN ('accepted', 'rejected');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_job_application_from_interview_reservation ON reservations;
CREATE TRIGGER trg_sync_job_application_from_interview_reservation
AFTER INSERT OR UPDATE OF status ON reservations
FOR EACH ROW
EXECUTE FUNCTION sync_job_application_from_interview_reservation();
