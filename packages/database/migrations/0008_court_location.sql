ALTER TABLE "courts" ADD COLUMN "location_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "courts" ADD COLUMN "location_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "courts" ADD COLUMN "location_maps_url" text DEFAULT '' NOT NULL;