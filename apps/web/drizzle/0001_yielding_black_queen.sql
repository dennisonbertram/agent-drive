CREATE TABLE "file_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drive_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"path" text NOT NULL,
	"previous_path" text,
	"version_id" uuid,
	"agent_id" uuid NOT NULL,
	"machine_id" uuid,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_events_operation_check" CHECK ("file_events"."operation" IN ('put', 'copy', 'restore', 'move', 'delete'))
);
--> statement-breakpoint
ALTER TABLE "file_events" ADD CONSTRAINT "file_events_drive_id_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."drives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_events" ADD CONSTRAINT "file_events_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_events" ADD CONSTRAINT "file_events_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_events" ADD CONSTRAINT "file_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_events" ADD CONSTRAINT "file_events_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_events_drive_created_idx" ON "file_events" USING btree ("drive_id","created_at","id");