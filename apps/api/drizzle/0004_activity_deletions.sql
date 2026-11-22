CREATE TABLE finscope_private.activity_deletions (
  activity_kind text NOT NULL CHECK (activity_kind IN ('transaction', 'transfer')),
  activity_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  record jsonb NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (activity_kind, activity_id)
);
--> statement-breakpoint
REVOKE ALL ON TABLE finscope_private.activity_deletions FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE finscope_private.activity_deletions ENABLE ROW LEVEL SECURITY;
