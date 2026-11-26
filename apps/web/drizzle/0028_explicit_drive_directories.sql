CREATE TABLE "drive_directories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drive_id" uuid NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drive_directories_canonical_path_check" CHECK (char_length("drive_directories"."path") BETWEEN 2 AND 1024
        AND "drive_directories"."path" LIKE '/%'
        AND right("drive_directories"."path", 1) <> '/'
        AND position('//' IN "drive_directories"."path") = 0
        AND position(chr(92) IN "drive_directories"."path") = 0
        AND "drive_directories"."path" !~ '(^|/)([.]|[.][.])(/|$)')
);
--> statement-breakpoint
ALTER TABLE "drive_directories" ADD CONSTRAINT "drive_directories_drive_id_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."drives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_directories_drive_path_unique" ON "drive_directories" USING btree ("drive_id","path");--> statement-breakpoint
CREATE INDEX "drive_directories_drive_path_prefix_idx" ON "drive_directories" USING btree ("drive_id","path" text_pattern_ops);