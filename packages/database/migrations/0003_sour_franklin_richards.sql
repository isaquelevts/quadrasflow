CREATE TABLE "whatsapp_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"booking_id" text,
	"kind" text NOT NULL,
	"destination" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"due_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"error" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "courts" ADD COLUMN "photos" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_deliveries" ADD CONSTRAINT "whatsapp_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_deliveries" ADD CONSTRAINT "whatsapp_deliveries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_deliveries_due_idx" ON "whatsapp_deliveries" USING btree ("status","due_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION queue_whatsapp_booking_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cfg jsonb; event_name text; b bookings%ROWTYPE; stamp text; target text;
BEGIN
 IF TG_TABLE_NAME = 'finance_entries' THEN
  IF NEW.booking_id IS NULL OR NEW.paid_at IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.paid_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO b FROM bookings WHERE id=NEW.booking_id AND company_id=NEW.company_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  event_name := 'paid';
 ELSE
  b := NEW;
  IF TG_OP='UPDATE' AND OLD.status=NEW.status THEN RETURN NEW; END IF;
  event_name := CASE WHEN NEW.status='cancelled' AND NEW.cancel_reason LIKE 'pix-expired:%' THEN 'expired' ELSE NEW.status END;
 END IF;
 SELECT settings INTO cfg FROM integration_settings WHERE company_id=b.company_id AND provider='whatsapp_services';
 IF cfg IS NULL OR COALESCE((cfg->>'groupEnabled')::boolean,false)=false OR NOT (cfg->'events' ? event_name) THEN RETURN NEW; END IF;
 target := cfg->>'groupId'; IF target IS NULL OR target !~ '^[0-9]+(-[0-9]+)?@g.us$' THEN RETURN NEW; END IF;
 stamp := to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 INSERT INTO whatsapp_deliveries(id,company_id,booking_id,kind,destination,payload,status,attempts,due_at,created_at,updated_at,error)
 VALUES(gen_random_uuid()::text,b.company_id,b.id,event_name,target,jsonb_build_object('customerName',b.customer_name,'phone',b.customer_phone,'start',b.start_at,'end',b.end_at,'court',(SELECT name FROM courts WHERE id=b.court_id),'arena',(SELECT name FROM companies WHERE id=b.company_id),'bookingStatus',b.status),'pending',0,stamp,stamp,stamp,'');
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER whatsapp_booking_event AFTER INSERT OR UPDATE OF status ON bookings FOR EACH ROW EXECUTE FUNCTION queue_whatsapp_booking_event();
--> statement-breakpoint
CREATE TRIGGER whatsapp_payment_event AFTER INSERT OR UPDATE OF paid_at ON finance_entries FOR EACH ROW EXECUTE FUNCTION queue_whatsapp_booking_event();
--> statement-breakpoint
UPDATE courts SET photos=jsonb_build_array(photo_url) WHERE photo_url LIKE '/api/arena/media/%' AND photos='[]'::jsonb;
