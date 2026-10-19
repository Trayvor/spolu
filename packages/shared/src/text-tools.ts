import { z } from 'zod';
import { MESSAGE_MAX_LENGTH } from './chat.js';

// Phase 28 — the AI text tools and voice input of the chat composer.

export const AiTextActions = ['fix', 'formal', 'translate'] as const;
export type AiTextAction = (typeof AiTextActions)[number];

/** Translate to English or to the client's language (the server knows which language that is). */
export const AiTranslateTargets = ['en', 'client'] as const;
export type AiTranslateTarget = (typeof AiTranslateTargets)[number];

/** What the browser sends: only the text and the chosen action, never a prompt. */
export const AiTextBodySchema = z
  .object({
    action: z.enum(AiTextActions),
    target: z.enum(AiTranslateTargets).optional(),
    text: z.string().max(MESSAGE_MAX_LENGTH),
  })
  .refine((b) => b.text.trim() !== '', { path: ['text'] })
  .refine((b) => (b.action === 'translate') === (b.target !== undefined), { path: ['target'] });
export type AiTextBody = z.infer<typeof AiTextBodySchema>;

/** The rewritten text (`POST /channels/:id/ai-text`) or the transcript (`…/transcribe`). */
export const AiTextResultSchema = z.object({ text: z.string() });
export type AiTextResult = z.infer<typeof AiTextResultSchema>;

/** Which composer tools a channel offers its reader (`GET /channels/:id/ai-tools`). */
export const AiToolsInfoSchema = z.object({
  /** Fix mistakes and Make it formal. */
  text: z.boolean(),
  /**
   * Translate, only where the group's eGrant instance is not on a `.sk` domain. `clientLanguage`
   * is an ISO 639-1 code, or null when only English is offered.
   */
  translate: z.object({ clientLanguage: z.string().nullable() }).nullable(),
  /** Voice input (speech to text). */
  voice: z.boolean(),
  /**
   * 2026-10-19: messages written by someone else can be translated into the reader's own
   * language (`POST /messages/:id/translate`), for every reader of the channel. Sent only when
   * true: the group's eGrant instance is not on `.sk` and AI is on.
   */
  translateIncoming: z.literal(true).optional(),
});
export type AiToolsInfo = z.infer<typeof AiToolsInfoSchema>;

export const VOICE_LIMITS = {
  /** The recording stops by itself after this long. */
  maxSeconds: 300,
  /** The largest upload: 5 minutes of Opus at 32 kbit/s is ~1.2 MB, Safari's AAC more. */
  maxBytes: 8 * 1024 * 1024,
  /** The audio types the server accepts (the base type, without parameters). */
  types: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'],
} as const;

/**
 * A message or ticket description translated into the reader's profile language
 * (`POST /messages/:id/translate`, `POST /tickets/:id/translate`, 2026-10-19). `sourceLanguage`
 * is the ISO 639-1 code the model recognised (null when it could not tell); `unchanged` means the
 * text already was in `targetLanguage` and `text` is the original.
 */
export const IncomingTranslationSchema = z.object({
  text: z.string(),
  sourceLanguage: z.string().nullable(),
  targetLanguage: z.string(),
  unchanged: z.boolean(),
});
export type IncomingTranslation = z.infer<typeof IncomingTranslationSchema>;
