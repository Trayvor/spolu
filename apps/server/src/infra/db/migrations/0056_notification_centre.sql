CREATE TABLE "notification_centre_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"read_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "notification_events_undelivered_idx";--> statement-breakpoint
ALTER TABLE "notification_events" ADD COLUMN "in_centre" boolean;--> statement-breakpoint
ALTER TABLE "notification_centre_state" ADD CONSTRAINT "notification_centre_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_events_held_idx" ON "notification_events" USING btree ("created_at") WHERE "notification_events"."delivered_at" is null and "notification_events"."in_centre";--> statement-breakpoint
CREATE INDEX "notification_events_centre_idx" ON "notification_events" USING btree ("user_id","created_at","id") WHERE "notification_events"."in_centre";--> statement-breakpoint
CREATE INDEX "notification_events_undelivered_idx" ON "notification_events" USING btree ("created_at") WHERE "notification_events"."delivered_at" is null and "notification_events"."in_centre" is null;