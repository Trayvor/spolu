ALTER TABLE "bulk_campaigns" ADD COLUMN "phone_blocks" jsonb;--> statement-breakpoint
ALTER TABLE "bulk_campaigns" ADD COLUMN "content_version" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "bulk_campaigns" ADD COLUMN "phone_check_shown_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bulk_campaigns" ADD CONSTRAINT "bulk_campaigns_content_version_check" CHECK ("bulk_campaigns"."content_version" in (1, 2));