CREATE TABLE "monthly_member_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"member_id" text NOT NULL,
	"court_id" text NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monthly_members" ALTER COLUMN "court_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "monthly_members" ALTER COLUMN "weekday" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "monthly_members" ALTER COLUMN "start_time" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "monthly_members" ALTER COLUMN "duration_minutes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "monthly_members" ADD COLUMN "due_day" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "monthly_members" ADD COLUMN "auto_charge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "monthly_member_slots" ADD CONSTRAINT "monthly_member_slots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_member_slots" ADD CONSTRAINT "monthly_member_slots_member_id_monthly_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."monthly_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_member_slots" ADD CONSTRAINT "monthly_member_slots_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monthly_slots_member_idx" ON "monthly_member_slots" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "monthly_slots_company_weekday_idx" ON "monthly_member_slots" USING btree ("company_id","weekday");--> statement-breakpoint
-- Planos existentes: o horário único vira o primeiro horário do plano (vencimento continua no dia 5, cobrança automática desligada).
INSERT INTO "monthly_member_slots" ("id", "company_id", "member_id", "court_id", "weekday", "start_time", "duration_minutes", "created_at")
SELECT 'slot-' || "id", "company_id", "id", "court_id", "weekday", "start_time", "duration_minutes", "created_at" FROM "monthly_members"
WHERE "court_id" IS NOT NULL AND "weekday" IS NOT NULL AND "start_time" IS NOT NULL AND "duration_minutes" IS NOT NULL;
