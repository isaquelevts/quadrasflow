CREATE TABLE "monthly_exceptions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"member_id" text NOT NULL,
	"slot_id" text NOT NULL,
	"day" text NOT NULL,
	"kind" text NOT NULL,
	"new_court_id" text,
	"new_day" text,
	"new_start_time" text,
	"new_duration_minutes" integer,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monthly_exceptions" ADD CONSTRAINT "monthly_exceptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_exceptions" ADD CONSTRAINT "monthly_exceptions_member_id_monthly_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."monthly_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_exceptions" ADD CONSTRAINT "monthly_exceptions_slot_id_monthly_member_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."monthly_member_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_exceptions" ADD CONSTRAINT "monthly_exceptions_new_court_id_courts_id_fk" FOREIGN KEY ("new_court_id") REFERENCES "public"."courts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_exception_slot_day_idx" ON "monthly_exceptions" USING btree ("slot_id","day");--> statement-breakpoint
CREATE INDEX "monthly_exceptions_company_idx" ON "monthly_exceptions" USING btree ("company_id","day");--> statement-breakpoint
CREATE INDEX "monthly_exceptions_new_day_idx" ON "monthly_exceptions" USING btree ("company_id","new_day");