-- ============================================================================
-- Wave 2I — Unified Help & Resolution Centre
-- ----------------------------------------------------------------------------
-- Two case engines already exist and both hold real user data:
--
--   * support_tickets / support_ticket_messages  — platform support
--   * reservation_disputes / _notes / _evidence  — marketplace escrow disputes
--
-- Neither is rewritten here. Rewriting them would put every historical ticket
-- and every open money dispute through a data migration to gain a column
-- layout, and the reservation engine's resolution path moves money inside a
-- transaction that this wave must not touch.
--
-- Instead this adds a CASE SPINE: one row per case in `resolution_cases`,
-- carrying the fields the unified centre needs (kind, unified status,
-- reference code, counterparty, last activity). Legacy-backed cases link to
-- their engine row and are kept in step by triggers, so the legacy write paths
-- stay authoritative and a ticket updated through the old admin screen still
-- appears correctly in the unified list. Case kinds that have no engine today
-- — need/job disputes, direct-payment issues, safety reports — live natively in
-- the spine with their own messages, evidence and timeline.
--
-- No money moves here and no escrow is introduced. A native case is a record
-- and a conversation; settlement for reservation disputes remains the existing
-- reservation endpoint's job.
--
-- ----------------------------------------------------------------------------
-- ROLLBACK (idempotent; triggers before functions, children before parents):
--
--   DROP TRIGGER IF EXISTS resolution_touch_reservation_dispute_evidence
--     ON public.reservation_dispute_evidence;
--   DROP TRIGGER IF EXISTS resolution_touch_reservation_dispute_note
--     ON public.reservation_dispute_notes;
--   DROP TRIGGER IF EXISTS resolution_sync_reservation_dispute_upd
--     ON public.reservation_disputes;
--   DROP TRIGGER IF EXISTS resolution_sync_reservation_dispute_ins
--     ON public.reservation_disputes;
--   DROP TRIGGER IF EXISTS resolution_touch_support_ticket_message
--     ON public.support_ticket_messages;
--   DROP TRIGGER IF EXISTS resolution_sync_support_ticket_upd
--     ON public.support_tickets;
--   DROP TRIGGER IF EXISTS resolution_sync_support_ticket_ins
--     ON public.support_tickets;
--
--   DROP FUNCTION IF EXISTS public.resolution_touch_reservation_dispute_case();
--   DROP FUNCTION IF EXISTS public.resolution_sync_reservation_dispute();
--   DROP FUNCTION IF EXISTS public.resolution_touch_support_ticket_case();
--   DROP FUNCTION IF EXISTS public.resolution_sync_support_ticket();
--   DROP FUNCTION IF EXISTS public.resolution_outcome_from_reservation_dispute(TEXT);
--   DROP FUNCTION IF EXISTS public.resolution_status_from_reservation_dispute(TEXT);
--   DROP FUNCTION IF EXISTS public.resolution_status_from_support_ticket(TEXT);
--
--   DROP TABLE IF EXISTS public.resolution_case_events;
--   DROP TABLE IF EXISTS public.resolution_case_evidence;
--   DROP TABLE IF EXISTS public.resolution_case_messages;
--   DROP TABLE IF EXISTS public.resolution_cases;
--   DROP SEQUENCE IF EXISTS public.resolution_case_reference_seq;
--
-- This reversal drops only objects introduced by Wave 2I. The legacy support
-- and reservation-dispute rows were never rewritten, so their data and schema
-- are byte-for-byte outside the rollback target.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Human-facing reference codes
-- ---------------------------------------------------------------------------
-- A sequence rather than a slice of the uuid: eight hex characters collide with
-- roughly even odds inside a hundred thousand cases, and a reference code a
-- support agent reads aloud must be unique for the lifetime of the platform.
CREATE SEQUENCE IF NOT EXISTS public.resolution_case_reference_seq;

-- ---------------------------------------------------------------------------
-- 2. The case spine
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resolution_cases (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code         TEXT NOT NULL UNIQUE
    DEFAULT ('MH-' || lpad(nextval('public.resolution_case_reference_seq')::text, 6, '0')),

  kind                   TEXT NOT NULL CHECK (kind IN (
    'general_support',
    'reservation_dispute',
    'need_job_dispute',
    'direct_payment',
    'safety_report'
  )),

  -- Unified, engine-independent status. `escalated` is deliberately NOT a
  -- status: a legacy-backed case has its status driven by its engine, and an
  -- escalation flag would be overwritten the next time the engine wrote. It is
  -- carried in escalated_at below and projected by the API.
  status                 TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open',
    'awaiting_user',
    'under_review',
    'resolved',
    'closed'
  )),

  opened_by              UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- The other side of a two-party case. Access is never implied by presence:
  -- `counterparty_access` is the only thing the API reads.
  counterparty_id        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  counterparty_access    BOOLEAN NOT NULL DEFAULT false,

  -- Safety reports name the reported party. This is NOT a counterparty and
  -- carries no access whatsoever — see chk_resolution_cases_safety_is_private.
  reported_user_id       UUID REFERENCES public.users(id) ON DELETE SET NULL,

  subject_type           TEXT CHECK (subject_type IN (
    'need', 'bid', 'job', 'job_application', 'reservation',
    'service', 'user', 'message', 'support_ticket'
  )),
  subject_id             UUID,

  title                  TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 500),
  description            TEXT,
  reason_code            TEXT,

  -- Legacy engine links. Exactly one is set for a legacy-backed case, and the
  -- cascade means deleting a ticket through the existing admin route removes
  -- its spine row too.
  support_ticket_id      UUID UNIQUE REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  reservation_dispute_id UUID UNIQUE REFERENCES public.reservation_disputes(id) ON DELETE CASCADE,

  assigned_admin_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,

  escalated_at           TIMESTAMPTZ,
  escalated_by           UUID REFERENCES public.users(id) ON DELETE SET NULL,
  escalation_reason      TEXT,

  resolution_outcome     TEXT CHECK (resolution_outcome IN (
    'resolved_for_opener',
    'resolved_for_counterparty',
    'resolved_partial',
    'no_action',
    'duplicate',
    'withdrawn'
  )),
  resolution_notes       TEXT,
  resolved_by            UUID REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at            TIMESTAMPTZ,

  last_activity_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A case is backed by exactly the engine its kind implies, or by none.
  CONSTRAINT chk_resolution_cases_backing CHECK (
    (kind = 'general_support'
       AND support_ticket_id IS NOT NULL AND reservation_dispute_id IS NULL)
    OR (kind = 'reservation_dispute'
       AND reservation_dispute_id IS NOT NULL AND support_ticket_id IS NULL)
    OR (kind IN ('need_job_dispute', 'direct_payment', 'safety_report')
       AND support_ticket_id IS NULL AND reservation_dispute_id IS NULL)
  ),

  CONSTRAINT chk_resolution_cases_counterparty_not_self CHECK (
    counterparty_id IS NULL OR counterparty_id <> opened_by
  ),

  -- Access requires somebody to grant it to. Without this a stray true would
  -- read as "everyone".
  CONSTRAINT chk_resolution_cases_counterparty_access CHECK (
    counterparty_access = false OR counterparty_id IS NOT NULL
  ),

  -- A safety report must never become readable by the person it is about.
  -- Enforced in the schema and not only in the service, because the cost of an
  -- application-layer mistake here is a reporter's safety.
  CONSTRAINT chk_resolution_cases_safety_is_private CHECK (
    kind <> 'safety_report' OR (counterparty_access = false AND counterparty_id IS NULL)
  ),

  CONSTRAINT chk_resolution_cases_reported_user_not_self CHECK (
    reported_user_id IS NULL OR reported_user_id <> opened_by
  ),

  CONSTRAINT chk_resolution_cases_subject_shape CHECK (
    (subject_type IS NULL) = (subject_id IS NULL)
  ),

  -- A terminal case carries the moment it became terminal, and a reopened one
  -- does not keep a stale resolution timestamp.
  CONSTRAINT chk_resolution_cases_terminal_shape CHECK (
    (status IN ('resolved', 'closed')) = (resolved_at IS NOT NULL)
  ),

  CONSTRAINT chk_resolution_cases_escalation_shape CHECK (
    (escalated_at IS NULL) = (escalated_by IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_resolution_cases_opener_activity
  ON public.resolution_cases(opened_by, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_resolution_cases_counterparty_activity
  ON public.resolution_cases(counterparty_id, last_activity_at DESC)
  WHERE counterparty_access = true;

CREATE INDEX IF NOT EXISTS idx_resolution_cases_status_activity
  ON public.resolution_cases(status, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_resolution_cases_kind_status
  ON public.resolution_cases(kind, status);

CREATE INDEX IF NOT EXISTS idx_resolution_cases_assigned
  ON public.resolution_cases(assigned_admin_id, last_activity_at DESC)
  WHERE assigned_admin_id IS NOT NULL;

-- The admin queue reads escalated-first.
CREATE INDEX IF NOT EXISTS idx_resolution_cases_escalated
  ON public.resolution_cases(escalated_at DESC)
  WHERE escalated_at IS NOT NULL AND status NOT IN ('resolved', 'closed');

CREATE INDEX IF NOT EXISTS idx_resolution_cases_subject
  ON public.resolution_cases(subject_type, subject_id)
  WHERE subject_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Duplicate prevention
-- ---------------------------------------------------------------------------
-- One live dispute per person per thing disputed. A second open dispute over
-- the same award or the same payment is by definition the same dispute, and
-- two of them means two admins reaching two answers.
--
-- Safety reports are deliberately excluded: a second report about the same user
-- is usually a second incident, and refusing it would silence a reporter.
CREATE UNIQUE INDEX IF NOT EXISTS uq_resolution_cases_live_dispute_subject
  ON public.resolution_cases(kind, subject_type, subject_id, opened_by)
  WHERE status IN ('open', 'awaiting_user', 'under_review')
    AND subject_id IS NOT NULL
    AND kind IN ('need_job_dispute', 'direct_payment');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trigger_set_updated_at')
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgname = 'set_resolution_cases_updated_at'
         AND tgrelid = 'public.resolution_cases'::regclass
     ) THEN
    CREATE TRIGGER set_resolution_cases_updated_at
      BEFORE UPDATE ON public.resolution_cases
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Native case thread, evidence and timeline
-- ---------------------------------------------------------------------------
-- Only native kinds write here. A general-support case's messages stay in
-- support_ticket_messages and a reservation dispute's stay in
-- reservation_dispute_notes, so the old screens keep working and there is no
-- second copy to drift.
CREATE TABLE IF NOT EXISTS public.resolution_case_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    UUID NOT NULL REFERENCES public.resolution_cases(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
  -- 'admin' notes are internal and are never returned to a participant.
  visibility TEXT NOT NULL DEFAULT 'participants'
    CHECK (visibility IN ('participants', 'admin')),
  is_staff   BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resolution_case_messages_case_created
  ON public.resolution_case_messages(case_id, created_at);

CREATE TABLE IF NOT EXISTS public.resolution_case_evidence (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     UUID NOT NULL REFERENCES public.resolution_cases(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- ON DELETE RESTRICT: evidence outlives the uploader's second thoughts.
  upload_id   UUID NOT NULL REFERENCES public.private_uploads(id) ON DELETE RESTRICT,
  label       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, upload_id)
);

CREATE INDEX IF NOT EXISTS idx_resolution_case_evidence_case_created
  ON public.resolution_case_evidence(case_id, created_at DESC);

-- Answering "may this user open this file" from the upload route.
CREATE INDEX IF NOT EXISTS idx_resolution_case_evidence_upload
  ON public.resolution_case_evidence(upload_id);

CREATE TABLE IF NOT EXISTS public.resolution_case_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    UUID NOT NULL REFERENCES public.resolution_cases(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resolution_case_events_case_created
  ON public.resolution_case_events(case_id, created_at);

-- ---------------------------------------------------------------------------
-- 4. Legacy status projection
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolution_status_from_support_ticket(p_status TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_status
    WHEN 'open'          THEN 'open'
    WHEN 'in_progress'   THEN 'under_review'
    WHEN 'waiting_reply' THEN 'awaiting_user'
    WHEN 'resolved'      THEN 'resolved'
    WHEN 'closed'        THEN 'closed'
    ELSE 'open'
  END;
$$;

CREATE OR REPLACE FUNCTION public.resolution_status_from_reservation_dispute(p_status TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_status
    WHEN 'open'               THEN 'under_review'
    WHEN 'resolved_customer'  THEN 'resolved'
    WHEN 'resolved_provider'  THEN 'resolved'
    WHEN 'resolved_partial'   THEN 'resolved'
    WHEN 'dismissed'          THEN 'closed'
    ELSE 'under_review'
  END;
$$;

CREATE OR REPLACE FUNCTION public.resolution_outcome_from_reservation_dispute(p_status TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_status
    WHEN 'resolved_customer' THEN 'resolved_for_opener'
    WHEN 'resolved_provider' THEN 'resolved_for_counterparty'
    WHEN 'resolved_partial'  THEN 'resolved_partial'
    WHEN 'dismissed'         THEN 'no_action'
    ELSE NULL
  END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Support ticket → spine
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolution_sync_support_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT := public.resolution_status_from_support_ticket(NEW.status);
  v_terminal BOOLEAN := v_status IN ('resolved', 'closed');
BEGIN
  INSERT INTO public.resolution_cases (
    kind, status, opened_by, subject_type, subject_id, title,
    support_ticket_id, assigned_admin_id, reason_code,
    resolved_at, last_activity_at, created_at, updated_at
  )
  VALUES (
    'general_support', v_status, NEW.user_id, 'support_ticket', NEW.id,
    left(COALESCE(NULLIF(btrim(NEW.subject), ''), 'Support request'), 500),
    NEW.id, NEW.assigned_to, NEW.category,
    CASE WHEN v_terminal THEN NEW.updated_at ELSE NULL END,
    NEW.updated_at, NEW.created_at, NEW.updated_at
  )
  ON CONFLICT (support_ticket_id) DO UPDATE
    SET status            = EXCLUDED.status,
        title             = EXCLUDED.title,
        assigned_admin_id = EXCLUDED.assigned_admin_id,
        reason_code       = EXCLUDED.reason_code,
        resolution_outcome = CASE
                               WHEN EXCLUDED.status IN ('resolved', 'closed')
                                 THEN resolution_cases.resolution_outcome
                               ELSE NULL
                             END,
        resolution_notes  = CASE
                               WHEN EXCLUDED.status IN ('resolved', 'closed')
                                 THEN resolution_cases.resolution_notes
                               ELSE NULL
                             END,
        resolved_by       = CASE
                               WHEN EXCLUDED.status IN ('resolved', 'closed')
                                 THEN resolution_cases.resolved_by
                               ELSE NULL
                             END,
        -- Reopening a resolved ticket must clear the resolution timestamp, or
        -- chk_resolution_cases_terminal_shape rejects the update.
        resolved_at       = CASE
                              WHEN EXCLUDED.status IN ('resolved', 'closed')
                                THEN COALESCE(resolution_cases.resolved_at, EXCLUDED.updated_at)
                              ELSE NULL
                            END,
        last_activity_at  = GREATEST(resolution_cases.last_activity_at, EXCLUDED.last_activity_at),
        updated_at        = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resolution_sync_support_ticket_ins ON public.support_tickets;
CREATE TRIGGER resolution_sync_support_ticket_ins
  AFTER INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.resolution_sync_support_ticket();

DROP TRIGGER IF EXISTS resolution_sync_support_ticket_upd ON public.support_tickets;
CREATE TRIGGER resolution_sync_support_ticket_upd
  AFTER UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.resolution_sync_support_ticket();

CREATE OR REPLACE FUNCTION public.resolution_touch_support_ticket_case()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.resolution_cases
     SET last_activity_at = GREATEST(last_activity_at, NEW.created_at)
   WHERE support_ticket_id = NEW.ticket_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resolution_touch_support_ticket_message ON public.support_ticket_messages;
CREATE TRIGGER resolution_touch_support_ticket_message
  AFTER INSERT ON public.support_ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public.resolution_touch_support_ticket_case();

-- ---------------------------------------------------------------------------
-- 6. Reservation dispute → spine
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolution_sync_reservation_dispute()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_customer     UUID;
  v_provider     UUID;
  v_title        TEXT;
  v_opener       UUID;
  v_counterparty UUID;
  v_status       TEXT := public.resolution_status_from_reservation_dispute(NEW.status);
  v_terminal     BOOLEAN := v_status IN ('resolved', 'closed');
BEGIN
  SELECT r.customer_id, r.provider_id, s.title
    INTO v_customer, v_provider, v_title
    FROM public.reservations r
    LEFT JOIN public.services s ON s.id = r.service_id
   WHERE r.id = NEW.reservation_id;

  IF v_customer IS NULL THEN
    -- No reservation to hang a case on. The dispute row is still valid; the
    -- unified centre simply has nothing coherent to show, and inventing an
    -- owner would be worse than omitting the case.
    RETURN NEW;
  END IF;

  -- A dispute opened by the timeout worker has no opener. The customer is the
  -- party the case is for; the provider is the counterparty either way.
  v_opener       := COALESCE(NEW.opened_by, v_customer);
  v_counterparty := CASE WHEN v_opener = v_customer THEN v_provider ELSE v_customer END;

  INSERT INTO public.resolution_cases (
    kind, status, opened_by, counterparty_id, counterparty_access,
    subject_type, subject_id, title, description, reason_code,
    reservation_dispute_id, resolution_outcome, resolution_notes,
    resolved_by, resolved_at, last_activity_at, created_at, updated_at
  )
  VALUES (
    'reservation_dispute', v_status, v_opener,
    NULLIF(v_counterparty, v_opener),
    -- Both reservation participants already reach this case through the
    -- existing endpoint; the spine records that access explicitly rather than
    -- letting the unified reader infer it.
    (v_counterparty IS NOT NULL AND v_counterparty <> v_opener),
    'reservation', NEW.reservation_id,
    left(COALESCE(NULLIF(btrim(v_title), ''), 'Reservation dispute'), 500),
    NEW.description, NEW.reason,
    NEW.id,
    public.resolution_outcome_from_reservation_dispute(NEW.status),
    NEW.resolution_notes, NEW.resolved_by,
    CASE WHEN v_terminal THEN COALESCE(NEW.resolved_at, NEW.updated_at) ELSE NULL END,
    NEW.updated_at, NEW.created_at, NEW.updated_at
  )
  ON CONFLICT (reservation_dispute_id) DO UPDATE
    SET status             = EXCLUDED.status,
        title              = EXCLUDED.title,
        description        = EXCLUDED.description,
        reason_code        = EXCLUDED.reason_code,
        resolution_outcome = EXCLUDED.resolution_outcome,
        resolution_notes   = EXCLUDED.resolution_notes,
        resolved_by        = EXCLUDED.resolved_by,
        resolved_at        = CASE
                               WHEN EXCLUDED.status IN ('resolved', 'closed')
                                 THEN COALESCE(EXCLUDED.resolved_at, resolution_cases.resolved_at)
                               ELSE NULL
                             END,
        last_activity_at   = GREATEST(resolution_cases.last_activity_at, EXCLUDED.last_activity_at),
        updated_at         = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resolution_sync_reservation_dispute_ins ON public.reservation_disputes;
CREATE TRIGGER resolution_sync_reservation_dispute_ins
  AFTER INSERT ON public.reservation_disputes
  FOR EACH ROW EXECUTE FUNCTION public.resolution_sync_reservation_dispute();

DROP TRIGGER IF EXISTS resolution_sync_reservation_dispute_upd ON public.reservation_disputes;
CREATE TRIGGER resolution_sync_reservation_dispute_upd
  AFTER UPDATE ON public.reservation_disputes
  FOR EACH ROW EXECUTE FUNCTION public.resolution_sync_reservation_dispute();

CREATE OR REPLACE FUNCTION public.resolution_touch_reservation_dispute_case()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.resolution_cases
     SET last_activity_at = GREATEST(last_activity_at, NEW.created_at)
   WHERE reservation_dispute_id = NEW.dispute_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resolution_touch_reservation_dispute_note ON public.reservation_dispute_notes;
CREATE TRIGGER resolution_touch_reservation_dispute_note
  AFTER INSERT ON public.reservation_dispute_notes
  FOR EACH ROW EXECUTE FUNCTION public.resolution_touch_reservation_dispute_case();

DROP TRIGGER IF EXISTS resolution_touch_reservation_dispute_evidence ON public.reservation_dispute_evidence;
CREATE TRIGGER resolution_touch_reservation_dispute_evidence
  AFTER INSERT ON public.reservation_dispute_evidence
  FOR EACH ROW EXECUTE FUNCTION public.resolution_touch_reservation_dispute_case();

-- ---------------------------------------------------------------------------
-- 7. Backfill every existing ticket and dispute
-- ---------------------------------------------------------------------------
-- Nothing is read from the old tables destructively and nothing is deleted.
-- Re-running is safe: both inserts skip rows that already have a spine.
INSERT INTO public.resolution_cases (
  kind, status, opened_by, subject_type, subject_id, title,
  support_ticket_id, assigned_admin_id, reason_code,
  resolved_at, last_activity_at, created_at, updated_at
)
SELECT
  'general_support',
  public.resolution_status_from_support_ticket(t.status),
  t.user_id,
  'support_ticket',
  t.id,
  left(COALESCE(NULLIF(btrim(t.subject), ''), 'Support request'), 500),
  t.id,
  t.assigned_to,
  t.category,
  CASE
    WHEN public.resolution_status_from_support_ticket(t.status) IN ('resolved', 'closed')
      THEN t.updated_at
    ELSE NULL
  END,
  GREATEST(t.updated_at, COALESCE(m.last_message_at, t.updated_at)),
  t.created_at,
  t.updated_at
FROM public.support_tickets t
LEFT JOIN (
  SELECT ticket_id, max(created_at) AS last_message_at
    FROM public.support_ticket_messages
   GROUP BY ticket_id
) m ON m.ticket_id = t.id
WHERE NOT EXISTS (
  SELECT 1 FROM public.resolution_cases c WHERE c.support_ticket_id = t.id
);

INSERT INTO public.resolution_cases (
  kind, status, opened_by, counterparty_id, counterparty_access,
  subject_type, subject_id, title, description, reason_code,
  reservation_dispute_id, resolution_outcome, resolution_notes,
  resolved_by, resolved_at, last_activity_at, created_at, updated_at
)
SELECT
  'reservation_dispute',
  public.resolution_status_from_reservation_dispute(d.status),
  COALESCE(d.opened_by, r.customer_id) AS opener,
  NULLIF(
    CASE WHEN COALESCE(d.opened_by, r.customer_id) = r.customer_id
         THEN r.provider_id ELSE r.customer_id END,
    COALESCE(d.opened_by, r.customer_id)
  ),
  CASE WHEN COALESCE(d.opened_by, r.customer_id) = r.customer_id
       THEN r.provider_id ELSE r.customer_id END
    <> COALESCE(d.opened_by, r.customer_id),
  'reservation',
  d.reservation_id,
  left(COALESCE(NULLIF(btrim(s.title), ''), 'Reservation dispute'), 500),
  d.description,
  d.reason,
  d.id,
  public.resolution_outcome_from_reservation_dispute(d.status),
  d.resolution_notes,
  d.resolved_by,
  CASE
    WHEN public.resolution_status_from_reservation_dispute(d.status) IN ('resolved', 'closed')
      THEN COALESCE(d.resolved_at, d.updated_at)
    ELSE NULL
  END,
  GREATEST(d.updated_at, COALESCE(a.last_activity_at, d.updated_at)),
  d.created_at,
  d.updated_at
FROM public.reservation_disputes d
JOIN public.reservations r ON r.id = d.reservation_id
LEFT JOIN public.services s ON s.id = r.service_id
LEFT JOIN (
  SELECT dispute_id, max(created_at) AS last_activity_at FROM (
    SELECT dispute_id, created_at FROM public.reservation_dispute_notes
    UNION ALL
    SELECT dispute_id, created_at FROM public.reservation_dispute_evidence
  ) activity
  GROUP BY dispute_id
) a ON a.dispute_id = d.id
WHERE NOT EXISTS (
  SELECT 1 FROM public.resolution_cases c WHERE c.reservation_dispute_id = d.id
);

-- ---------------------------------------------------------------------------
-- 8. Backend-only access posture
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'resolution_cases',
    'resolution_case_messages',
    'resolution_case_evidence',
    'resolution_case_events'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON SEQUENCE public.resolution_case_reference_seq FROM anon, authenticated;

COMMENT ON TABLE public.resolution_cases IS
  'Unified Help & Resolution case spine. Legacy-backed cases mirror support_tickets / reservation_disputes via triggers; native kinds live here.';
COMMENT ON COLUMN public.resolution_cases.counterparty_access IS
  'Explicit grant. The API reads only this column when deciding counterparty access — presence of counterparty_id grants nothing.';
COMMENT ON COLUMN public.resolution_cases.reported_user_id IS
  'Subject of a safety report. Never granted access to the case.';
COMMENT ON TABLE public.resolution_case_evidence IS
  'Private evidence for native cases. Files are reached only through GET /api/upload/private/:id, which authorises server-side.';
