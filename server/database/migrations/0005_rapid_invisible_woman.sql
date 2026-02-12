DROP INDEX "folders_library_parent_name_idx";--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "trashed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "folders_library_trash_parent_name_idx" ON "folders" USING btree ("library_id","trashed_at","parent_folder_id","name");