import { chatTools } from './chat.js';
import type { ToolDef } from './define.js';
import { fileTools } from './files.js';
import { financeTools } from './finance.js';
import { homeTools } from './home.js';
import { knowledgeTools } from './knowledge.js';
import { peopleTools } from './people.js';
import { projectTools } from './projects.js';
import { taskTools } from './tasks.js';
import { ticketTools } from './tickets.js';

/** Every MCP tool, in the order `tools/list` shows them (spec §5). */
export const ALL_TOOLS: readonly ToolDef[] = [
  ...peopleTools,
  ...chatTools,
  ...taskTools,
  ...ticketTools,
  ...knowledgeTools,
  ...projectTools,
  ...homeTools,
  ...fileTools,
  ...financeTools,
];

export const TOOLS_BY_NAME: ReadonlyMap<string, ToolDef> = new Map(
  ALL_TOOLS.map((tool) => [tool.name, tool]),
);
