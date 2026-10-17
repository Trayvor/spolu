# Phase 28 — AI text tools and voice input (design)

Slice of [Phase 28](../../roadmap.md#phase-28--chat-editor-and-ai-text-tools): the AI text tools and voice input. The rich editor, reactions and knowledge attachments are built in parallel by other slices. The owner approved building this on 2026-10-17; the decisions taken here are listed at the end.

## What the user gets

In every chat composer (group chat, task chat, ticket chat; a new message and a thread reply) two buttons sit next to Send:

- **AI (sparkle)** opens a small menu: *Fix mistakes*, *Make it formal*, and — only in groups whose eGrant instance link is not on a `.sk` domain — *Translate to English* and *Translate to &lt;client's language&gt;*. The draft is sent to the server, the answer **replaces the draft** in the composer, and an *Undo* link brings back the text from before. Nothing is sent. While the call runs the button shows a spinner and is disabled; the menu's actions are disabled while the draft is empty. A failure or the rate limit shows a short toast and leaves the draft untouched. *Undo* is a small link next to the AI button, shown while the draft is still the AI's version.
- **Microphone** starts recording at once (the browser asks for permission the first time). While recording the composer shows a red dot, a timer (`0:42 / 5:00`), *Cancel* and *Stop*. Only the person stops it: tap the mic / *Stop* again; there is no cut-off on silence. At 5:00 the recording stops by itself (the length limit). The audio goes to the server, the transcript is **appended to the draft** (after a space or a new line), never sent. Cancel throws the recording away.

Who sees what:
- AI text tools: admins and the group's clients — the people who read the group (`canReadGroup`), the same rule as the task split. A žiadateľ in a ticket chat does not get them.
- Voice input: everyone who reads the channel, a žiadateľ included.
- The buttons show only when the server says the feature is on (`GET /api/channels/:id/ai-tools`, cached per channel for the session), so with AI or transcription off nothing appears.

## Server

New code in `modules/ai/`: `text-tools.ts` (provider interface, prompts, OpenAI and fake providers), `client-language.ts` (the translate target), `text-routes.ts` (routes). It reaches channels and groups only through their exported service and policy functions (`getChannel`, `actorReadsChannel`, `canReadGroup`, `getGroup`, `clientLanguages`).

Routes (all need a session):
- `GET /api/channels/:id/ai-tools` → `{ text: boolean, translate: { clientLanguage: string | null } | null, voice: boolean }`. 404 when the actor does not read the channel. `text` is false for a žiadateľ or with the text AI off; `translate` is null unless `text` and the group's instance is not `.sk`.
- `POST /api/channels/:id/ai-text` `{ action: 'fix' | 'formal' | 'translate', target?: 'en' | 'client', text }` → `{ text }`. The browser sends only the text and the action; the prompts live in the server. 404 unreadable channel, 403 žiadateľ, 400 bad body or `translate` where it is not offered (a `.sk` instance, or `client` with no client language), 429 rate limit, 503 off, 502 provider failure. Text is at most `MESSAGE_MAX_LENGTH`.
- `POST /api/channels/:id/transcribe` raw audio body (`audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg`, `audio/wav`) → `{ text }`. At most `VOICE_LIMITS.maxBytes` (8 MB: 5 minutes of 32 kbit/s Opus is about 1.2 MB, Safari's AAC is larger); 413 above it, 415 another type, 429, 503, 502. The audio is held in memory only for the call and never stored.

Rate limits (per user, in memory, ADR 0005): text tools 20 a minute and 300 a day; voice 10 a minute and 60 an hour. Every provider call is logged (`ai text tool` / `ai voice`: user, channel, action, duration, outcome, tokens), never the text.

### Model

`OPENAI_TEXT_MODEL`, default **`gpt-5.4-mini`** (OpenAI's current small fast model, March 2026; `gpt-5.4-nano` is cheaper but weaker on Slovak diacritics and tone), with `reasoning_effort` from `OPENAI_TEXT_REASONING_EFFORT` (default `low`; `off` omits the parameter for models without reasoning, e.g. `gpt-4.1-mini`). Chat Completions with a strict JSON schema `{ text }` through plain `fetch`, like the task split; a 30-second timeout. No streaming: the answers are one short message and the result replaces the draft at once, so streaming would add code for little. It uses `OPENAI_API_KEY` and `AI_PROVIDER` (fake for dev and e2e) like the task split.

### Prompts

One shared rule block: keep the language of the text (except Translate), keep every `@mention`, link, number, date, name, code and Markdown syntax exactly, never add facts, never answer or comment on the text, return only the result.
- **fix**: correct only punctuation (commas, full stops), diacritics, typos and obvious grammar slips; change nothing else (no rewording, no reordering, no formatting).
- **formal**: a professional, natural tone; not an email (no greeting or sign-off unless the text already has one); human wording, anglicisms allowed; spoken enumerations ("task one: …, task two: …", "po prvé … po druhé …") become a Markdown numbered list; run-on dictation is split into sentences and paragraphs; lists, steps and questions get list formatting where that reads better; meaning and facts never change.
- **translate**: translate into the target language (English, or the client's language by its English name), keeping tone and formatting.

### The client's language (owner decision asked for)

Taken in this order:
1. The **instance's top-level domain** when it names a country: `.cz` → Czech, `.si` → Slovenian, `.hr` → Croatian, `.bg` → Bulgarian, `.ee` → Estonian, `.it` → Italian, `.ua` → Ukrainian, `.pl` → Polish, `.hu` → Hungarian, `.at`/`.de` → German, `.ro` → Romanian, `.rs` → Serbian, `.lt`, `.lv`, `.fi`, `.fr`, `.es`, `.pt`, `.nl`, `.gr` (the model translates into any of them; they need not be UI languages).
2. Otherwise (`.eu`, `.com`, `.org`, …) the **most common profile language** of the group's active clients, ignoring `sk` (the default nobody chose) and `en` (already its own option).
3. Otherwise none: only *Translate to English* is shown.

The domain wins because profile languages default to `sk` and many clients never change them; a country domain is a reliable signal. The web shows the language's name with `Intl.DisplayNames` in the UI language, so no locale keys per language.

## Web

Self-contained features so the editor slice can rewire them: `features/chat/ai-tools/` (`AiTextButton`, `useAiTools`, `api.ts`) and `features/chat/voice-input/` (`VoiceButton`, `use-recorder.ts`). Both take `getText(): string` and `setText(text: string)` callbacks and the channel id; the composer passes them next to Send with a small diff (a new optional `channelId` prop, passed by the conversation and the thread panel; the edit composer gets no tools). Undo lives in the AI button (the text before the last AI change, until the draft changes again or is sent). `MediaRecorder` with Opus at 32 kbit/s where supported, else the browser's default (Safari: `audio/mp4`). No new dependency; the code is in the already lazy chat screens.

## Tests

- Server: prompts and parsing on a stub `fetch` (never the real API), the fake provider, the client-language rule, the routes (access matrix admin / client / žiadateľ / outsider, `.sk` vs other domains, 429, 503, 502, 413, 415) on the fake providers.
- Web: the AI button (menu, translate options, replace and undo, error) and the voice button (timer, stop, cancel, transcript appended) with a mocked `MediaRecorder`.
- e2e `e2e/ai-text-tools.spec.ts` with the fake providers (`AI_PROVIDER=fake`, `TRANSCRIPTION_PROVIDER=fake`) and Chromium's fake microphone.

## Owner decisions

1. Client's language: the instance's country domain first, then the clients' most common profile language (not `sk`/`en`), else only English. Please confirm.
2. AI text tools exclude the žiadateľ (same rule as the task split: admins and the group's clients); voice input includes everyone who reads the chat.
3. Model `gpt-5.4-mini` with low reasoning effort; no streaming.
4. Rate limits: text 20/min and 300/day per user; voice 10/min and 60/hour per user; 5 minutes per recording.
5. The transcript is appended to the draft (not replacing what was already typed); the AI result replaces the draft with undo.
6. No AI tools in the edit composer (editing a sent message) for now.
