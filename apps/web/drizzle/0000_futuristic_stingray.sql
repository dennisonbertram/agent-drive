CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"external_clerk_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"drive_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"scopes" text[] NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_scopes_check" CHECK ("api_keys"."scopes" <@ ARRAY['read', 'write', 'delete', 'share', 'manage']::text[])
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid,
	"account_id" uuid,
	"agent_id" uuid,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"error_code" text,
	"http_status" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_outcome_check" CHECK ("audit_events"."outcome" IN ('success', 'failure'))
);
--> statement-breakpoint
CREATE TABLE "drives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"quota_bytes" bigint DEFAULT 5368709120 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drives_quota_bytes_positive" CHECK ("drives"."quota_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drive_id" uuid NOT NULL,
	"path" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"machine_id" uuid,
	"drive_id" uuid NOT NULL,
	"path" text NOT NULL,
	"staging_key" text NOT NULL,
	"ciphertext_size" bigint NOT NULL,
	"wrapped_key" text NOT NULL,
	"conditional_mode" text NOT NULL,
	"base_version_id" uuid,
	"user_id" text,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"description" text,
	"expires_at" timestamp with time zone NOT NULL,
	"committed_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_intents_conditional_mode_check" CHECK ("upload_intents"."conditional_mode" IN ('unconditional', 'create', 'version')),
	CONSTRAINT "upload_intents_ciphertext_size_positive" CHECK ("upload_intents"."ciphertext_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"drive_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"ciphertext_size" bigint NOT NULL,
	"wrapped_key" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"machine_id" uuid,
	"user_id" text,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "versions_ciphertext_size_positive" CHECK ("versions"."ciphertext_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drives" ADD CONSTRAINT "drives_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_drive_id_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."drives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_drive_id_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."drives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_committed_version_id_versions_id_fk" FOREIGN KEY ("committed_version_id") REFERENCES "public"."versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_drive_id_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."drives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_external_clerk_user_id_unique" ON "accounts" USING btree ("external_clerk_user_id") WHERE "accounts"."external_clerk_user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_account_name_unique" ON "agents" USING btree ("account_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_id_account_id_unique" ON "agents" USING btree ("id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_token_hash_unique" ON "api_keys" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_keys_account_idx" ON "api_keys" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "audit_events_account_created_idx" ON "audit_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "drives_account_name_unique" ON "drives" USING btree ("account_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "drives_id_account_id_unique" ON "drives" USING btree ("id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "files_drive_path_unique" ON "files" USING btree ("drive_id","path");--> statement-breakpoint
CREATE INDEX "files_drive_deleted_path_idx" ON "files" USING btree ("drive_id","deleted_at","path");--> statement-breakpoint
CREATE UNIQUE INDEX "machines_account_agent_name_unique" ON "machines" USING btree ("account_id","agent_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "machines_id_account_agent_unique" ON "machines" USING btree ("id","account_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_intents_staging_key_unique" ON "upload_intents" USING btree ("staging_key");--> statement-breakpoint
CREATE INDEX "upload_intents_drive_created_idx" ON "upload_intents" USING btree ("drive_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "versions_object_key_unique" ON "versions" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "versions_drive_created_idx" ON "versions" USING btree ("drive_id","created_at","id");--> statement-breakpoint
CREATE INDEX "versions_file_created_idx" ON "versions" USING btree ("file_id","created_at","id");--> statement-breakpoint
CREATE INDEX "versions_agent_idx" ON "versions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "versions_machine_idx" ON "versions" USING btree ("machine_id");