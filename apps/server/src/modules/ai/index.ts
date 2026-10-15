import type { Config } from '../../infra/config/config.js';
import { createFakeProvider } from './fake-provider.js';
import { createOpenAiProvider } from './openai-provider.js';
import type { TaskSplitProvider } from './provider.js';

/** The configured task split provider, or null when AI is off (no OpenAI key). */
export function createAiProvider(config: Config['ai']): TaskSplitProvider | null {
  if (config === null) return null;
  if (config.provider === 'fake') return createFakeProvider();
  return createOpenAiProvider({ apiKey: config.apiKey, model: config.model });
}
