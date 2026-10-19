DROP INDEX "notification_events_centre_idx";--> statement-breakpoint
ALTER TABLE "notification_events" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "notification_events_centre_idx" ON "notification_events" USING btree ("user_id","created_at","id","read_at") WHERE "notification_events"."in_centre";