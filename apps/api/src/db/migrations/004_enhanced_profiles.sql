-- ============================================================================
-- MohandisHub — v004: Enhanced profiles, identity documents, academic records
--
-- SPLITS verification into two tracks:
--   1. Identity verification  →  national ID / driving license / passport
--      (can be auto-verified via Idenfy or manual admin review)
--   2. Academic / career verification  →  degrees, certificates
--      (always admin-reviewed)
--
-- Also enriches expert_profiles & business_profiles with more fields.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Identity documents — national ID, driving license, passport
--    Used by: experts (personal), business owners (personal)
-- --------------------------------------------------------------------------
CREATE TABLE identity_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type     VARCHAR(30) NOT NULL
                      CHECK (document_type IN ('national_id', 'driving_license', 'passport')),
  document_number   VARCHAR(100),               -- encrypted / masked in production
  full_name_on_doc  VARCHAR(200) NOT NULL,
  date_of_birth     DATE,
  nationality       VARCHAR(100) DEFAULT 'Egyptian',
  front_image_url   TEXT,                        -- storage bucket path
  back_image_url    TEXT,                        -- storage bucket path (not for passport)
  selfie_image_url  TEXT,                        -- holding-doc selfie
  provider          VARCHAR(50),                 -- 'idenfy', 'manual', null
  provider_ref      VARCHAR(255),                -- external session/scan ID
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'under_review', 'approved', 'rejected', 'expired')),
  rejection_reason  TEXT,
  reviewed_by       UUID REFERENCES users(id),   -- admin who reviewed
  reviewed_at       TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,                 -- document expiry date
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_identity_docs_user    ON identity_documents (user_id);
CREATE INDEX idx_identity_docs_status  ON identity_documents (status);

-- --------------------------------------------------------------------------
-- 2. Academic records — degrees, certifications
--    Used by: experts only (admin-reviewed)
-- --------------------------------------------------------------------------
CREATE TABLE academic_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_type           VARCHAR(30) NOT NULL
                          CHECK (record_type IN ('degree', 'diploma', 'certificate', 'license')),
  title                 VARCHAR(300) NOT NULL,      -- "BSc Mechanical Engineering"
  institution           VARCHAR(300) NOT NULL,      -- "Cairo University"
  field_of_study        VARCHAR(200),               -- "Mechanical Engineering"
  graduation_year       SMALLINT,
  grade                 VARCHAR(50),                -- "Excellent", "Very Good", "3.8 GPA"
  certificate_image_url TEXT,                        -- scanned certificate
  transcript_image_url  TEXT,                        -- optional transcript
  status                VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'under_review', 'approved', 'rejected')),
  rejection_reason      TEXT,
  reviewed_by           UUID REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_academic_records_user   ON academic_records (user_id);
CREATE INDEX idx_academic_records_status ON academic_records (status);

-- --------------------------------------------------------------------------
-- 3. Enhance expert_profiles with more career/personal fields
-- --------------------------------------------------------------------------
ALTER TABLE expert_profiles
  ADD COLUMN headline             VARCHAR(300),           -- short tagline
  ADD COLUMN linkedin_url         VARCHAR(500),
  ADD COLUMN portfolio_url        VARCHAR(500),
  ADD COLUMN languages            TEXT[] DEFAULT '{}',    -- e.g. {"Arabic","English"}
  ADD COLUMN education_summary    TEXT,                   -- free-text summary
  ADD COLUMN employer             VARCHAR(200),           -- current employer
  ADD COLUMN job_title            VARCHAR(200),           -- current position
  ADD COLUMN certifications_count SMALLINT DEFAULT 0,
  ADD COLUMN identity_verified    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN academic_verified    BOOLEAN NOT NULL DEFAULT false;

-- --------------------------------------------------------------------------
-- 4. Enhance business_profiles with owner + company details
-- --------------------------------------------------------------------------
ALTER TABLE business_profiles
  ADD COLUMN owner_full_name      VARCHAR(200),           -- boss / owner name
  ADD COLUMN owner_title          VARCHAR(100),           -- "CEO", "Managing Director"
  ADD COLUMN owner_email          VARCHAR(255),           -- owner personal/work email
  ADD COLUMN owner_phone          VARCHAR(20),
  ADD COLUMN company_email        VARCHAR(255),           -- official company email
  ADD COLUMN company_phone        VARCHAR(20),
  ADD COLUMN commercial_register  VARCHAR(100),           -- سجل تجاري
  ADD COLUMN address              TEXT,
  ADD COLUMN logo_url             TEXT,
  ADD COLUMN social_facebook      VARCHAR(500),
  ADD COLUMN social_linkedin      VARCHAR(500),
  ADD COLUMN social_twitter       VARCHAR(500),
  ADD COLUMN employees_count      SMALLINT,
  ADD COLUMN founded_year         SMALLINT,
  ADD COLUMN identity_verified    BOOLEAN NOT NULL DEFAULT false,  -- owner identity
  ADD COLUMN business_verified    BOOLEAN NOT NULL DEFAULT false;  -- company docs

-- --------------------------------------------------------------------------
-- 5. Admin reviews — unified audit trail for any verification decision
-- --------------------------------------------------------------------------
CREATE TABLE admin_reviews (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id       UUID NOT NULL REFERENCES users(id),  -- the admin
  target_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  review_type       VARCHAR(30) NOT NULL
                      CHECK (review_type IN ('identity', 'academic', 'business_docs')),
  target_table      VARCHAR(50) NOT NULL,                -- 'identity_documents', 'academic_records', etc.
  target_record_id  UUID NOT NULL,                       -- PK of the reviewed row
  decision          VARCHAR(20) NOT NULL
                      CHECK (decision IN ('approved', 'rejected')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_reviews_target_user ON admin_reviews (target_user_id);
CREATE INDEX idx_admin_reviews_reviewer    ON admin_reviews (reviewer_id);

-- --------------------------------------------------------------------------
-- 6. Add admin role to users check constraint
-- --------------------------------------------------------------------------
ALTER TABLE users
  DROP CONSTRAINT users_primary_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_primary_role_check
    CHECK (primary_role IN ('customer', 'expert', 'business', 'admin'));

-- --------------------------------------------------------------------------
-- 7. Triggers for new tables
-- --------------------------------------------------------------------------
CREATE TRIGGER set_identity_documents_updated_at
  BEFORE UPDATE ON identity_documents
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_academic_records_updated_at
  BEFORE UPDATE ON academic_records
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
