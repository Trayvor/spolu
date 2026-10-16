ALTER TABLE "bulk_recipients" DROP CONSTRAINT "bulk_recipients_language_check";--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "user_language_check";--> statement-breakpoint
ALTER TABLE "bulk_recipients" ADD CONSTRAINT "bulk_recipients_language_check" CHECK ("bulk_recipients"."language" in ('sk', 'en', 'cs', 'sl', 'bg', 'et', 'it', 'hr', 'uk'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_language_check" CHECK ("user"."language" in ('sk', 'en', 'cs', 'sl', 'bg', 'et', 'it', 'hr', 'uk'));