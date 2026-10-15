CREATE TABLE "thread_read_states" (
	"user_id" text NOT NULL,
	"root_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"last_read_at" timestamp (3) with time zone NOT NULL,
	"last_reply_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "thread_read_states_root_id_user_id_pk" PRIMARY KEY("root_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "thread_read_states" ADD CONSTRAINT "thread_read_states_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_read_states" ADD CONSTRAINT "thread_read_states_root_id_messages_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_read_states" ADD CONSTRAINT "thread_read_states_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thread_read_states_unread_idx" ON "thread_read_states" USING btree ("user_id","channel_id") WHERE "thread_read_states"."last_reply_at" > "thread_read_states"."last_read_at";--> statement-breakpoint
-- The people of every existing thread (root author and repliers) start with the thread read
-- up to now: replies sent before this release were never counted as unread.
INSERT INTO "thread_read_states" ("user_id", "root_id", "channel_id", "last_read_at", "last_reply_at")
SELECT "author_id", "id", "channel_id", now(), now() FROM "messages"
WHERE "parent_id" IS NULL AND "reply_count" > 0
UNION
SELECT "author_id", "parent_id", "channel_id", now(), now() FROM "messages"
WHERE "parent_id" IS NOT NULL;
