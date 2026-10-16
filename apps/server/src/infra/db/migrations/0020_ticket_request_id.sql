ALTER TABLE "tickets" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_request_id_unique" UNIQUE("request_id");