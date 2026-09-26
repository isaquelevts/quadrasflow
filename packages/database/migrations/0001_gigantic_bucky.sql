ALTER TABLE "users" DROP CONSTRAINT "users_email_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "finance_booking_once_idx" ON "finance_entries" USING btree ("booking_id") WHERE "finance_entries"."booking_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_monthly_charge_once_idx" ON "finance_entries" USING btree ("monthly_charge_id") WHERE "finance_entries"."monthly_charge_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_tournament_entry_once_idx" ON "finance_entries" USING btree ("tournament_entry_id") WHERE "finance_entries"."tournament_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "review_links_booking_once_idx" ON "review_links" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_booking_once_idx" ON "reviews" USING btree ("booking_id") WHERE "reviews"."booking_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));