ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "mirrorGithubRepo" varchar(512);
ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "neonMode" varchar(16);
ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "neonSchema" varchar(128);
ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "neonRole" varchar(128);
ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "neonRolePasswordEnc" text;
ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "neonProjectId" varchar(128);
