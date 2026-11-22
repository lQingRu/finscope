CREATE FUNCTION finscope_private.guard_account_opening_date()
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
  ) THEN
    RAISE EXCEPTION 'Account opening date cannot follow recorded activity'
      USING ERRCODE = '23514', CONSTRAINT = 'financial_accounts_opening_date_before_activity';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER financial_accounts_opening_date_before_activity
  AFTER UPDATE OF opening_date ON finscope_private.financial_accounts
  FOR EACH ROW
  WHEN (OLD.opening_date IS DISTINCT FROM NEW.opening_date)
  EXECUTE FUNCTION finscope_private.guard_account_opening_date();
