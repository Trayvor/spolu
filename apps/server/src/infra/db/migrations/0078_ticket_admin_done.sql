ALTER TABLE "tickets" ADD COLUMN "admin_done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "admin_done_by" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "admin_done_cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_admin_done_by_user_id_fk" FOREIGN KEY ("admin_done_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_admin_done_idx" ON "tickets" USING btree ("admin_done_at") WHERE "tickets"."admin_done_at" is not null;