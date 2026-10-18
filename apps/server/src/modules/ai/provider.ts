/**
 * What the server tells the AI about one message or one ticket (only text and names leave the
 * server). For a ticket, `text` is its subject and body.
 */
export type SplitRequest = {
  source: 'message' | 'ticket';
  text: string;
  quoted: string | null;
  files: { id: string; name: string }[];
  people: { id: string; name: string }[];
  /** YYYY-MM-DD, Europe/Bratislava. */
  today: string;
  /** Ticket only: area, programme, file link names; context the cards never repeat. */
  details: { label: string; value: string }[];
  /** Ticket only: its chat, oldest first, the newest `CONVERSATION_MAX` messages. */
  conversation: { author: string; text: string }[];
  /**
   * Server only, never put into the prompt: the people the texts mention (shown to the AI as
   * `@Name`), so a card's "@Name" becomes a mention again.
   */
  mentions?: { id: string; name: string }[];
};

/** One card as the AI returned it, before `sanitizeProposals`. */
export type RawTask = {
  title: string;
  description: string;
  assigneeIds: string[];
  fileIds: string[];
  deadline: string | null;
  urgent: boolean;
  /** One web address copied from the text (kept only when the text has it); absent = none. */
  link?: string | null;
};

export type SplitResult = {
  tasks: RawTask[];
  usage: { promptTokens: number; completionTokens: number } | null;
};

/** Turns one message into raw task cards. Implementations: OpenAI, and a fake for dev and e2e. */
export interface TaskSplitProvider {
  split(request: SplitRequest, signal: AbortSignal): Promise<SplitResult>;
}

/** Any provider failure, abort included (route: 502 ai_failed). Never carries the API key. */
export class AiFailedError extends Error {
  constructor(message = 'AI call failed', options?: ErrorOptions) {
    super(message, options);
    this.name = 'AiFailedError';
  }
}

/** The call ran out of time (route: 502 ai_failed, logged as `timeout`). */
export class AiTimeoutError extends AiFailedError {
  constructor() {
    super('AI call timed out');
    this.name = 'AiTimeoutError';
  }
}
