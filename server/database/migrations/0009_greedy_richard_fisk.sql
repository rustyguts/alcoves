ALTER TABLE "files" ADD COLUMN "duration" integer;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "proxy_status" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "source_file_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_source_file_id_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;