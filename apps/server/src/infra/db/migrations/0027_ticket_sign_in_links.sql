CREATE TABLE "ticket_sign_in_links" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "ticket_sign_in_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "ticket_sign_in_links" ADD CONSTRAINT "ticket_sign_in_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_sign_in_links" ADD CONSTRAINT "ticket_sign_in_links_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_sign_in_links_user_id_idx" ON "ticket_sign_in_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ticket_sign_in_links_ticket_id_idx" ON "ticket_sign_in_links" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_sign_in_links_expires_at_idx" ON "ticket_sign_in_links" USING btree ("expires_at");