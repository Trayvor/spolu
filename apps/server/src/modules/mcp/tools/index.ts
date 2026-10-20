import { aiTools } from './ai.js';
import { auditTools } from './audit.js';
import { bulkTools } from './bulk.js';
import { chatTools } from './chat.js';
import type { ToolDef } from './define.js';
import { fileTools } from './files.js';
import { financeTools } from './finance.js';
import { homeTools } from './home.js';
import { knowledgeTools } from './knowledge.js';
import { peopleTools } from './people.js';
import { projectTools } from './projects.js';
import { reminderTools } from './reminders.js';
import { searchTools } from './search.js';
import { settingsTools } from './settings.js';
import { taskTools } from './tasks.js';
import { teamsTools } from './teams.js';
import { ticketTools } from './tickets.js';
import { weeklySummaryTools } from './weekly.js';

/** Every MCP tool, in the order `tools/list` shows them (spec §5). */
export const ALL_TOOLS: readonly ToolDef[] = [
  ...searchTools,
  ...peopleTools,
  ...chatTools,
  ...taskTools,
  ...ticketTools,
  ...knowledgeTools,
  ...projectTools,
  ...reminderTools,
  ...teamsTools,
  ...aiTools,
  ...homeTools,
  ...bulkTools,
  ...weeklySummaryTools,
  ...auditTools,
  ...settingsTools,
  ...fileTools,
  ...financeTools,
];

export const TOOLS_BY_NAME: ReadonlyMap<string, ToolDef> = new Map(
  ALL_TOOLS.map((tool) => [tool.name, tool]),
);
