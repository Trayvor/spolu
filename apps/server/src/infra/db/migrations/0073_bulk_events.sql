CREATE TABLE "bulk_events" (
	"provider_event_key" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bulk_events_kind_check" CHECK ("bulk_events"."kind" in ('delivered', 'opened', 'clicked', 'bounced', 'complaint', 'unsubscribed'))
);
--> statement-breakpoint
ALTER TABLE "bulk_recipients" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bulk_recipients" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bulk_recipients" ADD COLUMN "clicked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bulk_recipients" ADD COLUMN "bounced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bulk_recipients" ADD COLUMN "complained_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bulk_events" ADD CONSTRAINT "bulk_events_recipient_fk" FOREIGN KEY ("campaign_id","user_id") REFERENCES "public"."bulk_recipients"("campaign_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_events_recipient_idx" ON "bulk_events" USING btree ("campaign_id","user_id");