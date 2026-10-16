ALTER TABLE "user" ADD COLUMN "notification_channels" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "push_enabled";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "email_enabled";