CREATE TABLE finscope_private.transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  source_account_id uuid NOT NULL,
  destination_account_id uuid NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0 AND amount <> 'NaN'::numeric),
  date date NOT NULL CHECK (date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (source_account_id <> destination_account_id),
  CONSTRAINT transfers_source_account_fk FOREIGN KEY (owner_user_id, source_account_id)
    REFERENCES finscope_private.financial_accounts (owner_user_id, id) ON DELETE RESTRICT,
  CONSTRAINT transfers_destination_account_fk FOREIGN KEY (owner_user_id, destination_account_id)
    REFERENCES finscope_private.financial_accounts (owner_user_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
REVOKE ALL ON TABLE finscope_private.transfers FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE finscope_private.transfers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX transfers_source_history_idx
  ON finscope_private.transfers (owner_user_id, source_account_id, date DESC, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX transfers_destination_history_idx
  ON finscope_private.transfers (owner_user_id, destination_account_id, date DESC, created_at DESC, id DESC);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION finscope_private.guard_account_opening_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  -- At READ COMMITTED this sees activity committed while the account update waited for its row lock.
  IF EXISTS (
    SELECT 1
    FROM finscope_private.transactions
    WHERE owner_user_id = NEW.owner_user_id AND account_id = NEW.id AND date < NEW.opening_date
  ) OR EXISTS (
    SELECT 1
    FROM finscope_private.transfers
    WHERE owner_user_id = NEW.owner_user_id
      AND (source_account_id = NEW.id OR destination_account_id = NEW.id) AND date < NEW.opening_date
  ) THEN
    RAISE EXCEPTION 'Account opening date cannot follow recorded activity'
      USING ERRCODE = '23514', CONSTRAINT = 'financial_accounts_opening_date_before_activity';
  END IF;
  RETURN NEW;
END;
$$;
