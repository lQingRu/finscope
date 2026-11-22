ALTER TABLE finscope_private.financial_accounts ADD CONSTRAINT financial_accounts_owner_id_unique UNIQUE (owner_user_id, id);
--> statement-breakpoint
CREATE TABLE finscope_private.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  type text NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0 AND amount <> 'NaN'::numeric),
  date date NOT NULL CHECK (date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  category text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT transactions_account_fk FOREIGN KEY (owner_user_id, account_id)
    REFERENCES finscope_private.financial_accounts (owner_user_id, id) ON DELETE RESTRICT,
  CHECK (
    (type = 'income' AND category IN ('Salary', 'Other Income')) OR
    (type = 'expense' AND category IN ('Food', 'Transport', 'Shopping', 'Bills', 'Other Expense'))
  )
);
--> statement-breakpoint
REVOKE ALL ON TABLE finscope_private.transactions FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE finscope_private.transactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX transactions_account_history_idx
  ON finscope_private.transactions (owner_user_id, account_id, date DESC, created_at DESC, id DESC);
