# 0073: Test projects, flagged only by eGrant and left off the timeline by default

- Status: accepted
- Date: 2026-10-28

## Context

eGrant creates demo and trial projects in its instances. They reach Help through the project
endpoint like real ones and fill the client's timeline. The owner asked (2026-10-28) for a
"test project" flag that only eGrant sets, a visible "Test" label, and a timeline that leaves
test projects out unless people ask for them.

Every other field of a delivery after the first one becomes a pending "change from eGrant"
that people review, so nothing they see changes silently (Phase 33 part P3).

## Decision

- **A column, not a status:** `projects.is_test boolean not null default false` (migration
  0075). A test project is still active or archived; the flag is orthogonal.
- **eGrant owns it:** the project body gets an optional `test` boolean. A delivery that carries
  it sets the flag directly, on create and on update (also when it links a person's project by
  name, and when a stored inbox delivery is processed, since the inbox keeps the parsed body);
  it is never a pending change. A delivery without it leaves the flag. A stale delivery
  (older `sent_at`) changes nothing; a merged-in eGrant id's deliveries only propose and never
  set it. Help has no UI or API to change the flag.
- **Timeline filter on the server:** without `test=1`, "all" and "all except" add
  `and not p.is_test` to the events query (a filter on the already joined project row, no new
  index; the EXPLAIN check covers both variants). A project listed in `project=` is always
  shown, as an archived one is.
- **Web:** `isTest` is on the picker, the projects card rows and the project DTO. The filter
  panel lists active test projects in their own section (they behave like archived ones: ticking
  one makes an "only" list) and, when the client has any, offers "Show test projects"
  (`?test=1`, remembered with the other timeline filters), which makes them ordinary active
  projects.

## Consequences

- Test projects stay out of the way without hiding them: the card, the pickers and the sheet
  still show them, with a "Test" label.
- Notifications, tasks, tickets and finance treat test projects as any project; only the
  timeline's default differs. Another place that should hide them needs its own rule.
- Clearing the flag needs eGrant to send `"test": false`.
