# 0053 Retrieval for AI ticket drafts with pg_trgm, no embeddings

Date: 2026-10-19
Status: accepted

## Context
"Navrhnúť odpoveď" ([spec](../superpowers/specs/2026-10-19-ticket-ai-draft-design.md)) gives an admin an AI draft of a ticket reply. The AI needs the knowledge items the ticket's client may be shown and a few similar resolved tickets (of any client, owner decision 2026-10-19, masked before sending). Semantic retrieval would mean embeddings: the `pgvector` extension in the production image and in CI, an embedding job with a backfill on every knowledge and ticket change, a second paid API, and a re-embed whenever the model changes. An installation holds a few thousand items and tickets per client, trigram search already runs under 1 ms on 20 000 items ([ADR 0015](0015-knowledge-search-with-pg-trgm.md)), and the admin reviews every draft.

## Decision
- **Terms, not vectors.** `draftTerms` (`modules/ai/draft-terms.ts`) takes the ticket's subject, body and the requester's newest message, folds them like `normalizeSearch`, drops words under 4 characters and a short sk/cs/en stop-word list, cuts every word to its first 6 characters (a crude stem for Slovak inflection) and keeps the 8 most frequent.
- **Knowledge:** any term in the folded `knowledge_items.search_text` (`knowledge_items_search_idx`), public notes, files and links of the ticket's group and the admin group, scored by matching terms; then `shareableItemCards`, the rule of a knowledge card in a chat (`modules/knowledge/draft-sources.ts`).
- **Similar tickets:** resolved tickets of every client whose folded subject (`tickets_subject_fold_trgm_idx`, migration 0062) or folded body start (`tickets_body_head_fold_trgm_idx`, new in migration `0063_features_1019`: `spolu_fold(left(body, 200))`, trigram, `fastupdate = off`) holds a term; a subject match counts twice; the ticket's own client first on a tie (`modules/tickets/similar.ts`). The raw `tickets_body_head_trgm_idx` cannot serve the folded stems ("rozpoc" never matches "rozpočtu" in raw text).
- **Masking** of another client's identity (names, client names, emails, phones) happens on the server before the provider sees anything, and once more on the reply (`maskIdentities`, `redactContacts`, `guardIdentities`).
- No new dependency, no new extension, no new environment variable.

## Consequences
- Recall is "good, not perfect": synonyms and paraphrases are missed. Revisit (embeddings, or `pg_trgm` similarity ranking) when drafts often miss obvious items.
- One more GIN index on `tickets` (the third trigram one); writes of `body` pay for it, measured negligible at the template volumes.
- The EXPLAIN checks (`modules/ai/explain.test.ts`) keep the three retrieval queries off sequential scans of `knowledge_items`, `tickets` and `messages`.
