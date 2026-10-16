/** What the server tells the AI about one message (only text and names leave the server). */
export type SplitRequest = {
  text: string;
  quoted: string | null;
  files: { id: string; name: string }[];
  people: { id: string; name: string }[];
  /** YYYY-MM-DD, Europe/Bratislava. */
  today: string;
};

/** One card as the AI returned it, before `sanitizeProposals`. */
export type RawTask = {
  title: string;
  description: string;
  assigneeIds: string[];
  fileIds: string[];
  deadline: string | null;
  urgent: boolean;
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
