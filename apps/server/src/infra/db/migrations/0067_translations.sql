CREATE TABLE "ai_translations" (
	"message_id" text,
	"ticket_id" text,
	"language" text NOT NULL,
	"source_hash" text NOT NULL,
	"source_language" text,
	"text" text NOT NULL,
	"unchanged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_translations_subject_check" CHECK (("ai_translations"."message_id" is null) <> ("ai_translations"."ticket_id" is null)),
	CONSTRAINT "ai_translations_language_check" CHECK ("ai_translations"."language" in ('sk', 'en', 'cs', 'sl', 'bg', 'et', 'it', 'hr', 'uk'))
);
--> statement-breakpoint
ALTER TABLE "ai_translations" ADD CONSTRAINT "ai_translations_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_translations" ADD CONSTRAINT "ai_translations_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_translations_message_unique" ON "ai_translations" USING btree ("message_id","language") WHERE "ai_translations"."message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_translations_ticket_unique" ON "ai_translations" USING btree ("ticket_id","language") WHERE "ai_translations"."ticket_id" is not null;