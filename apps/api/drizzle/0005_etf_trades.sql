CREATE TABLE finscope_private.etf_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  entry_order bigint GENERATED ALWAYS AS IDENTITY,
  ticker text NOT NULL CHECK (ticker ~ '^[A-Z0-9][A-Z0-9._/-]{0,23}$'),
  exchange text NOT NULL DEFAULT '' CHECK (exchange ~ '^[A-Z0-9._-]{0,20}$'),
  type text NOT NULL CHECK (type IN ('buy', 'sell')),
  date date NOT NULL CHECK (date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  quantity numeric(20, 8) NOT NULL CHECK (quantity > 0 AND quantity <> 'NaN'::numeric),
  execution_price numeric(20, 8) NOT NULL CHECK (execution_price > 0 AND execution_price <> 'NaN'::numeric),
  fee numeric(14, 2) NOT NULL CHECK (fee >= 0 AND fee <> 'NaN'::numeric),
  purpose varchar(500) NOT NULL DEFAULT '',
  strategy varchar(100) NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  notes varchar(2000) NOT NULL DEFAULT '',
  gross_amount numeric NOT NULL,
  cash_movement numeric NOT NULL,
  cost_basis_change numeric NOT NULL,
  realised_pnl numeric,
  CONSTRAINT etf_trades_account_fk FOREIGN KEY (owner_user_id, account_id)
    REFERENCES finscope_private.financial_accounts (owner_user_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
REVOKE ALL ON TABLE finscope_private.etf_trades FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE finscope_private.etf_trades ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX etf_trades_account_history_idx
  ON finscope_private.etf_trades (owner_user_id, account_id, date, entry_order);
--> statement-breakpoint
ALTER TABLE finscope_private.activity_deletions DROP CONSTRAINT activity_deletions_activity_kind_check;
--> statement-breakpoint
ALTER TABLE finscope_private.activity_deletions
  ADD CHECK (activity_kind IN ('transaction', 'transfer', 'etf_trade'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION finscope_private.guard_account_opening_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM finscope_private.transactions
    WHERE owner_user_id = NEW.owner_user_id AND account_id = NEW.id AND date < NEW.opening_date
  ) OR EXISTS (
    SELECT 1 FROM finscope_private.transfers
    WHERE owner_user_id = NEW.owner_user_id
      AND (source_account_id = NEW.id OR destination_account_id = NEW.id) AND date < NEW.opening_date
  ) OR EXISTS (
    SELECT 1 FROM finscope_private.etf_trades
    WHERE owner_user_id = NEW.owner_user_id AND account_id = NEW.id AND date < NEW.opening_date
  ) THEN
    RAISE EXCEPTION 'Account opening date cannot follow recorded activity'
      USING ERRCODE = '23514', CONSTRAINT = 'financial_accounts_opening_date_before_activity';
  END IF;
  RETURN NEW;
END;
$$;
