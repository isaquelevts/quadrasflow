CREATE TABLE "user_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"accepted_at" text,
	"revoked_at" text,
	"created_by" text,
	"created_at" text NOT NULL,
	CONSTRAINT "user_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" text;--> statement-breakpoint
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_invites_company_idx" ON "user_invites" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "user_invites_email_idx" ON "user_invites" USING btree (lower("email"));