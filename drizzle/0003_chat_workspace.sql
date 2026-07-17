-- Chat + workspace persistence for refresh restore
ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "status" varchar(32) NOT NULL DEFAULT 'idle';

CREATE TABLE IF NOT EXISTS "manycat_workflow_message" (
  "id" varchar(64) PRIMARY KEY,
  "accountId" varchar(128) NOT NULL REFERENCES "manycat_account"("id") ON DELETE CASCADE,
  "workflowId" varchar(64) NOT NULL,
  "seq" integer NOT NULL,
  "payload" jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "workflow_message_scope_idx"
  ON "manycat_workflow_message" ("accountId", "workflowId", "seq");

CREATE TABLE IF NOT EXISTS "manycat_workspace_file" (
  "accountId" varchar(128) NOT NULL REFERENCES "manycat_account"("id") ON DELETE CASCADE,
  "workflowId" varchar(64) NOT NULL,
  "path" varchar(512) NOT NULL,
  "contents" text NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("accountId", "workflowId", "path")
);

CREATE INDEX IF NOT EXISTS "workspace_file_scope_idx"
  ON "manycat_workspace_file" ("accountId", "workflowId");
