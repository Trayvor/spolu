CREATE TABLE "ticket_ratings" (
	"ticket_id" text NOT NULL,
	"user_id" text NOT NULL,
	"value" text NOT NULL,
	"comment" text,
	"down_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_ratings_ticket_id_user_id_pk" PRIMARY KEY("ticket_id","user_id"),
	CONSTRAINT "ticket_ratings_value_check" CHECK ("ticket_ratings"."value" in ('up', 'down')),
	CONSTRAINT "ticket_ratings_comment_check" CHECK ("ticket_ratings"."comment" is null or char_length("ticket_ratings"."comment") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "ticket_ratings" ADD CONSTRAINT "ticket_ratings_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_ratings" ADD CONSTRAINT "ticket_ratings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_ratings_updated_idx" ON "ticket_ratings" USING btree ("updated_at" DESC NULLS LAST,"ticket_id" DESC NULLS LAST,"user_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ticket_ratings_updated_value_idx" ON "ticket_ratings" USING btree ("updated_at","value");--> statement-breakpoint
CREATE INDEX "ticket_ratings_user_idx" ON "ticket_ratings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tickets_resolved_at_idx" ON "tickets" USING btree ("resolved_at" DESC NULLS LAST) WHERE "tickets"."status" = 'resolved';