CREATE TABLE "announcement_seen" (
	"user_id" text NOT NULL,
	"announcement_id" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_seen_user_id_announcement_id_pk" PRIMARY KEY("user_id","announcement_id")
);
--> statement-breakpoint
ALTER TABLE "announcement_seen" ADD CONSTRAINT "announcement_seen_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;