-- Chat read receipts
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS participant_a_last_read_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS participant_b_last_read_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE bids ADD COLUMN IF NOT EXISTS expert_last_read_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE bids ADD COLUMN IF NOT EXISTS customer_last_read_at TIMESTAMPTZ DEFAULT now();