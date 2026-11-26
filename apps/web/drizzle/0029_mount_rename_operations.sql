CREATE TABLE "mount_rename_operations" (
	"drive_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"result_file_id" uuid NOT NULL,
	"result_path" text NOT NULL,
	"result_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mount_rename_operations_pk" PRIMARY KEY("drive_id","operation_id"),
	CONSTRAINT "mount_rename_operations_fingerprint_check" CHECK ("mount_rename_operations"."request_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "mount_rename_operations" ADD CONSTRAINT "mount_rename_operations_drive_id_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."drives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mount_rename_operations" ADD CONSTRAINT "mount_rename_operations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mount_rename_operations" ADD CONSTRAINT "mount_rename_operations_result_file_id_files_id_fk" FOREIGN KEY ("result_file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mount_rename_operations" ADD CONSTRAINT "mount_rename_operations_result_version_id_versions_id_fk" FOREIGN KEY ("result_version_id") REFERENCES "public"."versions"("id") ON DELETE cascade ON UPDATE no action;