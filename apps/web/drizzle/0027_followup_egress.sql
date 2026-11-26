CREATE TABLE "billing_egress_attributions" (
	"object_key_hash" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_log_ingest_leases" (
	"source_hash" text PRIMARY KEY NOT NULL,
	"owner_token" uuid,
	"lease_until" timestamp with time zone,
	CONSTRAINT "billing_log_ingest_lease_pair_check" CHECK (("billing_log_ingest_leases"."owner_token" IS NULL AND "billing_log_ingest_leases"."lease_until" IS NULL) OR ("billing_log_ingest_leases"."owner_token" IS NOT NULL AND "billing_log_ingest_leases"."lease_until" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "billing_log_object_progress" (
	"source_hash" text NOT NULL,
	"object_key" text NOT NULL,
	"etag" text NOT NULL,
	"byte_offset" bigint NOT NULL,
	"discarding_line" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_log_object_progress_pk" PRIMARY KEY("source_hash","object_key","etag"),
	CONSTRAINT "billing_log_object_progress_offset_nonnegative" CHECK ("billing_log_object_progress"."byte_offset" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_log_processed_objects" (
	"source_hash" text NOT NULL,
	"object_key" text NOT NULL,
	"etag" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_log_processed_objects_pk" PRIMARY KEY("source_hash","object_key","etag")
);
--> statement-breakpoint
CREATE TABLE "billing_log_scan_state" (
	"source_hash" text NOT NULL,
	"cursor_kind" text NOT NULL,
	"last_key" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_log_scan_state_pk" PRIMARY KEY("source_hash","cursor_kind"),
	CONSTRAINT "billing_log_scan_cursor_kind_check" CHECK ("billing_log_scan_state"."cursor_kind" IN ('tail', 'forward', 'sweep'))
);
--> statement-breakpoint
CREATE TABLE "billing_reconciliation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"meter_report_id" uuid,
	"checkout_idempotency_key" text,
	"action" text NOT NULL,
	"operator_id" text NOT NULL,
	"external_reference" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_reconciliation_target_check" CHECK (("billing_reconciliation_events"."meter_report_id" IS NOT NULL AND "billing_reconciliation_events"."checkout_idempotency_key" IS NULL) OR ("billing_reconciliation_events"."meter_report_id" IS NULL AND "billing_reconciliation_events"."checkout_idempotency_key" IS NOT NULL)),
	CONSTRAINT "billing_reconciliation_action_target_check" CHECK (("billing_reconciliation_events"."action" IN ('meter_operator_confirmed_accepted', 'meter_report_replayed') AND "billing_reconciliation_events"."meter_report_id" IS NOT NULL) OR ("billing_reconciliation_events"."action" = 'checkout_session_recovered' AND "billing_reconciliation_events"."checkout_idempotency_key" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "billing_egress_attributions" ADD CONSTRAINT "billing_egress_attributions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_egress_attributions" ADD CONSTRAINT "billing_egress_attributions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_reconciliation_events" ADD CONSTRAINT "billing_reconciliation_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_reconciliation_events" ADD CONSTRAINT "billing_reconciliation_events_meter_report_id_billing_meter_reports_id_fk" FOREIGN KEY ("meter_report_id") REFERENCES "public"."billing_meter_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_egress_attributions_account_id_idx" ON "billing_egress_attributions" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_reconciliation_events_external_reference_unique" ON "billing_reconciliation_events" USING btree ("external_reference");