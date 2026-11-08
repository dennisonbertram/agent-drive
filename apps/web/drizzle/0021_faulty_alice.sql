CREATE SEQUENCE "public"."account_key_slot_revision_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "account_key_slots" (
	"drive_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"account_key_id" uuid NOT NULL,
	"format" smallint NOT NULL,
	"sealed" jsonb NOT NULL,
	"revision" bigint DEFAULT nextval('account_key_slot_revision_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_key_slots_format_check" CHECK ("account_key_slots"."format" = 1),
	CONSTRAINT "account_key_slots_revision_check" CHECK ("account_key_slots"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "account_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"format" smallint NOT NULL,
	"public_key" text NOT NULL,
	"wrapped_private_key" text NOT NULL,
	"wrap_generation" integer DEFAULT 1 NOT NULL,
	"kdf_name" text NOT NULL,
	"kdf_iterations" integer NOT NULL,
	"kdf_salt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_keys_account_id_unique" UNIQUE("account_id"),
	CONSTRAINT "account_keys_id_account_id_unique" UNIQUE("id","account_id"),
	CONSTRAINT "account_keys_format_check" CHECK ("account_keys"."format" = 1),
	CONSTRAINT "account_keys_wrap_generation_check" CHECK ("account_keys"."wrap_generation" >= 1),
	CONSTRAINT "account_keys_kdf_name_check" CHECK ("account_keys"."kdf_name" = 'PBKDF2-SHA256'),
	CONSTRAINT "account_keys_kdf_iterations_check" CHECK ("account_keys"."kdf_iterations" BETWEEN 600000 AND 2000000)
);
--> statement-breakpoint
ALTER TABLE "account_key_slots" ADD CONSTRAINT "account_key_slots_drive_account_fk" FOREIGN KEY ("drive_id","account_id") REFERENCES "public"."drives"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_key_slots" ADD CONSTRAINT "account_key_slots_key_account_fk" FOREIGN KEY ("account_key_id","account_id") REFERENCES "public"."account_keys"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_keys" ADD CONSTRAINT "account_keys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_key_slots_account_key_idx" ON "account_key_slots" USING btree ("account_key_id");