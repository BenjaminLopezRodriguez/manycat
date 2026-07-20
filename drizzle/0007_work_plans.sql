-- Work mode: plan-over-time, join-link chats, intelligence, OAuth connectors

CREATE TABLE IF NOT EXISTS "manycat_work_plan" (
  "id" varchar(64) PRIMARY KEY,
  "accountId" varchar(128) NOT NULL REFERENCES "manycat_account"("id") ON DELETE cascade,
  "workflowId" varchar(64) NOT NULL,
  "startsAt" timestamptz NOT NULL,
  "endsAt" timestamptz NOT NULL,
  "cadence" jsonb NOT NULL,
  "timezone" varchar(64) NOT NULL DEFAULT 'UTC',
  "promptTemplate" text NOT NULL DEFAULT '',
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "nextDueAt" timestamptz,
  "googleEventId" varchar(256),
  "notify" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz
);

CREATE INDEX IF NOT EXISTS "work_plan_account_idx" ON "manycat_work_plan" ("accountId");
CREATE INDEX IF NOT EXISTS "work_plan_due_idx" ON "manycat_work_plan" ("status", "nextDueAt");
CREATE INDEX IF NOT EXISTS "work_plan_workflow_idx" ON "manycat_work_plan" ("accountId", "workflowId");

CREATE TABLE IF NOT EXISTS "manycat_work_plan_occurrence" (
  "id" varchar(64) PRIMARY KEY,
  "planId" varchar(64) NOT NULL REFERENCES "manycat_work_plan"("id") ON DELETE cascade,
  "dueAt" timestamptz NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "firedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "work_occurrence_plan_idx" ON "manycat_work_plan_occurrence" ("planId", "dueAt");
CREATE INDEX IF NOT EXISTS "work_occurrence_status_idx" ON "manycat_work_plan_occurrence" ("status");

CREATE TABLE IF NOT EXISTS "manycat_work_session_member" (
  "workflowId" varchar(64) NOT NULL,
  "ownerAccountId" varchar(128) NOT NULL REFERENCES "manycat_account"("id") ON DELETE cascade,
  "accountId" varchar(128) NOT NULL REFERENCES "manycat_account"("id") ON DELETE cascade,
  "role" varchar(16) NOT NULL DEFAULT 'member',
  "joinedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workflowId", "accountId")
);

CREATE INDEX IF NOT EXISTS "work_member_account_idx" ON "manycat_work_session_member" ("accountId");
CREATE INDEX IF NOT EXISTS "work_member_owner_idx" ON "manycat_work_session_member" ("ownerAccountId", "workflowId");

CREATE TABLE IF NOT EXISTS "manycat_work_join_token" (
  "token" varchar(64) PRIMARY KEY,
  "workflowId" varchar(64) NOT NULL,
  "ownerAccountId" varchar(128) NOT NULL REFERENCES "manycat_account"("id") ON DELETE cascade,
  "createdBy" varchar(128) NOT NULL REFERENCES "manycat_account"("id") ON DELETE cascade,
  "expiresAt" timestamptz,
  "revokedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "work_join_workflow_idx" ON "manycat_work_join_token" ("workflowId");

CREATE TABLE IF NOT EXISTS "manycat_work_note" (
  "id" varchar(64) PRIMARY KEY,
  "workflowId" varchar(64) NOT NULL,
  "ownerAccountId" varchar(128) NOT NULL REFERENCES "manycat_account"("id") ON DELETE cascade,
  "sourceMessageId" varchar(64),
  "authorAccountId" varchar(128),
  "authorLabel" varchar(128),
  "text" text NOT NULL,
  "summary" varchar(512) NOT NULL,
  "usedInPlanId" varchar(64),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "work_note_workflow_idx" ON "manycat_work_note" ("workflowId", "createdAt");
CREATE INDEX IF NOT EXISTS "work_note_unused_idx" ON "manycat_work_note" ("workflowId", "usedInPlanId");

CREATE TABLE IF NOT EXISTS "manycat_oauth_connection" (
  "id" varchar(64) PRIMARY KEY,
  "accountId" varchar(128) NOT NULL REFERENCES "manycat_account"("id") ON DELETE cascade,
  "provider" varchar(32) NOT NULL,
  "accessTokenEnc" text NOT NULL,
  "refreshTokenEnc" text,
  "scopes" text NOT NULL DEFAULT '',
  "expiresAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz
);

CREATE INDEX IF NOT EXISTS "oauth_connection_account_idx" ON "manycat_oauth_connection" ("accountId", "provider");
