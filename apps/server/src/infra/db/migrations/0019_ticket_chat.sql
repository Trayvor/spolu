ALTER TABLE "channels" DROP CONSTRAINT "channels_kind_check";--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "ticket_id" text;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channels_ticket_unique" ON "channels" USING btree ("ticket_id") WHERE "channels"."ticket_id" is not null;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_ticket_check" CHECK (("channels"."kind" = 'ticket') = ("channels"."ticket_id" is not null));--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_kind_check" CHECK ("channels"."kind" in ('group', 'task', 'ticket'));