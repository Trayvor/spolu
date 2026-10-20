CREATE TABLE "ticket_area_rules" (
	"group_id" text NOT NULL,
	"area_key" text NOT NULL,
	"area" text NOT NULL,
	"user_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ticket_area_rules_group_id_area_key_user_id_pk" PRIMARY KEY("group_id","area_key","user_id"),
	CONSTRAINT "ticket_area_rules_area_check" CHECK (char_length("ticket_area_rules"."area") between 1 and 200 and char_length("ticket_area_rules"."area_key") between 1 and 400)
);
--> statement-breakpoint
ALTER TABLE "ticket_area_rules" ADD CONSTRAINT "ticket_area_rules_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_area_rules" ADD CONSTRAINT "ticket_area_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_area_rules_user_idx" ON "ticket_area_rules" USING btree ("user_id");