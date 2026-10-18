import {
  type SessionUser,
  type TaskDetailDto,
  type TaskProposal,
  type TasksFromMeeting,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { listPickablePeople } from '../groups/service.js';
import {
  createTasksFromSource,
  listTasksFromMeeting,
  type TaskDeps,
} from '../tasks/task-service.js';
import { KnowledgeNotFoundError } from './errors.js';
import { meetingFor } from './meeting-access.js';
import { actionItemsLeft, actionItemTitle, getMeetingRow, parseSummary } from './meeting-store.js';
import { normalizeSearch } from '../../infra/text/search.js';

// Phase 30: a meeting's action items → the task review dialog → cards on the group's board.

const dateText = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Bratislava',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The person a suggested name means: a unique match of the whole name, else a unique match of
 * the first name (case and diacritics ignored); null when none or several match.
 */
export function matchPerson(
  name: string | null,
  people: { id: string; name: string }[],
): string | null {
  if (!name) return null;
  const wanted = normalizeSearch(name);
  if (wanted === '') return null;
  const full = people.filter((p) => normalizeSearch(p.name) === wanted);
  if (full.length === 1) return full[0]!.id;
  if (full.length > 1) return null;
  const firstOf = (value: string) => normalizeSearch(value).split(' ')[0] ?? '';
  const first = people.filter((p) => firstOf(p.name) === firstOf(wanted));
  return first.length === 1 ? first[0]!.id : null;
}

/**
 * The action items of a meeting's summary as task proposals (admins; no AI call): the text as
 * the title (cut to 200), and as the description when longer, with the meeting's title and date;
 * a named person of the group as the assignee; a said date as the deadline. An action item a task
 * made from this meeting already has the title of is left out (`actionItemsLeft`).
 */
export async function meetingTaskProposals(
  db: Db,
  actor: SessionUser,
  itemId: string,
): Promise<TaskProposal[]> {
  const item = await meetingFor(db, actor, itemId, 'admin');
  const row = await getMeetingRow(db, itemId);
  if (!row) throw new KnowledgeNotFoundError();
  const summary = parseSummary(row.summary);
  if (!summary || summary.actionItems.length === 0) return [];
  const [people, made] = await Promise.all([
    listPickablePeople(db, item.groupId),
    listTasksFromMeeting(db, itemId),
  ]);
  const left = actionItemsLeft(
    summary,
    made.map((t) => t.title),
  );
  const source = `${item.title}, ${dateText.format(row.startsAt)}`;
  return left.map((action) => {
    const title = actionItemTitle(action);
    const assignee = matchPerson(action.assignee, people);
    const description = [
      ...(title === action.text.trim() ? [] : [action.text.trim()]),
      ...(action.assignee && !assignee ? [`(${action.assignee})`] : []),
      `${source}`,
    ].join('\n\n');
    return {
      title,
      description,
      assigneeIds: assignee ? [assignee] : [],
      dueDate: action.deadline,
      urgent: false,
      messageFileIds: [],
      link: null,
    };
  });
}

/**
 * Creates the reviewed cards (admins) at the top of `bucketId` (absent: To do), all or none,
 * linked to the meeting (`source_meeting_id`).
 */
export async function createMeetingTasks(
  deps: TaskDeps,
  actor: SessionUser,
  itemId: string,
  input: TasksFromMeeting,
): Promise<{ groupId: string; tasks: TaskDetailDto[] }> {
  const item = await meetingFor(deps.db, actor, itemId, 'admin');
  const tasks = await createTasksFromSource(
    deps,
    actor,
    item.groupId,
    { tasks: input.tasks },
    { meetingId: item.id, fileIds: [], ...(input.bucketId ? { bucketId: input.bucketId } : {}) },
  );
  return { groupId: item.groupId, tasks };
}
