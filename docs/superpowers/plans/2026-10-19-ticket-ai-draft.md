# Ticket reply draft with AI ("Navrhnúť odpoveď") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins get a "Navrhnúť odpoveď" button in a ticket's chat that returns an AI-drafted reply built from the ticket, its chat, shareable knowledge of the same client and similar resolved tickets of any client (another client's identity masked), with cited sources; the admin inserts, edits and sends it by hand.

**Architecture:** One synchronous, write-free route `POST /api/tickets/:id/ai-draft` in the `ai` module. Retrieval goes through exported service functions of `knowledge`, `tickets` and `chat` (pg_trgm `ILIKE` on existing indexes, no migration, no embeddings). A new `TicketDraftProvider` (OpenAI Chat Completions with a strict JSON schema through `fetch`, plus a fake) uses `config.ai`. The web button and dialog are one lazy chunk with a lazy `ticketDraft` namespace, mounted in the ticket chat's composer through a new `Conversation` prop.

**Tech Stack:** Fastify, Drizzle + PostgreSQL 17 (pg_trgm), zod, Vitest, React + TanStack Query, i18next lazy namespaces, Playwright.

**Spec:** [docs/superpowers/specs/2026-10-19-ticket-ai-draft-design.md](../specs/2026-10-19-ticket-ai-draft-design.md)

**When:** implementation starts after the current phases are done. The final e2e pass over all seven 2026-10-19 features runs after all seven are implemented; this plan's own e2e (Task 10) runs alone as usual.

**Branch:** `feat/ticket-ai-draft` from a fresh `origin/main`; one PR. No migration (if the owner answers open question 3 with "yes", add `00XX_ticket_ai_draft` as a separate task). ADR placeholder: ADR-XXXX.

## Global Constraints

- Admins only: `canDraftTicketReply(actor) = isAdmin(actor)`, checked before the ticket lookup (403 `forbidden`).
- Nothing is written, sent, pushed over sockets or notified by the draft route.
- Knowledge only from the ticket's group and admin-group items that `shareableItemCards(db, ticketGroupId, ids)` keeps; never another client's knowledge item; never `visibility = 'admins'` items or items in admins-only folders.
- Similar tickets from **all clients** (owner decision 2026-10-19), masked before sending: another client's requester name, email, phone, the client's name and its people's names → `[meno]` / `[klient]` / `[e-mail]` / `[telefón]`; the reply never quotes another client's identity (`sanitizeDraft` guard).
- Knowledge types used: `note`, `file`, `link`. At most 5 items, 3 similar tickets (status `resolved`, any group, the ticket's own client first on equal score, not the ticket itself), 5 admin messages per similar ticket.
- Terms: at most 8, words of 4+ characters, cut to 6 characters, stop words dropped.
- Limits: ticket body ≤ 4 000; 30 newest messages, each ≤ 1 500, all ≤ 12 000; knowledge text ≤ 3 000 each; similar ticket body head ≤ 1 000, answer ≤ 1 000; instructions ≤ 1 000; user message ≤ 40 000 characters; reply ≤ 6 000; `max_completion_tokens` 6 000; timeout 60 000 ms.
- Rate limits: per admin 5/minute (`config.aiBurstLimits.ticketDraftPerMinute` override) and 60/day sliding; installation 500/day sliding.
- Model: `config.ai` (`OPENAI_MODEL`, default `gpt-5-mini`); no new environment variable. `AI_PROVIDER=fake` → fake draft.
- Output sanitizing: remove `<@…>` tokens and the words `@all`, `@channel`, `@here`; keep only `sourceIds` that were given, each once, in the model's order.
- Masking and redaction of similar tickets: `maskIdentities` first (full names and name parts of 3+ letters → `[meno]`, the group name → `[klient]`, whole words, case- and diacritics-insensitive), then `redactContacts` (emails → `[e-mail]`, phone numbers of 7+ digits with optional `+`, spaces, `/`, `-` → `[telefón]`); requester names, emails and phones of similar tickets never sent.
- Log line `'ai ticket draft'` with `{ ai: { userId, ticketId, sources, durationMs, outcome, usage } }`; never the texts.
- UI texts only in the lazy namespace `ticketDraft`, all nine locales (sk source; it/sl formal register: Lei, vikanje). Nothing in the eager `locales/<code>.json`.
- Initial JS grows by ≤ 0.2 kB gzip (performance.md "How to check").
- Server query count per draft ≤ 11; EXPLAIN on the `home` volume: no Seq Scan on `knowledge_items`, `tickets`, `messages`.

## Review Focus

- A ticket without a client (`groupId` null): knowledge only from admin-group shareable items; similar tickets of any client, all masked (Task 6 test `ticket without a client uses only shareable admin-group items`).
- Another client's identity leaking: into the request (Task 6 test `another client's ticket is an example but its identity is masked`) or into the reply (Task 5 test `sanitizeDraft masks another client's identity`).
- A ticket whose text yields no terms (e.g. "???" or only short words): no retrieval queries, a draft from the ticket alone, `sources: []` (Task 6 test `no terms means no sources`).
- The model citing an id it was not given, or the same id twice (Task 5 test `sanitizeDraft drops unknown and duplicate source ids`).
- The draft containing a mention token or `@all` that would notify people on send (Task 5 test `sanitizeDraft strips mentions`).
- Inserting the draft over an existing composer text must be undoable and the button must say "Nahradiť text správy" (Task 9 test `replaces a non-empty draft with the replace label`).

---

### Task 1: Shared schema, AI status flag and the policy

**Files:**

- Create: `packages/shared/src/ticket-draft.ts`
- Modify: `packages/shared/src/index.ts` (export it), `packages/shared/src/task-split.ts` (`AiStatusSchema` gains `ticketDraft: z.boolean()`)
- Modify: `apps/server/src/modules/tickets/policy.ts`
- Test: `packages/shared/src/ticket-draft.test.ts`, `apps/server/src/modules/tickets/policy.test.ts`

**Interfaces:**

- Produces: `TICKET_DRAFT_INSTRUCTIONS_MAX = 1000`, `TICKET_DRAFT_REPLY_MAX = 6000`, `TicketDraftRequestSchema`, `TicketDraftSourceSchema`, `TicketDraftSchema`, types `TicketDraftRequest`, `TicketDraftSource`, `TicketDraft` (shapes exactly as spec §7); `canDraftTicketReply(actor: SessionUser): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
// ticket-draft.test.ts
it('defaults instructions to an empty string and caps them at 1000', () => {
  expect(TicketDraftRequestSchema.parse({})).toEqual({ instructions: '' });
  expect(TicketDraftRequestSchema.safeParse({ instructions: 'x'.repeat(1001) }).success).toBe(
    false,
  );
});
it('accepts both source kinds', () => {
  expect(
    TicketDraftSchema.parse({
      reply: 'Dobrý deň',
      sources: [
        { kind: 'knowledge', id: 'k1', type: 'note', title: 'Postup', fromAdminGroup: false },
        { kind: 'ticket', id: 't1', number: 98, subject: null },
      ],
    }).sources,
  ).toHaveLength(2);
});
// policy.test.ts
it('canDraftTicketReply: admins only', () => {
  expect(canDraftTicketReply(admin)).toBe(true);
  expect(canDraftTicketReply(client)).toBe(false);
});
```

- [ ] **Step 2: Run** `pnpm --filter @spolu/shared test ticket-draft` and `pnpm --filter @spolu/server test tickets/policy` — Expected: FAIL (not defined).
- [ ] **Step 3: Implement** the schemas (comment: own module so the web bundles it with the lazy dialog), the `ticketDraft` flag, and `canDraftTicketReply` with a doc comment naming the spec.
- [ ] **Step 4: Run** the same commands — Expected: PASS. Fix the `/ai/status` route type error later in Task 7 (temporarily return `ticketDraft: false` in `routes.ts` so typecheck passes).
- [ ] **Step 5: Commit** `feat(tickets): ticket draft schema and policy`.

### Task 2: Terms and redaction (pure helpers)

**Files:**

- Create: `apps/server/src/modules/ai/draft-terms.ts`
- Test: `apps/server/src/modules/ai/draft-terms.test.ts`

**Interfaces:**

- Consumes: `normalizeSearch` from `infra/text/search.ts`.
- Produces: `draftTerms(texts: string[]): string[]`, `redactContacts(text: string): string`, `maskIdentities(text: string, identities: { names: string[]; clients: string[] }): string`, `DRAFT_TERMS_MAX = 8`.

- [ ] **Step 1: Write the failing tests**

```ts
it('stems Slovak words to six characters and strips diacritics', () => {
  expect(draftTerms(['Rozpočet projektu', 'zmena rozpočtu'])).toEqual([
    'rozpoc',
    'projek',
    'zmena',
  ]);
});
it('drops short words and stop words, keeps at most 8, most frequent first', () => {
  const terms = draftTerms([
    'a ako je to s tým, alebo ktorý',
    'žiadosť žiadosť platba faktúra dotácia zmluva termín výzva príloha audit',
  ]);
  expect(terms[0]).toBe('ziados');
  expect(terms).toHaveLength(8);
  expect(terms).not.toContain('alebo');
});
it('returns no terms for punctuation only', () => expect(draftTerms(['??? !!'])).toEqual([]));
it('redacts emails and phone numbers', () => {
  expect(redactContacts('Píšte na jan.novak@firma.sk alebo +421 905 123 456.')).toBe(
    'Píšte na [e-mail] alebo [telefón].',
  );
});
it('keeps years and short numbers', () =>
  expect(redactContacts('Výzva 2026, bod 12')).toBe('Výzva 2026, bod 12'));
it('masks full names, name parts and the client name, ignoring case and diacritics', () => {
  expect(
    maskIdentities('Pán Novák z obce Horna Lehota, Ján NOVAK píše', {
      names: ['Ján Novák'],
      clients: ['Obec Horná Lehota'],
    }),
  ).toBe('Pán [meno] z obce [klient], [meno] [meno] píše');
});
it('does not mask inside other words', () =>
  expect(maskIdentities('Novákovci, Janko', { names: ['Ján Novák'], clients: [] })).toBe(
    'Novákovci, Janko',
  ));
```

- [ ] **Step 2: Run** `pnpm --filter @spolu/server test draft-terms` — Expected: FAIL.
- [ ] **Step 3: Implement.** Split `normalizeSearch(text)` on `/[^\p{L}\p{N}]+/u`; stop words: a `Set` of ~80 common sk/cs/en words of 4+ letters (`alebo`, `ktory`, `ktora`, `preto`, `pretoze`, `dobry`, `den`, `dakujem`, `prosim`, `mame`, `mate`, `bude`, `bolo`, `this`, `that`, `with`, `have`, `please`, `thanks`, …) checked before cutting; count by stem; sort by count desc, then original word length desc, then first appearance. Phone regex: `/\+?\d[\d \/-]{5,}\d/g` requiring 7+ digits in the match. `maskIdentities`: compare on `normalizeSearch` forms with `\p{L}`-aware word boundaries; replace client names before person names, longest first; a client name starting with a generic word (obec, mesto, občianske združenie, s.r.o. and similar, a short list) also masks its form without it ("Obec Horná Lehota" also masks "Horná Lehota").
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ai): draft terms, identity masking and contact redaction`.

### Task 3: Knowledge candidates for a draft

**Files:**

- Create: `apps/server/src/modules/knowledge/draft-sources.ts`
- Modify: `apps/server/src/modules/knowledge/service.ts` (re-export, as the module's other exports)
- Test: `apps/server/src/modules/knowledge/draft-sources.test.ts`

**Interfaces:**

- Consumes: `shareableItemCards(db, groupId, ids)` from `chat-items.ts`; `adminGroupId(db)`; `escapeLike`; `plainExcerpt` from `@spolu/shared`.
- Produces:

```ts
export type DraftKnowledgeItem = {
  id: string;
  type: 'note' | 'file' | 'link';
  title: string;
  text: string; // plain body ≤ 3000, + URL / file names
  fromAdminGroup: boolean;
};
export async function draftKnowledge(
  db: Db,
  input: { groupId: string | null; terms: string[]; limit: number },
): Promise<DraftKnowledgeItem[]>;
```

- [ ] **Step 1: Write the failing tests** (real test database; seed with `createItem`/`insertItem`, `ensureAdminGroup`):
  - `finds a public note of the ticket's group by a stemmed term` — note "Zmena rozpočtu" found with terms `['rozpoc']`.
  - `never returns another client's item` — the same note in group B, `groupId` A → `[]`.
  - `skips admins-only items and items in an admins-only folder`.
  - `includes a shareable admin-group item with fromAdminGroup true` and `skips an admin-group item in an admins-only folder`.
  - `ticket without a client uses only admin-group items` (`groupId: null`).
  - `skips meetings, reminders and chat files`.
  - `orders by the number of matching terms, then newest update, and keeps limit` — 7 matching items, `limit: 5` → 5, the two-term match first.
  - `returns [] without a query when terms are empty` (counting db: 0 queries).
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test draft-sources` — Expected: FAIL.
- [ ] **Step 3: Implement.** One candidates query (20 rows): `group_id in (…)`, `visibility = 'public'`, `type in ('note','file','link')`, `(ilike t1 or … tn)`, score `(ilike t1)::int + …`, `order by score desc, updated_at desc`; selects `body`, `url` and the file names through a `left join lateral (select string_agg(f.name, ', ') …)` on `knowledge_attachments`/`files`. Then `shareableItemCards(db, groupId ?? adminGroup, ids)` (for `groupId` null pass a sentinel that is neither a client nor the admin group, so only admin-group open items pass — write that as a tiny `isShareableInto`-based branch rather than a fake id if clearer), keep order, slice `limit`. Text: `plainExcerpt(body, () => undefined, 3000)` plus `URL: …` / `Súbory: …` lines.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(knowledge): draft sources by trigram terms`.

### Task 4: Similar resolved tickets and their team answers

**Files:**

- Create: `apps/server/src/modules/tickets/similar.ts`
- Modify: `apps/server/src/modules/chat/messages.ts` (add `teamRepliesOfTickets`), `apps/server/src/modules/groups/service.ts` (add `peopleNamesOfGroups`)
- Test: `apps/server/src/modules/tickets/similar.test.ts`, `apps/server/src/modules/chat/team-replies.test.ts`, `apps/server/src/modules/groups/people-names.test.ts`

**Interfaces:**

- Produces:

```ts
export type SimilarTicket = {
  id: string;
  number: number;
  subject: string | null;
  bodyHead: string; // bodyHead = left(body, 1000)
  groupId: string | null;
  groupName: string | null; // for masking only, never sent
  requesterName: string | null;
  requesterEmail: string | null;
  requesterPhone: string | null;
};
export async function similarResolvedTickets(
  db: Db,
  input: { ticketId: string; groupId: string | null; terms: string[]; limit: number },
): Promise<SimilarTicket[]>;
export async function peopleNamesOfGroups( // groups module, one query
  db: Db,
  groupIds: string[],
): Promise<Map<string, string[]>>;
export async function teamRepliesOfTickets(
  db: Db,
  ticketIds: string[],
  perTicket: number,
): Promise<Map<string, string[]>>; // ticketId → admin message bodies, oldest first
```

- [ ] **Step 1: Write the failing tests**
  - `similar: resolved tickets of every client, never the ticket itself` (a new and an in-progress match are skipped; a resolved match in group B is returned with `groupId` B, its group name and requester fields).
  - `similar: the ticket's own client first on an equal score`.
  - `similar: works for a ticket without a client` (`groupId: null`).
  - `similar: subject matches outrank body matches` (subject weight 2), then `resolved_at desc`; `limit: 3`.
  - `similar: [] without terms, no query`.
  - `team replies: only admins' non-deleted messages, newest 5 per ticket, oldest first` (a client's and a deleted admin message are absent; 7 admin messages → the last 5).
  - `team replies: one query for three tickets` (counting db: 1).
  - `people names: names of the people of each group, one query for two groups`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test similar team-replies` — Expected: FAIL.
- [ ] **Step 3: Implement.** Similar: `left join groups` for the name; `where status = 'resolved' and id <> $id and (subject ilike … or left(body, 200) ilike …)` (no group filter), score `2*(subject ilike t)::int + (left(body,200) ilike t)::int` summed, `order by score desc, (group_id is not distinct from $g) desc, resolved_at desc nulls last limit $n`. Team replies: `select ticket_id, body from (select c.ticket_id, m.body, m.created_at, row_number() over (partition by m.channel_id order by m.created_at desc) rn from messages m join channels c on c.id = m.channel_id join "user" u on u.id = m.author_id where c.ticket_id = any($ids) and m.deleted_at is null and u.role = 'admin') x where rn <= $n order by created_at`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tickets): similar resolved tickets and team answers`.

### Task 5: Provider, prompt and sanitizing

**Files:**

- Create: `apps/server/src/modules/ai/ticket-draft.ts`
- Modify: `apps/server/src/modules/ai/index.ts` (`createTicketDraftProvider(config: Config['ai']): TicketDraftProvider | null`), `apps/server/src/deps.ts` (`ticketDraft: TicketDraftProvider | null`), `apps/server/test/test-app.ts` (`overrides.ticketDraft`, default null), `apps/server/src/infra/config/config.ts` (`aiBurstLimits` gains `ticketDraftPerMinute`)
- Test: `apps/server/src/modules/ai/ticket-draft.test.ts`

**Interfaces:**

- Consumes: `AiFailedError`, `AiTimeoutError` (`provider.ts`), `withTimeout` (`text-tools.ts`), `redactContacts`, `maskIdentities` (Task 2).
- Produces:

```ts
export type TicketDraftRequest = {
  ticket: {
    number: number;
    subject: string | null;
    area: string | null;
    programme: string | null;
    status: string;
    requesterFirstName: string | null;
    body: string;
  };
  conversation: { author: string; role: 'team' | 'client'; text: string }[];
  knowledge: { id: string; type: string; title: string; text: string }[];
  similarTickets: { id: string; subject: string | null; body: string; answers: string[] }[];
  instructions: string;
  fallbackLanguage: string; // English language name, e.g. 'Slovak'
};
export type TicketDraftResult = {
  reply: string;
  sourceIds: string[];
  usage: { promptTokens: number; completionTokens: number } | null;
};
export interface TicketDraftProvider {
  draft(request: TicketDraftRequest, signal: AbortSignal): Promise<TicketDraftResult>;
}
export const TICKET_DRAFT_TIMEOUT_MS = 60_000;
export function systemPromptForDraft(fallbackLanguage: string): string;
export function buildDraftUserMessage(request: TicketDraftRequest): string; // JSON, ≤ 40 000 chars
export function sanitizeDraft(
  raw: { reply: string; sourceIds: string[] },
  givenIds: ReadonlySet<string>,
  otherClientIdentities?: { names: string[]; clients: string[] }, // replaced with […] in the reply
): { reply: string; sourceIds: string[] };
export function createOpenAiTicketDraft(options: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}): TicketDraftProvider;
export function createFakeTicketDraft(): TicketDraftProvider;
```

- [ ] **Step 1: Write the failing tests**

```ts
it('sanitizeDraft strips mentions', () => {
  expect(sanitizeDraft({ reply: 'Ahoj <@u1>, @all pozri', sourceIds: [] }, new Set()).reply).toBe('Ahoj , pozri');
});
it('sanitizeDraft drops unknown and duplicate source ids', () => {
  expect(sanitizeDraft({ reply: 'x', sourceIds: ['k1', 'zz', 'k1', 't1'] }, new Set(['k1', 't1'])).sourceIds).toEqual(['k1', 't1']);
});
it('sanitizeDraft masks another client\'s identity', () => {
  expect(sanitizeDraft({ reply: 'Ako sme riešili pre Obec Horná Lehota s pánom Novákom…', sourceIds: [] }, new Set(),
    { names: ['Ján Novák'], clients: ['Obec Horná Lehota'] }).reply).not.toMatch(/Lehota|Novák/);
});
it('sanitizeDraft cuts a long reply at a paragraph under 6000', () => {
  const r = sanitizeDraft({ reply: ('a'.repeat(4000) + '\n\n').repeat(2), sourceIds: [] }, new Set()).reply;
  expect(r.length).toBeLessThanOrEqual(6000); expect(r.endsWith('a')).toBe(true);
});
it('the user message stays under 40 000 and drops similar tickets before knowledge', () => {
  const msg = buildDraftUserMessage(hugeRequest());            // 3 similar × 30k, 5 knowledge × 3k
  expect(msg.length).toBeLessThanOrEqual(40_000);
  const parsed = JSON.parse(msg);
  expect(parsed.similarTickets.length).toBeLessThan(3); expect(parsed.knowledge).toHaveLength(5);
});
it('caps conversation messages at 1500 and the whole conversation at 12 000, oldest dropped', …);
it('the system prompt names the fallback language, the formal register and the data-not-instructions rule', () => {
  const p = systemPromptForDraft('Slovak');
  expect(p).toContain('Slovak'); expect(p).toMatch(/formal/i); expect(p).toMatch(/not instructions/i);
});
it('openai: sends a strict json_schema and maps the answer', async () => { /* fake fetch asserts model, response_format.json_schema.strict === true, max_completion_tokens 6000; returns content {"reply":"Dobrý deň","sourceIds":["k1"]} */ });
it('openai: a refusal or non-2xx becomes AiFailedError without the key in the message', …);
it('fake: quotes the subject and cites the first source', …);
```

- [ ] **Step 2: Run** `pnpm --filter @spolu/server test ai/ticket-draft` — Expected: FAIL.
- [ ] **Step 3: Implement** following `text-tools.ts` (Chat Completions through `fetch`, strict schema `{ reply: string, sourceIds: string[] }`, `CompletionSchema` with zod). The system prompt carries the rules of spec §6 verbatim in English. Trimming order in `buildDraftUserMessage`: per-field caps first, then while over 40 000 drop the last similar ticket, then the last knowledge item, then the oldest conversation message. Wire `deps.ticketDraft = createTicketDraftProvider(config.ai)`.
- [ ] **Step 4: Run** — Expected: PASS; `pnpm --filter @spolu/server typecheck` clean.
- [ ] **Step 5: Commit** `feat(ai): ticket draft provider and prompt`.

### Task 6: Context builder with the privacy rules

**Files:**

- Create: `apps/server/src/modules/ai/ticket-draft-context.ts`
- Test: `apps/server/src/modules/ai/ticket-draft-context.test.ts`

**Interfaces:**

- Consumes: `getTicketRow`, `similarResolvedTickets` (tickets); `getTicketChannel`, `listRecentMessages`, `teamRepliesOfTickets` (chat); `draftKnowledge` (knowledge); `getGroup`, `clientLanguages`, `peopleNamesOfGroups` (groups); `clientLanguageOf`, `languageName`; `draftTerms`, `redactContacts`, `maskIdentities`.
- Produces:

```ts
export type DraftContext = {
  request: TicketDraftRequest;
  sources: Map<string, TicketDraftSource>;
  otherClientIdentities: { names: string[]; clients: string[] }; // for the sanitizeDraft guard, never sent
};
export async function buildTicketDraftContext(
  db: Db,
  ticket: TicketRow,
  instructions: string,
): Promise<DraftContext>;
```

Conversation role: `team` for admins, else `client` (author names as in `claude-context.ts`). Terms from `[subject, body, newest client message]`. `fallbackLanguage`: `languageName(clientLanguageOf(group.egrantUrl, langs) ?? 'sk')`, `'Slovak'` without a group.

- [ ] **Step 1: Write the failing tests** (seed two client groups A and B with the same matching texts, the admin group with one shareable and one admins-only-folder item):
  - `uses knowledge of the ticket's client only` — `request.knowledge` ids ⊆ group A + shareable admin item; no knowledge id from B in `JSON.stringify(request)`.
  - `another client's ticket is an example but its identity is masked` — a resolved ticket of B is in `request.similarTickets`; B's group name, its requester's name, email and phone and the name of a B member written in a team answer are absent from `JSON.stringify(request)`, replaced by `[klient]`, `[meno]`, `[e-mail]`, `[telefón]`; `otherClientIdentities` holds them.
  - `never sends admins-only knowledge`.
  - `similar tickets carry no requester name, email or phone` — the similar ticket's `requesterEmail`/`requesterName` absent from the JSON, an email in its body appears as `[e-mail]`.
  - `ticket without a client uses only shareable admin-group items` — knowledge only from the admin group; similar tickets of any client, masked.
  - `no terms means no sources` — subject `"?"`, body `""` → `knowledge: []`, `similarTickets: []`, `sources.size === 0`.
  - `stays within 11 queries` (counting db).
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test ticket-draft-context` — Expected: FAIL.
- [ ] **Step 3: Implement**; run knowledge and similar-ticket queries in parallel (`Promise.all`), then one `peopleNamesOfGroups` for the other clients' groups, then mask.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ai): ticket draft context`.

### Task 7: The route, limits and the status flag

**Files:**

- Create: `apps/server/src/modules/ai/ticket-draft-routes.ts`
- Modify: `apps/server/src/app.ts` (register under `/api`), `apps/server/src/modules/ai/routes.ts` (`ticketDraft: deps.ticketDraft !== null`)
- Test: `apps/server/src/modules/ai/ticket-draft-routes.test.ts`

**Interfaces:**

- Consumes: Tasks 1, 5, 6; `createRateLimiter`, `createSlidingRateLimiter`.
- Produces: `ticketDraftRoutes: FastifyPluginAsync<{ deps: AppDeps }>`; `POST /api/tickets/:id/ai-draft` → `TicketDraft`.

- [ ] **Step 1: Write the failing tests** (`buildTestApp({ ticketDraft: capturingFake })`):
  - `returns the reply and the cited sources` — 200, `sources[0]` `{ kind: 'knowledge', … }` in the model's order.
  - `client and žiadateľ get 403 before the lookup` — also for a random id.
  - `404 for a missing ticket and a malformed id`.
  - `400 for instructions over 1000`.
  - `503 when the provider is off` and `/api/ai/status` → `ticketDraft: false`.
  - `502 on AiFailedError and AiTimeoutError` (logged outcome `failed` / `timeout`, via `logStream`; the log line has no reply text).
  - `429 after 5 per minute` (`config.aiBurstLimits.ticketDraftPerMinute: 2` → third call 429, provider called twice).
  - `never returns another client's identity` — the capturing fake echoes B's client name and requester name in its reply; the 200 body has neither.
  - `writes nothing` — counts of `messages` and `notifications` rows unchanged after a draft.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test ticket-draft-routes` — Expected: FAIL.
- [ ] **Step 3: Implement**: policy → body (`TicketDraftRequestSchema`) → `ID_RE` + `getTicketRow` → provider null → limits (minute, day, global `'all'` key) → context → `withTimeout(provider.draft, 60 000)` → `sanitizeDraft(…, new Set(sources.keys()), context.otherClientIdentities)` → map ids to `sources`. Log as spec §8.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ai): POST /api/tickets/:id/ai-draft`.

### Task 8: EXPLAIN checks

**Files:**

- Modify: `apps/server/src/modules/home/explain.test.ts` (new `describe`), and `apps/server/src/modules/home/test-volume.ts` only if its knowledge items lack `search_text` with words or its resolved tickets lack subjects (the template hash rebuilds automatically).

**Interfaces:**

- Consumes: the SQL of Tasks 3 and 4; export each as an `…Sql(input): SQL` builder next to its function so the test explains the very query.

- [ ] **Step 1: Write the test** `ticket draft retrieval uses indexes` — `expectIndexed(db, draftKnowledgeSql({ groupId, adminGroupId, terms: ['rozpoc','ziados','platba'] }), ['knowledge_items'], 20)`, the same for `similarResolvedTicketsSql` on `['tickets']` (20 ms) and `teamRepliesOfTicketsSql` on `['messages','channels']` (20 ms).
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test:explain` — Expected: PASS; if a Seq Scan shows, fix the query (not the test) and record the plan in `docs/architecture/performance.md`.
- [ ] **Step 3: Commit** `test(ai): explain the ticket draft retrieval`.

### Task 9: Web — button, dialog, composer slot, texts

Start with the `frontend-design` skill (project rule).

**Files:**

- Modify: `apps/web/src/features/chat/conversation.tsx` (prop `composerActions?: (draft: { getText(): string; setText(text: string): void }) => ReactNode`, passed as `extraActions` of the main composer, built from a `ComposerHandle` ref)
- Modify: `apps/web/src/features/tickets/ticket-chat.tsx` (admins: `composerActions` renders the lazy button)
- Create: `apps/web/src/features/ticket-draft/ticket-draft.tsx` (lazy entry: `TicketDraftButton` + dialog), `apps/web/src/features/ticket-draft/api.ts` (`postTicketDraft(ticketId, instructions, signal): Promise<TicketDraft>`), `apps/web/src/features/ticket-draft/index.tsx` (the `lazy(withNamespaces(['ticketDraft'], …))` wrapper, `null` for non-admins and when `aiStatus.ticketDraft` is false)
- Create: `apps/web/src/locales/ticketDraft/{sk,en,cs,sl,bg,et,it,hr,uk}.json` (keys of spec §9; sk exactly as spec §3)
- Test: `apps/web/src/features/ticket-draft/ticket-draft.test.tsx`, `apps/web/src/features/chat/conversation.test.tsx` (slot)

- [ ] **Step 1: Write the failing tests**
  - `hidden for a client` and `hidden when ticketDraft is off`.
  - `drafts and shows the sources` — stubbed fetch returns `{ reply: 'Dobrý deň, …', sources: [knowledge, ticket] }`; the dialog shows the reply, "Podklady", the item title and "#98".
  - `shows the no-sources warning` for `sources: []`.
  - `inserts into an empty composer` — "Vložiť do správy" calls `setText` with the reply and closes the dialog.
  - `replaces a non-empty draft with the replace label` — `getText()` returns "abc" → button "Nahradiť text správy".
  - `maps 429 and 503 to their messages`.
  - `closing the dialog aborts the request` (the `AbortSignal` is aborted).
  - Conversation: `renders composerActions before Send and passes working getText/setText`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web test ticket-draft conversation` — Expected: FAIL.
- [ ] **Step 3: Implement**; the dialog is the native dialog sheet of ADR 0020; the reply renders with the chat's Markdown renderer; knowledge sources open like a chat knowledge card, ticket sources link to `/tickets/$ticketId` (`target="_blank"`).
- [ ] **Step 4: Run** the tests, `pnpm --filter @spolu/web test locales` (all nine files have every key) and the bundle check of performance.md "How to check" — Expected: PASS; initial JS +≤ 0.2 kB.
- [ ] **Step 5: Commit** `feat(tickets): Navrhnúť odpoveď in the ticket chat`.

### Task 10: e2e and docs

**Files:**

- Create: `e2e/ticket-ai-draft.spec.ts`
- Create: `docs/decisions/ADR-XXXX-ai-draft-retrieval-with-trigrams.md` (orchestrator renumbers; add to `docs/decisions/README.md`)
- Modify (update-kb): `docs/product/tickets.md`, `docs/architecture/permissions.md` (`canDraftTicketReply`, the source rule), `docs/architecture/overview.md` (AI features list), `docs/architecture/performance.md` (queries, EXPLAIN, bundle numbers), `docs/glossary.md` ("Návrh odpovede"), `.env.example` comment near `OPENAI_MODEL` (also used by ticket drafts). Not `docs/roadmap.md` (the orchestrator links it).

- [ ] **Step 1: Write the e2e** `admin drafts a ticket reply from shared knowledge` (fake provider): an admin creates a public note "Zmena rozpočtu" in client A, opens a ticket of A with "rozpočtu" in the body, presses "Navrhnúť odpoveď", "Navrhnúť", sees the note under "Podklady", "Vložiť do správy", adds " Ďakujeme.", sends; a client of A sees the sent message; a client of A has no "Navrhnúť odpoveď" button. A second case `a resolved ticket of another client helps, masked`: a resolved ticket of client B with "rozpočtu" and B's requester name; the draft for A lists it under "Podklady" (admin view) and the inserted reply has no B name.
- [ ] **Step 2: Run** `pnpm test:e2e e2e/ticket-ai-draft.spec.ts` (alone, never concurrently with another e2e or `ci.sh`) — Expected: PASS.
- [ ] **Step 3: Write the ADR and the docs**, run `update-kb`, `pnpm exec prettier --check` on changed docs, `bash scripts/check-docs.sh origin/main`.
- [ ] **Step 4: Run** `bash scripts/ci.sh` (serially, by the merger) — Expected: green. The final e2e pass across all seven 2026-10-19 features is run by the orchestrator after all seven are implemented.
- [ ] **Step 5: Commit** `test(e2e): ticket AI draft; docs` and open the PR.
