import type { Config } from '../../infra/config/config.js';
import { createFakeProvider } from './fake-provider.js';
import {
  createFakeMeetingSummary,
  createOpenAiMeetingSummary,
  type MeetingSummaryProvider,
} from './meeting-summary.js';
import { createOpenAiProvider } from './openai-provider.js';
import type { TaskSplitProvider } from './provider.js';
import {
  createFakeTextTools,
  createOpenAiTextTools,
  type TextToolsProvider,
} from './text-tools.js';
import {
  createFakeTicketDraft,
  createOpenAiTicketDraft,
  type TicketDraftProvider,
} from './ticket-draft.js';
import {
  createElevenLabsTranscription,
  createFakeTranscription,
  createOpenAiTranscription,
  type TranscriptionProvider,
} from './transcription.js';

/** The configured task split provider, or null when AI is off (no OpenAI key). */
export function createAiProvider(config: Config['ai']): TaskSplitProvider | null {
  if (config === null) return null;
  if (config.provider === 'fake') return createFakeProvider();
  return createOpenAiProvider({ apiKey: config.apiKey, model: config.model });
}

/** The meeting summary AI (Phase 30): the task split's model and key; null when AI is off. */
export function createMeetingSummaryProvider(config: Config['ai']): MeetingSummaryProvider | null {
  if (config === null) return null;
  if (config.provider === 'fake') return createFakeMeetingSummary();
  return createOpenAiMeetingSummary({ apiKey: config.apiKey, model: config.model });
}

/**
 * The ticket reply draft ("Navrhnúť odpoveď", 2026-10-19): the task split's model and key (it
 * needs more reasoning than the composer's rewrites); null when AI is off.
 */
export function createTicketDraftProvider(config: Config['ai']): TicketDraftProvider | null {
  if (config === null) return null;
  if (config.provider === 'fake') return createFakeTicketDraft();
  return createOpenAiTicketDraft({ apiKey: config.apiKey, model: config.model });
}

/** The meeting transcription provider (`TRANSCRIPTION_PROVIDER`); null when it is off. */
export function createTranscriptionProvider(
  config: Config['transcription'],
): TranscriptionProvider | null {
  if (config === null) return null;
  if (config.provider === 'fake') return createFakeTranscription();
  if (config.provider === 'elevenlabs') {
    return createElevenLabsTranscription({ apiKey: config.apiKey, model: config.model });
  }
  return createOpenAiTranscription({ apiKey: config.apiKey, model: config.model });
}

/** The chat composer's AI text tools (Phase 28, `OPENAI_TEXT_MODEL`); null when AI is off. */
export function createTextToolsProvider(config: Config['textAi']): TextToolsProvider | null {
  if (config === null) return null;
  if (config.provider === 'fake') return createFakeTextTools();
  return createOpenAiTextTools({
    apiKey: config.apiKey,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
  });
}
