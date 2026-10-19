# Audit log: an erasure request

The audit log „História zmien“ (`audit_log`, [spec](../superpowers/specs/2026-10-19-audit-log-design.md) §9) keeps the names of the people who changed records, and of the people a membership or admin row is about, for 730 days. Users are never deleted in Help (they are deactivated), so a deactivated person's name stays in the log until the retention job removes it. When a person asks for erasure (GDPR Art. 17) and the request is accepted, replace their name in the log once, as below.

What it changes: `actor_label` of every row the person made (shown as „Vymazaný používateľ“) and `entity_label` of their own `admin`, `membership` and `manager` rows. Nothing else: who did what and when stays, the ids stay (they are random and say nothing alone). It is the one UPDATE the append-only trigger `audit_log_append_only` allows, and only inside a transaction that sets `spolu.audit_anonymize`; it is the same SQL as `anonymizeActor` in `apps/server/src/modules/audit/retention.ts`.

## Steps

1. Find the person's user id (Admins page, or `select id, name, email from "user" where email = '<email>';`).
2. On the server, from the `deploy/` directory, run (replace `<user-id>`):

   ```bash
   docker compose exec -T postgres psql -U spolu -d spolu -v ON_ERROR_STOP=1 <<'SQL'
   begin;
   set local spolu.audit_anonymize = 'on';
   update audit_log set actor_label = 'Vymazaný používateľ' where actor_user_id = '<user-id>';
   update audit_log set entity_label = 'Vymazaný používateľ'
     where (entity_type = 'admin' and entity_id = '<user-id>')
        or (entity_type in ('membership', 'manager') and entity_id like '%:<user-id>');
   commit;
   SQL
   ```

   Each `update` prints how many rows it changed.
3. Note the date and the counts in the erasure request.

Backups keep the old labels for their own retention (`BACKUP_KEEP` nights, [backup.md](backup.md)); a restore from an older dump needs the steps again.
