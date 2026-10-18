-- Phase 34 P34-C: knowledge of the admin group "eGrant tím" is "Only eGrant" (admins) unless an
-- admin marks it "Shareable with clients" (public) on purpose. Items written there before this
-- rule (as public, the old default) must not become shareable without that conscious switch, so
-- every one of them starts "Only eGrant"; their attached files follow, as a visibility change
-- does. Data only; nothing in a client group changes.
UPDATE "files" SET "admins_only" = true
WHERE "id" IN (
  SELECT a."file_id" FROM "knowledge_attachments" a
  JOIN "knowledge_items" k ON k."id" = a."item_id"
  JOIN "groups" g ON g."id" = k."group_id"
  WHERE g."kind" = 'admin' AND k."visibility" = 'public'
);--> statement-breakpoint
UPDATE "knowledge_items" SET "visibility" = 'admins'
WHERE "visibility" = 'public'
  AND "group_id" IN (SELECT "id" FROM "groups" WHERE "kind" = 'admin');
