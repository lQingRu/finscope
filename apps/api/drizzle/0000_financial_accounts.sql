REVOKE ALL ON SCHEMA finscope_private FROM PUBLIC;
--> statement-breakpoint
CREATE TABLE finscope_private.financial_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  name varchar(100) NOT NULL CHECK (length(btrim(name)) > 0),
  type text NOT NULL CHECK (type IN ('bank', 'brokerage')),
  opening_date date NOT NULL CHECK (opening_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  opening_balance numeric(14, 2) NOT NULL CHECK (opening_balance <> 'NaN'::numeric)
);
--> statement-breakpoint
REVOKE ALL ON TABLE finscope_private.financial_accounts FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE finscope_private.financial_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX financial_accounts_owner_idx ON finscope_private.financial_accounts (owner_user_id);
