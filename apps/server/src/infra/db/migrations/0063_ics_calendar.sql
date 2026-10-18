CREATE TABLE "calendar_feeds" (
	"user_id" text PRIMARY KEY NOT NULL,
	"nonce" text NOT NULL,
	"token_hash" text NOT NULL,
	"include_events" boolean DEFAULT true NOT NULL,
	"include_tasks" boolean DEFAULT true NOT NULL,
	"include_calls" boolean DEFAULT true NOT NULL,
	"last_fetched_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_feeds_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;