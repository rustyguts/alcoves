CREATE TABLE "library_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_id" uuid NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"invited_email" text,
	"role" text DEFAULT 'viewer' NOT NULL,
	"token" text NOT NULL,
	"accepted_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "library_invites" ADD CONSTRAINT "library_invites_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_invites" ADD CONSTRAINT "library_invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_invites" ADD CONSTRAINT "library_invites_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_invites_library_idx" ON "library_invites" USING btree ("library_id");--> statement-breakpoint
CREATE INDEX "library_invites_email_idx" ON "library_invites" USING btree ("invited_email");--> statement-breakpoint
CREATE INDEX "library_invites_inviter_idx" ON "library_invites" USING btree ("invited_by_user_id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_owner_id_idx" ON "files" USING btree ("owner_id");
