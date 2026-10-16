ALTER TABLE "user" ADD COLUMN "notification_channels" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Everyone starts on the group defaults, except users whose email came from the Phase 6 iOS
-- fallback (a phone that cannot get push) and is still on: the fallback never runs again, so keep
-- their email in every group (tickets is email and push by default already).
UPDATE "user" SET "notification_channels" = '{"chat": "both", "tasks": "both", "knowledge": "both"}'::jsonb WHERE "email_fallback_at" IS NOT NULL AND "email_enabled";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "push_enabled";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "email_enabled";
