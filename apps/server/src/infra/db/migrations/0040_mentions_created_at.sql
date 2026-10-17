-- A mention carries its message's time, so the home's mentions read one user's last 90 days only.
DROP INDEX "message_mentions_user_message_idx";--> statement-breakpoint
ALTER TABLE "message_mentions" ADD COLUMN "created_at" timestamp (3) with time zone;--> statement-breakpoint
UPDATE "message_mentions" mm SET "created_at" = m."created_at" FROM "messages" m WHERE m."id" = mm."message_id";--> statement-breakpoint
ALTER TABLE "message_mentions" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "message_mentions_user_created_idx" ON "message_mentions" USING btree ("user_id","created_at" DESC NULLS LAST);
