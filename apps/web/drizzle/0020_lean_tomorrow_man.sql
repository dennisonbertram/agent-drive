-- Optional index for folder listings (list?delimiter=/). The API works without it.
-- drizzle's migrator runs inside a transaction, so CREATE INDEX CONCURRENTLY is not possible here.
-- A plain CREATE INDEX blocks writes to "files" while it builds. On a large live table, run
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "files_drive_live_path_prefix_idx" ON "files" USING btree ("drive_id","path" text_pattern_ops) WHERE "deleted_at" IS NULL;
-- by hand first, then check it is valid (a failed CONCURRENTLY build leaves an INVALID index that
-- IF NOT EXISTS would silently accept):
--   SELECT indisvalid FROM pg_index WHERE indexrelid = 'files_drive_live_path_prefix_idx'::regclass;
-- If indisvalid is false, run DROP INDEX CONCURRENTLY "files_drive_live_path_prefix_idx"; and build
-- it again before running migrations. When valid, this statement is a no-op.
CREATE INDEX IF NOT EXISTS "files_drive_live_path_prefix_idx" ON "files" USING btree ("drive_id","path" text_pattern_ops) WHERE "files"."deleted_at" IS NULL;
