CREATE TABLE "device_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_authorization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"api_key_id" uuid NOT NULL,
	"offered_by_agent_id" uuid NOT NULL,
	"drive_id" uuid NOT NULL,
	"scopes" text[] NOT NULL,
	"write_paths" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"sealed_key" jsonb NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_authorizations" ADD COLUMN "approved_offer_id" uuid;--> statement-breakpoint
ALTER TABLE "device_authorizations" ADD COLUMN "approved_from_offer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "device_offers" ADD CONSTRAINT "device_offers_device_authorization_id_device_authorizations_id_fk" FOREIGN KEY ("device_authorization_id") REFERENCES "public"."device_authorizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_offers" ADD CONSTRAINT "device_offers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_offers" ADD CONSTRAINT "device_offers_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_offers" ADD CONSTRAINT "device_offers_offered_by_agent_id_agents_id_fk" FOREIGN KEY ("offered_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_offers" ADD CONSTRAINT "device_offers_drive_id_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."drives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_offers_request_account_unique" ON "device_offers" USING btree ("device_authorization_id","account_id");--> statement-breakpoint
ALTER TABLE "device_authorizations" ADD CONSTRAINT "device_authorizations_approved_offer_id_device_offers_id_fk" FOREIGN KEY ("approved_offer_id") REFERENCES "public"."device_offers"("id") ON DELETE set null ON UPDATE no action;