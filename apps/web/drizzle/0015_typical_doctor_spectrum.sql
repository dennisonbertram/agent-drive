SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "file_events" ADD COLUMN "seq" bigint;--> statement-breakpoint
UPDATE "file_events" f SET "seq" = r.n FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM "file_events") r WHERE f.id = r.id;--> statement-breakpoint
ALTER TABLE "file_events" ALTER COLUMN "seq" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "file_events" ALTER COLUMN "seq" ADD GENERATED ALWAYS AS IDENTITY (sequence name "file_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('file_events', 'seq'), coalesce(max("seq"), 0) + 1, false) FROM "file_events";--> statement-breakpoint
CREATE INDEX "file_events_drive_seq_idx" ON "file_events" USING btree ("drive_id","seq");
