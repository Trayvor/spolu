CREATE TABLE "saved_views" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"page" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_views_page_check" CHECK ("saved_views"."page" in ('board', 'tickets', 'knowledge'))
);
--> statement-breakpoint
CREATE TABLE "reply_snippets" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_snippets" ADD CONSTRAINT "reply_snippets_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_views_user_page_idx" ON "saved_views" USING btree ("user_id","page","created_at");--> statement-breakpoint
CREATE INDEX "reply_snippets_author_id_idx" ON "reply_snippets" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "reply_snippets_shared_idx" ON "reply_snippets" USING btree ("id") WHERE "reply_snippets"."shared";