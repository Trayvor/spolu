-- Search in chat messages (2026-10-19, ADR 0057). The generated column uses spolu_fold, created
-- by 0062_night_integration; adding it rewrites messages once (seconds at today's size).
ALTER TABLE "messages" ADD COLUMN "search_text" text GENERATED ALWAYS AS (spolu_fold(regexp_replace("body", '<@[A-Za-z0-9_-]+>', ' ', 'g'))) STORED;--> statement-breakpoint
CREATE INDEX "messages_search_text_trgm_idx" ON "messages" USING gin ("search_text" gin_trgm_ops) WHERE "messages"."deleted_at" is null and "messages"."search_text" <> '';
