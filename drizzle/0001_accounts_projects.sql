-- Manycat account / project tables (Phase 1 Railway production path)
-- Apply with: pnpm db:push  (when DATABASE_URL is reachable)

CREATE TABLE IF NOT EXISTS manycat_account (
  id varchar(128) PRIMARY KEY,
  billing_plan varchar(16) NOT NULL DEFAULT 'free',
  compute_used_cents integer NOT NULL DEFAULT 0,
  compute_period_start timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS account_billing_idx ON manycat_account (billing_plan);

CREATE TABLE IF NOT EXISTS manycat_project (
  id varchar(64) NOT NULL,
  account_id varchar(128) NOT NULL REFERENCES manycat_account(id) ON DELETE CASCADE,
  name varchar(256) NOT NULL,
  github_repo varchar(512),
  content_root_hash varchar(128),
  content_backend varchar(32) NOT NULL DEFAULT 'github',
  template_id varchar(128),
  railway_service_id varchar(128),
  railway_domain varchar(512),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  PRIMARY KEY (account_id, id)
);

CREATE INDEX IF NOT EXISTS project_account_idx ON manycat_project (account_id);

CREATE TABLE IF NOT EXISTS manycat_project_change (
  id varchar(64) PRIMARY KEY,
  account_id varchar(128) NOT NULL REFERENCES manycat_account(id) ON DELETE CASCADE,
  workflow_id varchar(64) NOT NULL,
  parent_id varchar(64),
  tree_hash varchar(128),
  diff text,
  prompt text,
  template_id varchar(128),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_change_scope_idx
  ON manycat_project_change (account_id, workflow_id);
