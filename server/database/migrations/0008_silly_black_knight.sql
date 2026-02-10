CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "face_detections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"library_id" uuid NOT NULL,
	"person_id" uuid,
	"box_x" integer NOT NULL,
	"box_y" integer NOT NULL,
	"box_width" integer NOT NULL,
	"box_height" integer NOT NULL,
	"image_width" integer NOT NULL,
	"image_height" integer NOT NULL,
	"confidence" integer NOT NULL,
	"embedding" vector(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_id" uuid NOT NULL,
	"name" text,
	"cover_face_detection_id" uuid,
	"face_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "libraries" ADD COLUMN "face_recognition_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "face_detections" ADD CONSTRAINT "face_detections_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_detections" ADD CONSTRAINT "face_detections_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_detections" ADD CONSTRAINT "face_detections_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "face_detections_file_id_idx" ON "face_detections" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "face_detections_library_id_idx" ON "face_detections" USING btree ("library_id");--> statement-breakpoint
CREATE INDEX "face_detections_person_id_idx" ON "face_detections" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "people_library_id_idx" ON "people" USING btree ("library_id");--> statement-breakpoint
CREATE INDEX "people_library_name_idx" ON "people" USING btree ("library_id","name");--> statement-breakpoint
CREATE INDEX "face_detections_embedding_idx" ON "face_detections" USING hnsw ("embedding" vector_cosine_ops);