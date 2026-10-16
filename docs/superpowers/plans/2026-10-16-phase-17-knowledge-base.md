# Phase 17 — Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every group gets a Knowledge tab with note, file, link and reminder cards, admins get an admins-only visibility and a global list across clients, and reminder items notify their recipients through the Phase 6 pipeline and export to `.ics`.

**Architecture:**
- Two new server modules, `knowledge` and `reminders`, follow the usual module pattern (schema, policy, service, routes, events, jobs). `reminders` is generic. It knows its owners only through a subject adapter registry, so Phase 19 can add tasks.
- Reminder firing is a pg-boss cron every minute. It locks due times with `FOR UPDATE SKIP LOCKED` and records `reminder.due` events with `recordNotifications` and a `dedupeKey`, and the Phase 6 deliverer pushes them.
- On the web, the knowledge screens are two lazy route chunks (`/groups/$groupId/knowledge` and `/knowledge`) with their own lazy i18n namespaces. They reuse one `SheetDialog`, one `FormattedTextField`, one `FilesField` and one `PeopleSelect`, all moved out of the task code.

**Tech Stack:** Fastify 5, Drizzle + drizzle-kit, PostgreSQL 17 (`pg_trgm`), pg-boss 12, Socket.IO, React 19, TanStack Router and Query, radix-ui, i18next, zod, Vitest, Playwright. There are no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-16-phase-17-knowledge-base-design.md`, with the rulings in `docs/superpowers/specs/2026-10-16-phases-17-20-brief.md`. Where they conflict, the rulings win.

## Global Constraints

- Branch `phase-17`, cut from `main` after Phases 9 and 6 have merged and after the i18n namespace split task. It is built **in parallel with Phase 18**. The controller runs the tasks of one wave at the same time, on separate branches.
- **Rulings that override the spec:**
  - Explicit reminder recipients (the author, people the author added, and self-subscribers) get `reminder.due` **even when their group mode is Off**.
  - The managed-groups helper is Phase 18's `managedGroupIds(db, userId)`. Until Phase 18 merges, Phase 17 calls it through the seam `managedGroupIdsOf(db, adminId)`, which returns `null`.
  - A client's own item is always public.
- **One migration for the whole phase**, created in Task 1 and generated with `pnpm --filter @spolu/server db:generate --name knowledge_and_reminders`. It takes the next free number (`0011_…` when `main` ends at `0010`). No later task changes a `schema.ts`. Whichever of Phases 17 and 18 merges second regenerates its migration.
- English everywhere in code, comments, docs and commits. Every UI string is an i18n key with copy in **both** `en` and `sk`.
  - Knowledge strings live in `apps/web/src/features/knowledge/locales/{en,sk}.json` (namespace `knowledge`) and reminder strings in `apps/web/src/features/reminders/locales/{en,sk}.json` (namespace `reminders`).
  - The moved shared fields use `apps/web/src/components/locales/{en,sk}.json` (namespace `forms`).
  - Only `nav.knowledge` and `group.tabs.knowledge` go into the eager locale files.
  - Each task adds keys only inside its own top-level section of a namespace file. The skeleton is created in Task 1.
- Server copy for push and email goes in `modules/notifications/texts.ts`, in sk and en.
- **Performance first.** The eager JS budget is **200 kB gzip**, and this phase may add at most **0.5 kB gzip** to it.
  - The Knowledge tab (`knowledge-tab`) and the global list (`knowledge-page`) are lazy route chunks.
  - Dialogs, forms and reminder components live only in those chunks.
  - Each list is one SQL query per page (plus one bulk name lookup), cursor-paginated at 30 per page, with every filter indexed. There are no per-row queries.
- **Readable code and reuse.** Use one `SheetDialog` (720 px dialog / full-screen sheet), one `FormattedTextField`, one `FilesField` and one `PeopleSelect`. There is no second dialog frame, rich text field, upload field or people picker.
- **UI tasks start by invoking `frontend-design:frontend-design`**, on the egrant.sk tokens in `docs/design/tokens.md` and `components/ui/*`. No fancy effects.
- Phones: inside `SheetDialog`, every control is at least 44 px.
- **Test-first** (`superpowers:test-driven-development`). Every code step follows a failing test.
- **Tests share the databases** `spolu_test` and `spolu_e2e`.
  - Use unique emails (`${randomUUID()}@example.com`) and unique group URLs. Never truncate a table, and never assume one is empty.
  - The fire job takes an optional `setIds` scope, and tests always pass it.
- Modules talk only through exported service functions. Permissions are checked server-side, only through each module's policy functions. Writes go through HTTP, and sockets only push after the commit.
- Errors are `{ error: '<code>' }`. New codes: `invalid_url`, `invalid_visibility`, `knowledge_changed`, `invalid_reminder`, `reminder_in_past`, `invalid_recipient`, `author_recipient`.
- Rate limit: knowledge writes and reminder subscription writes share one limiter of **120 per minute per user**.
- **Docs ship in the same commit** as the code they describe (`update-kb` skill). Run Prettier on the changed files before each commit: `pnpm exec prettier --check <files>`.
- Every commit message ends with exactly this line:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- Test commands:
  - server: `pnpm --filter @spolu/server exec vitest run <path>`;
  - web: `pnpm --filter @spolu/web exec vitest run <path>`;
  - e2e: `pnpm test:e2e -- <spec>`;
  - everything: `bash scripts/ci.sh`.

## Review Focus

- **A reminder time fires while someone edits the item.** The form sends back the id of a time that has fired in the meantime, with its `at` unchanged. The save must succeed, the time stays fired, and nobody is notified again. Only a fired time whose `at` was changed is `invalid_reminder`. Test in Task 3: `replaceReminderSet accepts an unchanged fired time and keeps it fired`.
- **Items with the same `created_at`.** Items created in one transaction share `now()`, and a JS `Date` drops microseconds. Paging must never skip or repeat an item. Test in Task 5: `cursor pages never skip or repeat items with equal created_at`.
- **An admin turns a public reminder into an admins-only one.** A client who was added or had subscribed must stop being a recipient, get no push and no longer see it in their upcoming reminders. Tests:
  - Task 5: `switching to admins-only drops non-admin recipients`;
  - Task 6: `a non-admin recipient of an admins-only subject is skipped`.
- **A long title with multi-byte characters in the `.ics`.** Folding at 75 octets must never split a UTF-8 character, or Outlook shows garbage. Test in Task 3: `folding never splits a multi-byte character`.
- **A reminder around the DST change.** A reminder at 2026-10-25T09:00Z must read "10:00" in the push body (Bratislava is UTC+1 after the change), and its `.ics` `DTSTART` must stay `20261025T090000Z`. Tests:
  - Task 4: `reminder push body uses Bratislava time across the DST change`;
  - Task 3: `DTSTART is UTC`.

---

## Waves

| wave | tasks (run in parallel) |
|---|---|
| 1 | Task 1 (contracts, schema, migration), Task 2 (shared web fields and sheet) |
| 2 | Task 3 (reminders service and `.ics`), Task 4 (`reminder.due` kind), Task 8 (web API and rows), Task 9 (`KnowledgeForm` and reminder fields) |
| 3 | Task 5 (knowledge policy and service), Task 10 (detail dialog and `ReminderPanel`) |
| 4 | Task 6 (fire job), Task 7 (HTTP routes and realtime), Task 11 (Knowledge tab), Task 12 (global list and `ClientFilter`) |
| 5 | Task 13 (e2e, budget, roadmap) |

Web tasks 8–12 mock the HTTP layer, so they do not wait for the server routes.

---

### Task 1: Shared contracts, schema, migration and namespace skeleton

Depends on: none

**Files:**
- Create: `packages/shared/src/knowledge.ts`, `packages/shared/src/reminders.ts`, `packages/shared/src/knowledge.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/users.ts` (`ErrorCodes`), `packages/shared/src/notifications.ts` (`NotificationKinds`, payload type)
- Create: `apps/server/src/modules/knowledge/schema.ts`, `apps/server/src/modules/reminders/schema.ts`, `apps/server/src/modules/knowledge/schema.test.ts`
- Modify: `apps/server/src/modules/files/schema.ts` (`adminsOnly`); drizzle-kit picks up the new `schema.ts` files through its `./src/**/schema.ts` glob
- Create: `apps/server/src/infra/db/migrations/<next>_knowledge_and_reminders.sql` (generated, plus one hand-added line)
- Create: `apps/web/src/features/knowledge/locales/{en,sk}.json`, `apps/web/src/features/reminders/locales/{en,sk}.json` (skeletons)
- Docs: `docs/architecture/data-model.md`, `docs/roadmap.md` (Phase 17 row "in progress", linking the spec and this plan)

**Interfaces:**
- Consumes: `FileInfoSchema`, `TaskPersonSchema`, and `NotificationKinds` from Phase 6.
- Produces (`packages/shared/src/knowledge.ts`):
  - `KnowledgeTypes = ['note','file','link','reminder'] as const`, `KnowledgeType`.
  - `Visibilities = ['public','admins'] as const`, `Visibility`.
  - `KNOWLEDGE_LIMITS = { title: 200, body: 10_000, url: 2048, noteFiles: 10, times: 20, recipients: 50, pageSize: 30, excerpt: 140, clients: 200 }`.
  - `ReminderInputSchema = z.object({ times: z.array(z.object({ id: z.string().optional(), at: z.iso.datetime({ offset: true }) })).min(1).max(20), recipientIds: z.array(z.string()).max(50).transform(unique) })`.
  - `KnowledgeDraftSchema`: a `z.discriminatedUnion('type', …)` over a base `{ title: trim().min(1).max(200), body: max(10_000).default(''), visibility: enum.default('public') }`:
    - `note`: `fileIds` max 10, default `[]`;
    - `file`: `fileIds` of length exactly 1;
    - `link`: `url` (see `isHttpUrl`), `fileIds` default `[]` and max 0;
    - `reminder`: `reminder: ReminderInputSchema`, `fileIds` default `[]` and max 0.
    `KnowledgeDraft = z.output<…>`.
  - `isHttpUrl(value: string): boolean`: `new URL` parses it, the protocol is `http:` or `https:`, and it is at most 2048 characters.
  - `KnowledgePatchSchema = z.object({ title?, body?, url?, fileIds?: max 10, visibility?, reminder?: ReminderInputSchema, updatedAt: z.iso.datetime({ offset: true }) }).strict()`. It has no `type`, so `type` in a body is rejected.
  - `KnowledgeSummarySchema`:
    - `{ id, groupId, type, visibility, title, excerpt, url: string|null, file: FileInfo|null, fileCount, nextReminderAt: string|null, upcomingCount, lastReminderAt: string|null, createdBy: TaskPerson, createdAt, updatedAt }`;
    - `group?: { id, name, logoUrl: string|null }`, set in the global list only.
  - `KnowledgePageSchema = { items: KnowledgeSummary[], nextCursor: string|null }`.
  - `KnowledgeItemDtoSchema = KnowledgeSummarySchema.extend({ body, files: FileInfo[], reminder: ReminderSetDto|null, canEdit: boolean, visibilityLocked: boolean })`. `visibilityLocked` is true when the author is a client.
  - `KnowledgeScopeSchema = { managedGroupIds: string[] | null }`.
  - `KnowledgeEvents = { item: 'knowledge:item', itemDeleted: 'knowledge:item_deleted' } as const`.
  - `KnowledgeItemEvent = { item: KnowledgeSummary }` and `KnowledgeItemDeletedEvent = { groupId: string; id: string }`.
- Produces (`packages/shared/src/reminders.ts`):
  - `ReminderSubjectKind = 'knowledge'` (Phase 19 adds `'task'`) and `RecipientSource = 'author'|'added'|'subscribed'`.
  - `ReminderSetDtoSchema = { times: { id, at, firedAt: string|null }[], recipients: { user: TaskPerson, source }[], subscribed: boolean, canEdit: boolean }`.
  - `ReminderDuePayload = { subjectKind, subjectId, groupId, title, at: string, taskId?: string }`.
  - `UpcomingReminder = { id, at, title, groupId, groupName, target: { kind: 'knowledge'; itemId: string } }`. This is the Phase 20 contract.
- Produces (`ErrorCodes`): `invalidUrl`, `invalidVisibility`, `knowledgeChanged`, `invalidReminder`, `reminderInPast`, `invalidRecipient`, `authorRecipient`, with the snake_case values listed in Global Constraints.
- Produces (`NotificationKinds`): `'reminder.due'` appended.
- Produces (tables). These follow the spec's Tables sections exactly; column names in camelCase in Drizzle.
  - `knowledgeItems`, with:
    - CHECKs `knowledge_items_type_check`, `knowledge_items_visibility_check`, `knowledge_items_url_check` (`(type = 'link') = (url is not null)`) and `char_length(title) <= 200`;
    - indexes `knowledge_items_group_created_idx (group_id, created_at desc, id desc)`, `knowledge_items_created_idx (created_at desc, id desc)` and `knowledge_items_created_by_idx`;
    - `knowledge_items_search_idx`, built with `.using('gin', t.searchText.op('gin_trgm_ops'))`.
  - `knowledgeAttachments`, with PK `(item_id, file_id)` and an index on `file_id`.
  - `reminderSets`: `knowledge_item_id` is unique, and there is a CHECK `num_nonnulls(knowledge_item_id) = 1`.
  - `reminderTimes`: `reminder_times_due_idx (at) where fired_at is null` and `reminder_times_set_at_idx (set_id, at)`.
  - `reminderRecipients`: CHECK on `source`, PK `(set_id, user_id)` and an index on `user_id`.
  - `files.adminsOnly`: `boolean('admins_only').notNull().default(false)`.
- Produces (locale skeletons):
  - `knowledge`: `{ "types": {…filled…}, "visibility": {…filled…}, "list": {}, "row": {}, "form": {}, "detail": {}, "tab": {}, "newMenu": {}, "global": {}, "clientFilter": {} }`.
    - `types`: Note/Poznámka, File/Súbor, Link/Odkaz, Reminder/Pripomienka, plus the plural filter labels Notes, Files, Links, Reminders, All.
    - `visibility`: "Everyone in the group" / "Všetci v skupine" and "Only eGrant" / "Len eGrant".
  - `reminders`: `{ "fields": {}, "panel": {}, "time": {} }`.
  - Sections left empty here are filled by later tasks.

- [ ] **Step 1: Write the failing tests.**
  - `knowledge.test.ts`:
    - `a file draft needs exactly one file`: 0 files and 2 files both fail.
    - `a link needs an http(s) url`: `ftp://x` fails, `javascript:alert(1)` fails, `https://` + 2049 characters fails, and `https://opvai.sk/vyzvy` passes.
    - `a reminder needs 1..20 times`.
    - `a patch rejects type`.
    - `recipientIds are deduplicated`.
  - `schema.test.ts` (server, against `spolu_test`):
    - `pg_trgm is installed`: `select 1 from pg_extension where extname = 'pg_trgm'`.
    - `a link row without url violates knowledge_items_url_check`.
    - `a reminder set needs its knowledge item`.
    - `files.admins_only defaults to false`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/shared exec vitest run src/knowledge.test.ts` and `pnpm --filter @spolu/server exec vitest run src/modules/knowledge/schema.test.ts`. Expected: FAIL (the modules and tables do not exist).
- [ ] **Step 3: Implement the shared contracts and the schema files**, then run `pnpm --filter @spolu/server db:generate --name knowledge_and_reminders`. In the generated SQL, add `CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint` as the first statement, so it runs before the GIN index. Create the locale skeletons.
- [ ] **Step 4: Run the tests again,** together with the existing locales test and `pnpm typecheck`. Expected: PASS, including en/sk parity of the new namespace files.
- [ ] **Step 5: Docs.** Add the five tables and `files.admins_only` to `data-model.md`, and add the Phase 17 row to `roadmap.md`.
- [ ] **Step 6: Commit.** Commit message: `feat(knowledge): shared contracts, tables and migration`.

---

### Task 2: Shared web fields and the sheet dialog (moved, not rewritten)

Depends on: none

**Files:**
- Create:
  - `apps/web/src/components/ui/sheet-dialog.tsx`, `sheet-dialog.test.tsx`;
  - `apps/web/src/components/ui/panel-header.tsx`;
  - `apps/web/src/components/formatted-text-field.tsx`;
  - `apps/web/src/components/files-field.tsx`, `files-field.test.tsx`;
  - `apps/web/src/components/people-select.tsx`, `people-select.test.tsx`;
  - `apps/web/src/components/locales/{en,sk}.json`.
- Delete (moved): `apps/web/src/features/tasks/description-field.tsx`, `task-files-field.tsx`, `assignee-select.tsx`.
- Modify:
  - `apps/web/src/features/tasks/panel-parts.tsx`: drop `PanelHeader` and import it from the new place;
  - `apps/web/src/features/tasks/task-form.tsx`;
  - `apps/web/src/features/task-split/review-dialog.tsx`: its frame becomes `SheetDialog`;
  - the tasks and chat route loaders (load the `forms` namespace);
  - `apps/web/src/features/tasks/locales/*` (remove the moved keys).
- Docs: `docs/design/tokens.md` (`SheetDialog`, the 44 px phone rule now lives there)

**Interfaces:**
- Consumes:
  - from the i18n split task: `loadNamespace(ns: string): Promise<void>` from `@/i18n`, which is idempotent and loads `ns` with `i18next.addResourceBundle`;
  - `useTranslation(ns)`.
- Produces:
  - `SheetDialog({ children, onEscape, initialFocus, testId, labelledBy }: { children: ReactNode; onEscape: (event: KeyboardEvent) => void; initialFocus?: RefObject<HTMLElement | null>; testId?: string; labelledBy?: string })`.
    - It is the review dialog's Radix frame verbatim: overlay hidden below 641 px, full screen below 641 px, centred 720 px with `max-h-[min(880px,calc(100dvh-48px))]` from 641 px, `PHONE_TARGETS`, outside clicks ignored, and keys stopped from bubbling.
    - It also exports `SheetDialogTitle` (Radix `Dialog.Title`).
  - `PanelHeader({ onClose, children, compactBelow = 1024 }: { onClose: () => void; children: ReactNode; compactBelow?: 641 | 1024 })`.
    - The markup is unchanged. `compactBelow` picks where the back arrow replaces "Close": 1024 for the task panel, 641 for the knowledge dialog.
    - Its labels are `forms:panel.back` and `forms:panel.close`. `BackIcon` moves into the same file.
  - `FormattedTextField({ id, groupId, value, onChange, label, editLabel, error, errorId })`. This is `DescriptionField` with the label and the "Edit …" text passed in.
  - `FilesField({ groupId, fileIds, files, onAdd, onRemove, labelId, max }: {…; max: number })`. This is `TaskFilesField`, with `MAX_TASK_FILES` replaced by `max`. The picker is `multiple` only when `max > 1`.
  - `PeopleSelect({ people, value, onChange, knownPeople, fixedIds = [], inputId, describedBy, invalid, max, label })`. This is `AssigneeSelect` with `people: GroupPerson[] | undefined` passed in instead of fetched. A chip in `fixedIds` has no remove button and cannot be deselected.
  - Namespace `forms` with sections `panel`, `formattedText`, `files`, `people`. The keys move from `tasks.form.*` with the same copy.

- [ ] **Step 0:** Invoke `frontend-design:frontend-design`. The task changes no visuals; the skill confirms the moved frames keep their tokens.
- [ ] **Step 1: Write the failing tests.**
  - `sheet-dialog.test.tsx`:
    - `Escape calls onEscape`;
    - `initialFocus receives the focus on open`;
    - `content has the phone 44 px target classes`.
  - `files-field.test.tsx`: `with max 1 the picker is single and Attach hides once a file is attached`.
  - `people-select.test.tsx`:
    - `a fixed chip has no remove button and Backspace does not remove it`;
    - `lists only the given people`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/web exec vitest run src/components`. Expected: FAIL (the modules do not exist).
- [ ] **Step 3: Move the code.**
  - Move `PanelHeader`, `DescriptionField`, `TaskFilesField` and `AssigneeSelect`, and extract `SheetDialog` from `review-dialog.tsx`. Point `TaskForm`, the task panel and the review dialog at the new modules: `TaskForm` passes `max={20}` and `people={useGroupPeople(groupId).data}`.
  - Move the keys to `forms`. Add `loadNamespace('forms')` next to the existing namespace loads of the tasks and chat route chunks.
- [ ] **Step 4: Run the tests.** Run the new tests and the existing `task-form`, `task-panel`, `review-dialog` and `board` tests. Expected: PASS with no snapshot or text changes. Also run `pnpm --filter @spolu/web build`, which must pass.
- [ ] **Step 5: Docs, then commit.** Commit message: `refactor(web): shared sheet dialog, panel header and form fields`.

---

### Task 3: Reminders module — service, subjects and `.ics`

Depends on: Task 1

**Files:**
- Create: `apps/server/src/modules/reminders/subjects.ts`, `service.ts`, `service.test.ts`, `ics.ts`, `ics.test.ts`, `errors.ts`
- Modify: `apps/server/src/modules/users/service.ts` (`getUserNames`)
- Docs: `docs/product/reminders.md` (rules), `docs/architecture/permissions.md` (recipients and subscription)

**Interfaces:**
- Consumes:
  - the `reminderSets`, `reminderTimes` and `reminderRecipients` tables (Task 1);
  - `isGroupPerson(db, groupId, userId)` and `getMembershipGroupId`;
  - `isAdmin`.
- Produces (`subjects.ts`):
  ```ts
  export type SubjectInfo = { groupId: string; title: string; body: string; adminsOnly: boolean; active: boolean;
    authorId: string; link: string; // app-relative URL of the subject, e.g. /groups/g/knowledge?k=id
    canRead(actor: SessionUser, actorGroupId: string | null): boolean; canEdit(actor: SessionUser): boolean };
  export type ReminderSubject = { kind: ReminderSubjectKind; routePrefix: string; // 'knowledge'
    loadMany(db: Db, ids: string[]): Promise<Map<string, SubjectInfo>> };
  export type ReminderSubjectRef = { kind: ReminderSubjectKind; id: string };
  export function registerReminderSubject(subject: ReminderSubject): void; // idempotent per kind
  export function getReminderSubject(kind: ReminderSubjectKind): ReminderSubject; // throws if unregistered
  export function subjectColumn(kind: ReminderSubjectKind): AnyPgColumn; // reminderSets.knowledgeItemId
  ```
- Produces (`errors.ts`): `InvalidReminderError`, `ReminderInPastError`, `InvalidRecipientError`, `AuthorRecipientError`.
- Produces (`service.ts`):
  - `replaceReminderSet(tx: Db, subject: ReminderSubjectRef & { groupId: string; adminsOnly: boolean; authorId: string }, input: { times: { id?: string; at: string }[]; recipientIds: string[] }, actor: SessionUser, now = new Date()): Promise<void>`.
    - It upserts the set, and then:
      - keeps every fired time;
      - an input time with the id of a fired time and the same `at` is accepted and left untouched; a changed `at` is `InvalidReminderError`;
      - an unknown id is `InvalidReminderError`;
      - an unfired existing time is updated when its `at` changed, and deleted when it is missing from the input;
      - new times are inserted.
    - Validation:
      - new or changed times must satisfy `now + 60 s <= at <= now + 5 years`, else `ReminderInPastError` (in the past) or `InvalidReminderError` (too far);
      - more than 20 unfired times is `InvalidReminderError`;
      - the `added` recipients are replaced. Each must pass `isGroupPerson`, and must be an admin when `adminsOnly`, else `InvalidRecipientError`. More than 50 is also `InvalidRecipientError`.
    - The author row (`source 'author'`) is inserted if missing and never removed. `subscribed` rows are kept.
  - `pruneRecipientsForAdminsOnly(tx: Db, subject: ReminderSubjectRef): Promise<void>` deletes every non-admin recipient row except the author's.
  - `getReminderSet(db: Db, subject: ReminderSubjectRef, actor: SessionUser): Promise<ReminderSetDto | null>` returns null when there is no set or the actor cannot read it. Times are listed upcoming first by `at`, then fired. Recipients are listed author first, then by name.
  - `subscribe(db, subject, actor): Promise<void>` upserts `subscribed` (and keeps an existing `author`/`added` row as it is). `unsubscribe(db, subject, actor): Promise<void>` throws `AuthorRecipientError` for the author and deletes the actor's row otherwise. Both throw `NotReadableError` (from `errors.ts`) when the actor cannot read the subject.
  - `buildIcs(db, subject, actor, publicUrl: string, now = new Date()): Promise<{ filename: string; text: string } | null>` returns null when the subject is unreadable or has no upcoming time.
  - `listUpcomingForUser(db: Db, actor: SessionUser, opts: { from?: Date; limit: number }): Promise<UpcomingReminder[]>` covers unfired times `>= from` of sets where the actor is a recipient, earliest first. It uses one query plus one `loadMany` per kind, and drops subjects the actor can no longer read.
  - `getUserNames(db, ids: string[]): Promise<Map<string, string>>` (users service) does one query.
- Produces (`ics.ts`):
  - `buildIcsText(input: { now: Date; events: { uid: string; start: Date; title: string; description: string; url: string }[] }): string`, a pure function;
  - `icsFilename(title: string): string`, a slug of `[a-z0-9-]`, max 60 characters, `reminder` when empty, plus `.ics`.
  - Rules, from the spec's Calendar export section:
    - `VERSION:2.0`, `PRODID:-//eGrant//Spolu//EN`, `CALSCALE:GREGORIAN` and `METHOD:PUBLISH`;
    - per event: `UID`, `DTSTAMP`, `DTSTART`/`DTEND` in UTC `YYYYMMDDTHHMMSSZ` (the end is the start + 15 min), `SUMMARY`, `DESCRIPTION` (plain body, first 1000 characters, `\n\n` + url), `URL`, and a `VALARM` with `TRIGGER:PT0M` and `ACTION:DISPLAY`;
    - text is escaped `\\ \; \, \n`, lines end in CRLF, and lines are folded at 75 octets on UTF-8 character boundaries, with continuation lines starting with one space.
  - The UID is `reminder-<timeId>@spolu`.

- [ ] **Step 1: Write the failing tests.**
  - `ics.test.ts`:
    - `one VEVENT per event with stable UID`;
    - `DTSTART is UTC`: a start at 2026-10-25T09:00:00Z gives `DTSTART:20261025T090000Z` and `DTEND:20261025T091500Z`;
    - `escapes backslash, semicolon, comma and newline`;
    - `every line ends in CRLF and is at most 75 octets`;
    - `folding never splits a multi-byte character`: a title of 60 × "č" plus "🙂" unfolds back to the same text, and every line decodes as valid UTF-8;
    - `filename slug`: "Podať správu 2026!" gives `podat-spravu-2026.ics`.
  - `service.test.ts`. Register a stub `knowledge` subject over real `knowledge_items` rows inserted through the table, with a unique group, admin and client per test.
    - `keeps fired times, deletes missing unfired times, inserts new ones`;
    - `replaceReminderSet accepts an unchanged fired time and keeps it fired` (`firedAt` unchanged);
    - `a fired time with a changed at is invalid_reminder`;
    - `refuses a time under one minute ahead` (`ReminderInPastError`);
    - `refuses the 21st time`;
    - `recipients must be group people` (a client of another group is `InvalidRecipientError`);
    - `admins-only subject refuses a client recipient`;
    - `the author always stays` (an input without the author still lists them with `source 'author'`);
    - `subscribe and unsubscribe; the author cannot unsubscribe`;
    - `an added recipient can opt out`;
    - `switching pruning drops non-admins but not the author`;
    - `buildIcs is null with no upcoming time`;
    - `listUpcomingForUser lists only own sets, earliest first, after from`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/reminders`. Expected: FAIL.
- [ ] **Step 3: Implement** `subjects.ts`, `errors.ts`, `service.ts`, `ics.ts` and `getUserNames`. `replaceReminderSet` does at most four statements: upsert the set, read the existing times, write the time diff, and replace the `added` recipients.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Docs, then commit.** Commit message: `feat(reminders): reminder sets, recipients and calendar export`.

---

### Task 4: The `reminder.due` notification kind

Depends on: Task 1

**Files:**
- Modify:
  - `apps/server/src/modules/notifications/decide.ts`, `decide.test.ts`;
  - `push-content.ts`, `push-content.test.ts`;
  - `texts.ts`;
  - `digest.ts`, `digest.test.ts` (Phase 6 email digest line).
- Docs: `docs/product/notifications.md` (the reminder kind, and the Off exception for explicit recipients)

**Interfaces:**
- Consumes: `ReminderDuePayload`, and `'reminder.due'` in `NotificationKinds` (Task 1).
- Produces:
  - `passesMode(kind, mode)` returns **true for `'reminder.due'` in every mode** (the brief's ruling). `KIND_RANK['reminder.due'] = 2`. `decideEvent` is unchanged otherwise, so `isGroupPerson` still applies.
  - `buildPushPayload` gains a `reminder.` branch:
    - `title`: `${p.title} · ${groupName}`;
    - `body`: `texts(lang).reminderDue(formatReminderTime(p.at, lang))`;
    - `url`: `/groups/<groupId>/knowledge?k=<subjectId>`;
    - `tag`: `knowledge:<subjectId>`.
  - `formatReminderTime(iso: string, lang: UserLanguage): string` (in `texts.ts`) uses `Intl.DateTimeFormat` with `timeZone: 'Europe/Bratislava'`, locale `sk-SK`/`en-GB`, `{ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }`.
  - `Texts` gains:
    - `reminderDue(time)`: "Reminder for {time}" / "Pripomienka na {time}";
    - `reminderLine(title, time)`: "Reminder: {title}, {time}" / "Pripomienka: {title}, {time}".
  - The digest's line builder renders `reminder.due` events with `reminderLine`. Like task events, they count as unread.

- [ ] **Step 1: Write the failing tests.**
  - `decide.test.ts`:
    - `reminder.due passes All, Mentions and Off`;
    - `reminder.due is still dropped for someone no longer in the group`.
  - `push-content.test.ts`:
    - `reminder push has title · group, knowledge URL and tag`;
    - `reminder push body uses Bratislava time across the DST change`: `at = 2026-10-25T09:00:00Z` gives a body containing `10:00`, and `2026-10-24T09:00:00Z` gives one containing `11:00`;
    - `sk body reads "Pripomienka na …"`.
  - `digest.test.ts`: `a reminder event becomes the line "Reminder: <title>, <time>"`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/notifications`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** the branch, the texts and the digest line.
- [ ] **Step 4: Run the tests again.** Run the whole notifications folder. Expected: PASS.
- [ ] **Step 5: Docs, then commit.** Commit message: `feat(notifications): reminder.due kind, push and digest line`.

---

### Task 5: Knowledge policy, service, search, files admins-only and scope seam

Depends on: Task 1, Task 3

**Files:**
- Create in `apps/server/src/modules/knowledge/`:
  - `policy.ts`, `policy.test.ts`;
  - `service.ts`, `service.test.ts`;
  - `search.ts`, `search.test.ts`;
  - `scope.ts`, `scope.test.ts`;
  - `reminder-subject.ts`.
- Modify:
  - `apps/server/src/modules/files/policy.ts`, `policy.test.ts`;
  - `apps/server/src/modules/files/service.ts` (`setFilesAdminsOnly`);
  - `apps/server/src/modules/files/routes.ts`: pass the `adminsOnly` field to `canReadFile`, and add a route test that a client gets 404.
- Docs:
  - `docs/architecture/permissions.md` (the knowledge policy and the admins-only file rule);
  - `docs/decisions/<next>-trigram-search.md`, an ADR for `pg_trgm` with the reasons from the spec's Search section.

**Interfaces:**
- Consumes:
  - from Task 3: `replaceReminderSet`, `pruneRecipientsForAdminsOnly`, `registerReminderSubject`, `getReminderSet` and `getUserNames`;
  - from the files service: `attachFiles`, `detachFiles`, `deleteDetachedFiles` and `getFilesForGroup`;
  - `canReadGroup`, `isAdmin` and `plainExcerpt`.
- Produces (`policy.ts`):
  - `canReadItem(actor, item: { groupId; visibility }, actorGroupId): boolean`;
  - `canEditItem(actor, item: { groupId; visibility; createdBy }, actorGroupId): boolean`, with `canDeleteItem = canEditItem`;
  - `canSetVisibility(actor, item: { authorIsClient: boolean } | null, visibility: Visibility): boolean`: `admins` requires an admin actor and an admin author (`null` item = create, author = actor).
- Produces (`files`):
  - `canReadFile(actor, file: { groupId; adminsOnly }, actorGroupId)`;
  - `setFilesAdminsOnly(tx: Db, fileIds: string[], value: boolean): Promise<void>`.
- Produces (`search.ts`):
  - `normalizeSearch(text: string): string`: NFD, strip `\p{M}`, lower-case, collapse whitespace.
  - `searchTerms(q: string): string[]`: normalize, split on spaces, drop terms under 2 characters, keep the first 5.
  - `escapeLike(term: string): string`: escapes `\`, `%` and `_` with `\`.
  - `buildSearchText(input: { title; body; url: string|null; fileNames: string[]; nameOf }): string`.
- Produces (`scope.ts`): `managedGroupIdsOf(db: Db, adminId: string): Promise<string[] | null>`. **It returns `null` in this phase.** A one-line comment says that whichever of 17 and 18 merges second makes it `return managedGroupIds(db, adminId)`.
- Produces (`reminder-subject.ts`): `registerKnowledgeReminderSubject(): void` registers the kind `knowledge`, `routePrefix 'knowledge'`.
  - `loadMany` does one query: the items with group, title, body, visibility (`adminsOnly`), author and author role.
  - `link` is `/groups/<g>/knowledge?k=<id>` and `active` is always true.
- Produces (`service.ts`):
  - Errors: `KnowledgeNotFoundError`, `KnowledgeForbiddenError`, `KnowledgeChangedError`, `InvalidVisibilityError` and `InvalidUrlError`. The reminder errors from Task 3 and `InvalidAttachmentError` pass through.
  - `createItem(deps: { db }, actor, groupId, draft: KnowledgeDraft): Promise<{ item: KnowledgeItemDto; fileIds: string[] }>`.
    - It runs in one transaction: insert the item, `attachFiles`, `setFilesAdminsOnly` when admins-only, `replaceReminderSet` for reminders, then compute `search_text` with the files' names.
    - A client's draft with `visibility 'admins'` is `InvalidVisibilityError`.
  - `updateItem(deps: { db }, actor, id, patch: KnowledgePatch): Promise<{ item: KnowledgeItemDto; previousVisibility: Visibility; removedFileIds: string[] }>`. In one transaction it:
    - locks the row and compares `updatedAt` (`KnowledgeChangedError`);
    - applies the per-type rules: a file item keeps exactly one file, a link needs `isHttpUrl`, and a note has at most 10 files;
    - attaches added files and detaches removed ones;
    - flips `admins_only` on all of the item's files when the visibility changed;
    - calls `pruneRecipientsForAdminsOnly` on a switch to admins;
    - calls `replaceReminderSet` when `patch.reminder` is set;
    - recomputes `search_text` and bumps `updated_at`.
  - `deleteItem(deps: { db; storage }, actor, id): Promise<{ groupId: string; visibility: Visibility }>`. It detaches the item's files in the transaction and calls `deleteDetachedFiles` after the commit. The reminders cascade.
  - `getItem(db, actor, id): Promise<KnowledgeItemDto>` throws `KnowledgeNotFoundError` when the item is unreadable.
  - `getItemRef(db, id): Promise<{ id; groupId; visibility; createdBy; authorIsClient } | null>`.
  - `listGroupItems(db, actor, groupId, opts: { type?: KnowledgeType; q?: string; cursor?: string }): Promise<KnowledgePage>`. Clients get `visibility = 'public'` only.
  - `listAllItems(db, opts: { groupIds: string[] | null; type?; q?; cursor? }): Promise<KnowledgePage>`. It is for admins; `groupIds` null means all groups, and each summary carries `group`.
  - `toSummary(row, names): KnowledgeSummary`.
  - Cursor: base64url of `${created_at::text}|${id}`, read back as `(created_at, id) < ($1::timestamptz, $2)`. The cursor carries the database's text, never a JS `Date`, so no microseconds are lost. A malformed cursor is `ValidationError`.
- The page query, which runs once per page:
  ```sql
  select k.*, k.created_at::text as created_text, left(k.body, 2000) as body_head, u.name as author_name, g.name as group_name, g.updated_at as group_updated, g.logo_key is not null as has_logo,
         f.file_count, f.first_file, r.next_at, r.upcoming, r.last_at
  from knowledge_items k join "user" u on u.id = k.created_by join groups g on g.id = k.group_id
  left join lateral (select count(*) as file_count, (array_agg(to_jsonb(fl) order by fl.created_at))[1] as first_file
                     from knowledge_attachments a join files fl on fl.id = a.file_id where a.item_id = k.id) f on true
  left join lateral (select min(t.at) filter (where t.fired_at is null) as next_at,
                            count(*) filter (where t.fired_at is null) as upcoming, max(t.at) as last_at
                     from reminder_sets s join reminder_times t on t.set_id = s.id where s.knowledge_item_id = k.id) r on true
  where <scope> and <type> and <one "k.search_text ilike '%' || $term || '%' escape '\'" per term>
    and (<cursor>) order by k.created_at desc, k.id desc limit 31
  ```
  Notes on the query:
  - The 31st row only decides `nextCursor`.
  - The mention names for the excerpts come from one `getUserNames` call per page.
  - The excerpt is `plainExcerpt(body_head, nameOf, 140)`.

- [ ] **Step 1: Write the failing tests.**
  - `policy.test.ts`:
    - `clients read public items of their group only`;
    - `admins read admins-only items`;
    - `author and admins edit; another client cannot`;
    - `a client cannot set admins`;
    - `an admin cannot make a client's item admins-only`;
    - `an admin's item can switch either way by any admin`.
  - `files/policy.test.ts`: `an admins-only file is unreadable to the group's client`.
  - `search.test.ts`:
    - `normalizeSearch strips diacritics` ("Rozpočet" gives "rozpocet");
    - `escapeLike escapes % _ and backslash`;
    - `at most 5 terms, none under 2 characters`.
  - `scope.test.ts`: `managedGroupIdsOf returns null before Phase 18`.
  - `service.test.ts`:
    - `create per type`: a note with 2 files has `fileCount` 2; a file item's `file` is set; a link has its `url`; a reminder has `nextReminderAt` and `upcomingCount`.
    - `files.admins_only follows visibility both ways`.
    - `search_text has title, body without diacritics, URL and file names, recomputed when files change`.
    - `search: substring, prefix, accent-free, terms ANDed, % and _ and backslash literal`.
    - `clients get public items only in the tab list`.
    - `type filter`.
    - `cursor pages never skip or repeat items with equal created_at`: insert 31 items in one transaction through the service's internal insert helper, then page through all of them.
    - `listAllItems: explicit groupIds, null scope means all groups, and items carry group`.
    - `update with a stale updatedAt is KnowledgeChangedError`.
    - `type cannot change through a patch`.
    - `switching to admins-only drops non-admin recipients`.
    - `delete removes attachments, files and reminder rows`.
    - `a mention in a note body shows the name in the excerpt and notifies nobody`: no `notification_events` row for the mentioned user.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/knowledge src/modules/files`. Expected: FAIL.
- [ ] **Step 3: Implement** the policy, files change, search, scope seam, subject adapter and service.
- [ ] **Step 4: Run the tests again.** Expected: PASS, and the existing files and tasks tests stay green.
- [ ] **Step 5: Docs** (permissions and the ADR), then **commit.** Commit message: `feat(knowledge): policy, service, trigram search and admins-only files`.

---

### Task 6: The reminders fire job

Depends on: Task 3, Task 4, Task 5

**Files:**
- Create: `apps/server/src/modules/reminders/jobs.ts`, `jobs.test.ts`
- Modify:
  - `apps/server/src/deps.ts`: register the handler and schedule, and call `registerKnowledgeReminderSubject()`;
  - `apps/server/test/test-app.ts`: add the handlers to the inline jobs.
- Docs: `docs/architecture/overview.md` (the fire job), `docs/product/reminders.md` (lateness ≤ 1 min, outage rule)

**Interfaces:**
- Consumes:
  - `recordNotifications(tx, { kind, groupId, recipients, payload, dedupeKey })` and `requestDelivery(jobs, userIds)` (Phase 6);
  - `getReminderSubject(kind).loadMany` (Task 3);
  - `registerKnowledgeReminderSubject` (Task 5).
- Produces:
  - `REMINDERS_FIRE_JOB = 'reminders.fire'`, with the schedule `{ name: REMINDERS_FIRE_JOB, cron: '* * * * *' }` exported as `reminderSchedules`.
  - `remindersJobHandlers(deps: { db: Db; jobs: JobQueue }): JobHandlers`.
  - `fireDueReminders(deps: { db; jobs }, opts?: { now?: Date; limit?: number; setIds?: string[] }): Promise<number>` returns the number of times processed. Each batch of `limit` (default 200) is one transaction:
    1. `select … from reminder_times where fired_at is null and at <= now [and set_id in setIds] order by at limit N for update skip locked`;
    2. load the sets and recipients in one query, and the subjects with `loadMany` once per kind;
    3. for each time:
       - if it is older than 24 h, its subject is missing, or the subject is inactive: set `fired_at` only;
       - otherwise drop the non-admin recipients of an `adminsOnly` subject, record `reminder.due` with the payload `ReminderDuePayload` and `dedupeKey` `reminder:<timeId>`, and set `fired_at`;
       - a thrown error for one set is logged, and that time is marked fired.
    4. After the commit, it calls `requestDelivery` for the recorded recipients. It loops until a batch comes back short.

- [ ] **Step 1: Write the failing tests** (`jobs.test.ts`). They use `buildTestApp` with `push: { provider: 'fake' }`, create the items with `createItem` (Task 5), and set times through the table to the past. Always pass `setIds`.
  - `due times record one event per recipient and set fired_at`;
  - `a rerun records nothing` (dedupe);
  - `two workers in parallel never double-fire`: `Promise.all` of two runs gives one event per recipient;
  - `times older than 24 h are marked fired silently`;
  - `a non-admin recipient of an admins-only subject is skipped`;
  - `a removed group member gets no push`: after `deliverPending({ userIds })` the fake sender has nothing for them;
  - `a recipient in mode Off still gets the push`;
  - `the push has title · group, Reminder for …, /groups/<g>/knowledge?k=<id>`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/reminders/jobs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the job, and wire it in `deps.ts` (`...remindersJobHandlers({ db, jobs: forward.queue })` and `...reminderSchedules`) and in `test-app.ts`.
- [ ] **Step 4: Run the tests again,** plus `src/app.test.ts`. Expected: PASS.
- [ ] **Step 5: Docs, then commit.** Commit message: `feat(reminders): fire due reminders every minute`.

---

### Task 7: Knowledge and reminders HTTP routes, realtime and the admins room

Depends on: Task 3, Task 5

**Files:**
- Create in `apps/server/src/modules/knowledge/`: `routes.ts`, `routes.test.ts`, `events.ts`
- Create in `apps/server/src/modules/reminders/`: `routes.ts`, `routes.test.ts`
- Modify:
  - `apps/server/src/infra/realtime/rooms.ts` (`groupAdminsRoom`, `emitToGroupAdmins`);
  - `apps/server/src/infra/realtime/socket.ts`: an admin joins and leaves `group:<id>:admins` together with the group room;
  - `socket.test.ts`;
  - `apps/server/src/app.ts`: register both route plugins, and call `registerKnowledgeReminderSubject()`.
- Docs: `docs/architecture/realtime.md` (the knowledge events and the group admins room), `docs/product/knowledge-base.md` (status: built, server), `docs/product/README.md` (rows), `docs/product/groups.md` (Knowledge tab)

**Interfaces:**
- Consumes: all of Task 5's service functions and errors, Task 3's reminder service, `managedGroupIdsOf`, `createRateLimiter`, `requireUser`, `requireAdmin` (the users module's guard) and `getMembershipGroupId`.
- Produces (`rooms.ts`):
  - `groupAdminsRoom(groupId: string): string`, which returns `group:<id>:admins`;
  - `emitToGroupAdmins(io, groupId, event, payload): void`.
- Produces (`events.ts`):
  - `emitKnowledgeItem(io, item: KnowledgeSummary, previousVisibility?: Visibility): void`:
    - public: `item` to the group room;
    - admins-only: `item` to the admins room;
    - public → admins: `item_deleted` to the group room, then `item` to the admins room;
    - admins → public: `item` to the group room.
  - `emitKnowledgeDeleted(io, { groupId, id, visibility }): void` sends to the group room (public) or the admins room (admins-only).
- Produces (endpoints), exactly as in the spec's Endpoints table:
  - `GET /api/groups/:id/knowledge?type&q&cursor`;
  - `GET /api/knowledge?clients&type&q&cursor`: admins only. `clients` is comma-separated, at most 200 ids, else 400 `validation_failed`. Without it the scope comes from `managedGroupIdsOf`, and null or `[]` means all groups;
  - `GET /api/knowledge/scope`;
  - `POST /api/groups/:id/knowledge` returns 201;
  - `GET|PATCH|DELETE /api/knowledge/:id`;
  - in the reminders plugin, for each registered subject's `routePrefix`:
    - `GET /api/<prefix>/:id/reminders`;
    - `POST|DELETE /api/<prefix>/:id/reminders/subscription`, answering 204;
    - `GET /api/<prefix>/:id/reminders/calendar.ics`, answering `text/calendar; charset=utf-8` with `content-disposition: attachment; filename="<slug>.ics"`, or 404 when there is no upcoming time.
  - Error mapping:
    - a zod issue on `url` is 400 `invalid_url`;
    - on `reminder.times` it is `invalid_reminder`, and on `reminder.recipientIds` it is `invalid_recipient`;
    - other body issues are `validation_failed`;
    - the service errors map to 404, 403, 409 `knowledge_changed`, 400 `invalid_visibility`, `invalid_attachment`, `reminder_in_past` and `author_recipient`.
    - An unreadable item is 404 on every route, including its reminders and `.ics`.

- [ ] **Step 1: Write the failing tests.**
  - `routes.test.ts` (knowledge):
    - `a client gets 404 on an admins-only item, its file and its .ics`;
    - `a client cannot create admins-only` (400 `invalid_visibility`);
    - `another client gets 403 on edit and delete`;
    - `PATCH with stale updatedAt is 409 knowledge_changed`;
    - `invalid url is 400 invalid_url`;
    - `GET /api/knowledge is 403 for clients`;
    - `clients over 200 is 400`;
    - `the default scope is all groups while managedGroupIdsOf is null`;
    - `GET /api/knowledge/scope answers { managedGroupIds: null }`;
    - `writes over 120/min answer 429`.
  - Realtime, with two socket clients (an admin who joined the group, and the group's client):
    - `public events reach the client`;
    - `admins-only events reach only the admin`;
    - `public → admins sends item_deleted to the client and the admin ends with the item`.
  - `reminders/routes.test.ts`:
    - `subscribe then unsubscribe answers 204 and changes subscribed`;
    - `the author's unsubscribe is 400 author_recipient`;
    - `calendar.ics has the headers and one VEVENT per upcoming time`;
    - `no upcoming time is 404`.
  - `socket.test.ts`: `an admin's group:join also joins the admins room; a client never does`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/knowledge/routes.test.ts src/modules/reminders/routes.test.ts src/infra/realtime`. Expected: FAIL.
- [ ] **Step 3: Implement** the rooms, the socket join, the events and both route plugins, and register them in `app.ts`.
- [ ] **Step 4: Run the whole server suite** with `pnpm --filter @spolu/server test`. Expected: PASS.
- [ ] **Step 5: Docs, then commit.** Commit message: `feat(knowledge): HTTP API, reminder endpoints and admins room`.

---

### Task 8: Web knowledge API, rows and list

Depends on: Task 1

**Files:**
- Create in `apps/web/src/features/knowledge/`:
  - `api.ts`, `api.test.ts`;
  - `knowledge-row.tsx`, `knowledge-row.test.tsx`;
  - `calendar-leaf.tsx`;
  - `knowledge-list.tsx`, `knowledge-list.test.tsx`;
  - `icons.tsx`.
- Create: `apps/web/src/features/reminders/format.ts`, `format.test.ts`
- Modify: `features/knowledge/locales/{en,sk}.json` (`list`, `row`), `features/reminders/locales/{en,sk}.json` (`time`)
- Docs: `docs/design/tokens.md` (knowledge rows, calendar leaf)

**Interfaces:**
- Consumes: the shared schemas (Task 1), `apiGet`/`apiSend`, `Avatar`, `Card`, `Badge`, `fileUrl`, `formatFileSize` and `plainExcerpt`.
- Produces (`api.ts`):
  - `groupKnowledgeQuery(groupId: string, filter: { type?: KnowledgeType; q?: string })` and `globalKnowledgeQuery(filter: { clients?: string[]; type?; q? })` are `infiniteQueryOptions`. Their keys are `['knowledge','group',groupId,filter]` and `['knowledge','global',filter]`, and the page param is the cursor.
  - `knowledgeItemQuery(id)` has the key `['knowledge','item',id]`, and `knowledgeScopeQuery` has `['knowledge','scope']`.
  - `createKnowledge(groupId, draft)`, `updateKnowledge(id, patch)` and `deleteKnowledge(id)`.
  - `subscribeReminder(prefix: string, id)`, `unsubscribeReminder(prefix, id)` and `reminderCalendarUrl(prefix, id): string` (in `features/reminders/api.ts`, created here).
- Produces (`format.ts`, reminders):
  - `formatReminderTime(iso: string, language: string, now = new Date()): string`. It reads "Today, 14:00", "Tomorrow, 09:00" or "Thu 23 Oct, 14:00" in local time, with the copy in `reminders:time.*`.
  - `formatReminderDate(iso, language): string`, for example "Thu 23 Oct 2026, 14:00".
  - `leafParts(iso, language): { day: string; month: string }`.
- Produces (components):
  - `CalendarLeaf({ iso, muted, size }: { iso: string; muted?: boolean; size: 32 | 40 })`.
  - `KnowledgeRow({ item, onOpen, showGroup }: { item: KnowledgeSummary; onOpen: (id: string) => void; showGroup?: boolean })` follows the spec's Row layout.
    - The row is a `<div>`. A full-row `<button aria-label="Open {title}">` sits underneath.
    - The inner links are siblings of the button: the file link uses `fileUrl(file.id)` and the URL link uses `target="_blank" rel="noopener noreferrer"`.
    - A reminder with no upcoming time shows the muted leaf of `lastReminderAt` and "Done".
    - `displayUrl(url)` strips the protocol and a leading `www.`.
  - `KnowledgeList({ query, onOpen, showGroup, empty }: { query: UseInfiniteQueryResult<InfiniteData<KnowledgePage>>; onOpen; showGroup?; empty: ReactNode })` shows the rows in one `Card`, then "Load more".

- [ ] **Step 0:** Invoke `frontend-design:frontend-design`, for the row, the leaf and the Card column at 720 px and at phone width.
- [ ] **Step 1: Write the failing tests.**
  - `knowledge-row.test.tsx`:
    - `note shows the excerpt truncated and the paperclip count, nothing at 0`;
    - `clicking the file name or the URL does not call onOpen`;
    - `the URL link opens in a new tab with noopener`;
    - `the reminder leaf shows the next date and "and 2 more"`;
    - `with no upcoming time the leaf is muted and line 2 reads Done`;
    - `admins-only shows the Only eGrant badge`;
    - `showGroup puts the group name first`.
  - `format.test.ts`: `today and tomorrow are named`, and `sk weekday and month`.
  - `knowledge-list.test.tsx`: `Load more fetches the next cursor`, and `empty node when no items`.
  - `api.test.ts`: `global query joins clients with commas`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/web exec vitest run src/features/knowledge src/features/reminders`. Expected: FAIL.
- [ ] **Step 3: Implement** the code above.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Docs, then commit.** Commit message: `feat(knowledge): web API, list rows and calendar leaf`.

---

### Task 9: `KnowledgeForm` and the reminder fields

Depends on: Task 1, Task 2

**Files:**
- Create:
  - `apps/web/src/features/knowledge/knowledge-form.tsx`, `knowledge-form.test.tsx`;
  - `apps/web/src/features/reminders/reminder-times-field.tsx`, `reminder-times-field.test.tsx`;
  - `apps/web/src/features/reminders/recipients-field.tsx`, `recipients-field.test.tsx`.
- Modify: the `form` section of `knowledge/locales`, and the `fields` section of `reminders/locales`.

**Interfaces:**
- Consumes: `FormattedTextField`, `FilesField` and `PeopleSelect` (Task 2); `useGroupPeople`; `KnowledgeDraftSchema` and `isHttpUrl` (Task 1).
- Produces:
  - `ReminderTimeValue = { id?: string; date: string; time: string; firedAt: string | null }`.
  - `KnowledgeFormValue = { title: string; body: string; url: string; fileIds: string[]; visibility: Visibility; times: ReminderTimeValue[]; recipientIds: string[] }`.
  - `emptyKnowledgeValue(): KnowledgeFormValue`. Its `times` is `[{ date: <tomorrow>, time: '09:00', firedAt: null }]`.
  - `fromItem(item: KnowledgeItemDto): KnowledgeFormValue`.
  - `toDraft(type, value): KnowledgeDraft`, and `toPatch(item, value): KnowledgePatch`, which sends only changed fields plus `updatedAt`. A fired time is sent with its id and its original `at`.
  - `KnowledgeFormErrors = Partial<Record<'title'|'url'|'file'|'body'|'times'|'recipients'|'form', string>>`.
  - `validateKnowledge(type, value, now = new Date()): KnowledgeFormErrors`.
  - `KnowledgeForm({ value, onChange, groupId, type, errors, files, onFilesChange, canChooseVisibility, visibilityLocked, authorId, autoFocusTitle }: {…})`.
    - It is controlled and never saves. The fields per type follow the spec's "New item" table:
      - a file picker (`FilesField max={1}`) first for files, and a URL field first for links;
      - the body uses `FormattedTextField`, labelled "Body" or "Description" by type;
      - note files use `FilesField max={10}`.
    - Picking a file fills an empty title with the name without its extension.
    - "Visible to" is a two-pill segmented control (`role="radiogroup"`). It shows only when `canChooseVisibility`, and is disabled with a hint when `visibilityLocked`.
  - `ReminderTimesField({ value, onChange, errors })`:
    - each time is a row of native `date` and `time` inputs;
    - unfired rows have Remove, and fired rows are read-only and muted with "sent";
    - "+ Add time" is hidden at 20 rows;
    - `errors: Record<number, string>` marks rows, including "This time has passed. Pick a later one."
  - `localToIso(date: string, time: string): string` and `isoToLocal(iso): { date; time }` use the browser `Date`.
  - `RecipientsField({ groupId, value, onChange, authorId, adminsOnly })` is a `PeopleSelect` over the group people (admins only when `adminsOnly`), with `fixedIds={[authorId]}` and `max={50}`.

- [ ] **Step 0:** Invoke `frontend-design:frontend-design` (the form per type, the segmented control and the times rows).
- [ ] **Step 1: Write the failing tests.**
  - `knowledge-form.test.tsx`:
    - `fields per type in order`: a file item has the file first, and a link has the URL first;
    - `picking a file fills an empty title without extension and keeps a typed one`;
    - `visibility control only for admins`;
    - `locked visibility is disabled with the hint`;
    - `validateKnowledge: required title, http(s) url, file item needs one file, reminder needs a time a minute ahead`;
    - `toPatch sends a fired time with its original at`.
  - `reminder-times-field.test.tsx`:
    - `fired rows are read-only and cannot be removed`;
    - `Add time hides at 20`;
    - `localToIso round-trips`.
  - `recipients-field.test.tsx`:
    - `the author chip is fixed`;
    - `admins-only lists admins only`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/web exec vitest run src/features/knowledge/knowledge-form.test.tsx src/features/reminders`. Expected: FAIL.
- [ ] **Step 3: Implement** the code above.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit.** Commit message: `feat(knowledge): knowledge form and reminder fields`. There is no docs change beyond the locales; the design tokens are covered in Task 10.

---

### Task 10: The detail dialog (view, create, edit, delete) and `ReminderPanel`

Depends on: Task 8, Task 9

**Files:**
- Create:
  - `apps/web/src/features/knowledge/knowledge-dialog.tsx`, `knowledge-dialog.test.tsx`;
  - `apps/web/src/features/knowledge/knowledge-view.tsx`;
  - `apps/web/src/features/reminders/reminder-panel.tsx`, `reminder-panel.test.tsx`.
- Modify: the `detail` section of `knowledge/locales`, and the `panel` section of `reminders/locales`.
- Docs: `docs/design/tokens.md` (the knowledge dialog on `SheetDialog`, `ReminderPanel`)

**Interfaces:**
- Consumes:
  - `SheetDialog`, `SheetDialogTitle` and `PanelHeader` with `compactBelow={641}` (Task 2);
  - `KnowledgeForm`, `fromItem`, `toDraft`, `toPatch` and `validateKnowledge` (Task 9);
  - the queries and mutations (Task 8);
  - `MessageBody`, `FileChip`, `ImagePreview`, `PanelNotice`, `DropdownMenu` and `useSession`.
- Produces:
  - `KnowledgeDialog({ target, onClose, onUnavailable }: { target: { mode: 'view'; id: string } | { mode: 'create'; type: KnowledgeType; groupId: string }; onClose: () => void; onUnavailable: () => void })`.
    - View mode fetches `knowledgeItemQuery(id)`. A 404 calls `onUnavailable`.
    - The header has Close or Back, plus Edit and More → Delete when `item.canEdit`.
    - The body follows the spec's Detail section per type.
    - Edit swaps in `KnowledgeForm`, with a sticky footer of "Save changes" and "Cancel".
    - Unsaved changes ask "Discard your changes?" inline.
    - A 409 shows "Changed by someone else. Reload".
    - Delete asks inline in a `bg-secondary` bar.
    - Create mode has a "Create" / "Cancel" footer, and asks "Discard this draft?" only when something was typed.
    - Server errors map to fields: `invalid_url` → url, `reminder_in_past` → times, `invalid_recipient` → recipients, other errors → form.
    - After a save it writes the item into `['knowledge','item',id]` and invalidates the `['knowledge']` lists.
  - `ReminderPanel({ prefix, subjectId, set, authorId, onChanged }: { prefix: string; subjectId: string; set: ReminderSetDto; authorId: string; onChanged: () => void })`.
    - Upcoming times show with a `CalendarLeaf`, and fired times are muted with "sent".
    - Recipients show as avatars and names, author first.
    - "Remind me" is a toggle pill with `aria-pressed`. It is disabled for the author, with the hint "You created this reminder".
    - "Add to calendar" is an `<a href={reminderCalendarUrl(…)} download>`. It renders as a disabled button reading "No upcoming reminders" when nothing is upcoming.
    - Phase 19 reuses it with `prefix="tasks"`.

- [ ] **Step 0:** Invoke `frontend-design:frontend-design` (the dialog per type at 720 px and as a phone sheet, and the reminder block).
- [ ] **Step 1: Write the failing tests.**
  - `knowledge-dialog.test.tsx`:
    - `view shows the note body rendered and its files`;
    - `file item shows a full-width download chip`;
    - `link shows the URL with Open link for screen readers`;
    - `Edit and More only when canEdit`;
    - `edit, save sends the patch and returns to view`;
    - `409 shows the reload notice`;
    - `delete asks inline and calls deleteKnowledge`;
    - `create posts the draft and closes with the new id`;
    - `closing an untouched draft does not ask`;
    - `404 calls onUnavailable`;
    - `reminder_in_past marks the times field`.
  - `reminder-panel.test.tsx`:
    - `Remind me toggles subscribe/unsubscribe`;
    - `author's toggle is on and disabled with the hint`;
    - `Add to calendar is disabled with no upcoming time and links to calendar.ics otherwise`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/web exec vitest run src/features/knowledge/knowledge-dialog.test.tsx src/features/reminders/reminder-panel.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the code above.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Docs, then commit.** Commit message: `feat(knowledge): detail dialog and reminder panel`.

---

### Task 11: The Knowledge tab

Depends on: Task 10

**Files:**
- Create in `apps/web/src/features/knowledge/`:
  - `knowledge-tab.tsx`, `knowledge-tab.test.tsx`;
  - `new-item-menu.tsx`;
  - `use-knowledge-events.ts`, `use-knowledge-events.test.tsx`;
  - `knowledge-cache.ts`, `knowledge-cache.test.ts`.
- Modify:
  - `apps/web/src/router.tsx` (`groupKnowledgeRoute`);
  - `apps/web/src/features/groups/group-tabs.tsx`: add the `knowledge` pill between Tasks and Members, and `'knowledge'` in `GroupTabBadges`;
  - the eager locales (`group.tabs.knowledge`: "Knowledge" / "Znalosti");
  - the `tab` and `newMenu` sections of `knowledge/locales`.
- Docs: `docs/product/knowledge-base.md` (the tab, built), `docs/product/groups.md`

**Interfaces:**
- Consumes:
  - `KnowledgeList`, `KnowledgeRow` and the API (Task 8), and `KnowledgeDialog` (Task 10);
  - `ActionSheet`, `DropdownMenu`, `Input`, `useMediaQuery` and `useUpdateSearch`;
  - `useGroupRoomJoins`, `getSocket` and `loadNamespace`.
- Produces:
  - The route `path: 'knowledge'` under `groupRoute`:
    - `validateSearch` gives `{ type?: KnowledgeType; q?: string; k?: string; kind?: KnowledgeType }`. Create mode is `?k=new&kind=<type>`, and `type` stays the list filter;
    - `loader: () => Promise.all([loadNamespace('knowledge'), loadNamespace('reminders'), loadNamespace('forms')])`;
    - the component is `lazyRouteComponent(() => import('@/features/knowledge/knowledge-tab'), 'KnowledgeTab')`.
  - `KnowledgeTab()`:
    - the header, the type pills (the group tabs' pill style) and the search input (300 ms debounce, applied from 2 characters);
    - the list, and the spec's empty states;
    - the dialog from `?k`. When `onUnavailable` fires, it shows the notice "This item is no longer available." and removes `k`.
  - `NewItemMenu({ onPick }: { onPick: (type: KnowledgeType) => void })` is a dropdown from 641 px and an `ActionSheet` below, with four rows and their help lines.
  - `upsertSummary(data: InfiniteData<KnowledgePage>, item): InfiniteData<KnowledgePage>` and `removeSummary(data, id)` (in `knowledge-cache.ts`). An upsert puts a new item first and replaces an existing one in place.
  - `useKnowledgeEvents(groupId: string, filter: { type?; q? }, openId: string | undefined, onOpenGone: () => void): void`. It behaves like `useBoardEvents`:
    - an upsert when the item matches the type filter and no search is active;
    - an invalidate when a search is active;
    - a drop for another type;
    - on `item_deleted`, a removal, plus `onOpenGone` when the id is the one that is open;
    - a refetch of the first page after every later rejoin.

- [ ] **Step 0:** Invoke `frontend-design:frontend-design` (the tab header, pills, search and new menu at 1280 px and 390 px).
- [ ] **Step 1: Write the failing tests.**
  - `knowledge-cache.test.ts`: `upsert puts new first and replaces in place`, and `remove`.
  - `use-knowledge-events.test.tsx`:
    - `socket upsert adds the item`;
    - `another type is dropped`;
    - `with a search the list is invalidated`;
    - `item_deleted removes it`;
    - `an open item deleted by a socket event closes with the notice`.
  - `knowledge-tab.test.tsx`:
    - `type pill writes ?type`;
    - `search writes ?q after 300 ms and only from 2 characters`;
    - `New → Reminder opens the create dialog with ?k=new&kind=reminder`;
    - `?k=<id> opens the detail and Close removes k`;
    - `empty and no-match states`;
    - `the tab pill sits between Tasks and Members`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/web exec vitest run src/features/knowledge src/features/groups`. Expected: FAIL.
- [ ] **Step 3: Implement** the route, the tab, the menu, the cache helpers and the events hook.
- [ ] **Step 4: Run the tests again,** then `pnpm --filter @spolu/web build`. Expected: PASS, and the build lists a separate `knowledge-tab` chunk.
- [ ] **Step 5: Docs, then commit.** Commit message: `feat(knowledge): knowledge tab with live updates`.

---

### Task 12: The global knowledge list and `ClientFilter`

Depends on: Task 10

**Files:**
- Create:
  - `apps/web/src/features/knowledge/knowledge-page.tsx`, `knowledge-page.test.tsx`;
  - `apps/web/src/components/client-filter.tsx`, `client-filter.test.tsx`.
- Modify:
  - `apps/web/src/router.tsx` (`knowledgeRoute` at `/knowledge`, an admin guard like `/admins`);
  - `apps/web/src/components/app-header.tsx`: "Knowledge" before "Groups", for admins;
  - `apps/web/src/features/auth/user-menu.tsx`: listed first on phones;
  - the eager locales (`nav.knowledge`);
  - the `global` and `clientFilter` sections of `knowledge/locales`.
- Docs: `docs/product/knowledge-base.md` (the global list, built), `docs/design/tokens.md` (`ClientFilter`)

**Interfaces:**
- Consumes:
  - `groupsQuery` (`GroupSummary[]`; after Phase 18 it carries `managedByMe`, which this task does not read);
  - `knowledgeScopeQuery`, `globalKnowledgeQuery`, `KnowledgeList` and `KnowledgeDialog`;
  - `SheetDialog` (the phone sheet), the Radix popover and `useMediaQuery`.
- Produces:
  - `ClientFilter({ groups, managedIds, value, onChange }: { groups: { id: string; name: string; logoUrl: string | null }[]; managedIds: string[] | null; value: string[] | null; onChange: (next: string[] | null) => void })`. A `value` of null means the default scope.
    - The pill reads "Clients: All", "Clients: My clients (n)" or "Clients: n selected".
    - It is a popover from 641 px and a `SheetDialog` below.
    - It has a find field. With `managedIds` it shows two sections, "Managed by you" and "Other clients"; with null it shows one list headed "Clients".
    - The buttons are "Only my clients" (hidden when `managedIds` is null), "All clients" and "Done".
    - Chips under the bar can be removed, and managed chips carry a 6 px ink dot.
    - When `managedIds` is `[]` it shows the hint "You don't manage any clients yet. Showing all clients."
    - It is built for reuse by the Phase 20 global board.
  - The route `/knowledge`:
    - `validateSearch` gives `{ clients?: string; type?: KnowledgeType; q?: string; k?: string }`;
    - `beforeLoad` rejects non-admins with `notFound()`;
    - its loader loads the `knowledge`, `reminders` and `forms` namespaces;
    - the component is the lazy `KnowledgePage`.
  - `KnowledgePage()`:
    - the client filter, a type menu (All types, Notes, Files, Links, Reminders), search, and the list with `showGroup`;
    - the dialog from `?k`;
    - `refetchOnWindowFocus: true` and no socket events.
    - It reads the last explicit `clients` from `localStorage['spolu.knowledge.clients']` on a visit without parameters, and writes it on change. Every storage access is wrapped in try/catch.

- [ ] **Step 0:** Invoke `frontend-design:frontend-design` (the filter bar, popover, chips and phone sheet).
- [ ] **Step 1: Write the failing tests.**
  - `client-filter.test.tsx`:
    - `two sections when managed ids exist, one list when null`;
    - `find filters both sections`;
    - `managed chips carry the dot`;
    - `Only my clients and All clients`;
    - `no-managed hint`.
  - `knowledge-page.test.tsx`:
    - `?clients restores the selection`;
    - `without parameters the stored selection is restored`;
    - `storage that throws is ignored`;
    - `type menu writes ?type`;
    - `rows show the group`;
    - `clients cannot open /knowledge` (not found).
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/web exec vitest run src/components/client-filter.test.tsx src/features/knowledge/knowledge-page.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the code above.
- [ ] **Step 4: Run the tests again,** then `pnpm --filter @spolu/web build`. Expected: PASS, with a separate `knowledge-page` chunk.
- [ ] **Step 5: Docs, then commit.** Commit message: `feat(knowledge): global knowledge list with client filter`.

---

### Task 13: E2E, eager budget check and phase docs

Depends on: Task 6, Task 7, Task 11, Task 12

**Files:**
- Create: `e2e/knowledge.spec.ts`, `e2e/db.ts`
- Docs:
  - `docs/architecture/performance.md`: the lazy chunks, the lazy namespaces, and the measured eager size before and after;
  - `docs/architecture/overview.md`: the knowledge and reminders modules, and `pg_trgm`;
  - `docs/glossary.md`: knowledge item, reminder set, recipient, subscribe;
  - `docs/roadmap.md`: Phase 17 marked done (local);
  - `docs/product/reminders.md`: status built.

**Interfaces:**
- Consumes:
  - Phase 6's `e2e/push-log.ts` (`fakeSubscription`, `waitForPush`);
  - `logInWithCode`, and the group and invite setup of `e2e/chat.spec.ts`.
- Produces: `e2e/db.ts` with `withDb<T>(fn: (sql) => Promise<T>): Promise<T>`. It uses the server package's `postgres` through `createRequire`, as `create-db.mjs` does, against `DATABASE_URL` (a name that must contain "e2e").

- [ ] **Step 1: Write the tests** in `knowledge.spec.ts`, with two browser contexts (the superadmin and a client who joined by invite):
  - `admins-only note with a file is invisible to the client and its file URL is 404`;
  - `client's link item appears live for the admin and opens the URL in a new tab`;
  - `reminder push reaches the client`:
    1. the admin creates a reminder for 2 minutes ahead with the client as a recipient;
    2. the client subscribes a `fakeSubscription()`;
    3. the test moves the time into the past with `withDb` (`update reminder_times set at = now() - interval '1 second' where set_id = …`);
    4. `waitForPush(endpoint, p => p.url.includes('?k='), 90_000)` resolves, while the every-minute cron fires (`test.setTimeout(150_000)`).
  - `the .ics download parses to one VEVENT per upcoming time`;
  - `global list filters by client and type and finds the file item by a diacritics-free fragment of its file name`;
  - `phone viewport: the detail is a full-screen sheet and every control is at least 44 px` (390×844, a bounding-box check of every button, link and input in the dialog).
- [ ] **Step 2: Run them.** Run `pnpm test:e2e -- e2e/knowledge.spec.ts`. Expected: PASS. Any failure here is fixed in the task that owns the code, not in the test.
- [ ] **Step 3: Measure the eager size.** Run `pnpm --filter @spolu/web build`, and gzip (level 9) the scripts `index.html` loads, as `performance.md` describes. Expected: at most 0.5 kB gzip above the number recorded before this phase, and under 200 kB. Record both numbers.
- [ ] **Step 4: Run the full gate.** Run `bash scripts/ci.sh`. Expected: PASS.
- [ ] **Step 5: Docs, then commit.** Commit message: `test(e2e): knowledge base and reminders; phase 17 docs`.

---

## Self-review notes

- **Spec coverage:**
  - the tables and the migration: Task 1;
  - the files flag: Task 5;
  - the policy: Task 5, plus the HTTP 404/403 checks in Task 7;
  - search and the ADR: Task 5;
  - the scope seam: Task 5 (service) and Task 7 (endpoint);
  - the realtime events and the admins room: Task 7;
  - the reminders service and `.ics`: Task 3;
  - the fire job: Task 6;
  - the notification kind, push and email: Task 4;
  - the shared moves: Task 2;
  - the form: Task 9;
  - the rows: Task 8;
  - the dialog and `ReminderPanel`: Task 10;
  - the tab, the new menu and the live updates: Task 11;
  - the global list and `ClientFilter`: Task 12;
  - e2e, the budget and the remaining docs: Task 13;
  - `listUpcomingForUser`: Task 3, shaped as Phase 20's `UpcomingReminder`.
- **Deviations from the spec**, each recorded here so the reviewer checks them on purpose:
  - Off does not block `reminder.due` (the brief's ruling).
  - The Phase 18 helper is named `managedGroupIds` (the brief's ruling).
  - Create mode is `?k=new&kind=<type>`, because `type` is already the list filter.
  - An unchanged fired time is accepted in an edit (Review Focus).
  - Moving the knowledge item to admins-only prunes the non-admin recipients.
  - `PanelHeader` gains `compactBelow`, and `FormattedTextField` gains `label`/`editLabel`, so the "unchanged" moves stay generic.
  - The moved fields read from a lazy `forms` namespace.
