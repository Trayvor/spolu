import { z } from 'zod';
import { TeamsCreateBodySchema } from '@spolu/shared';
import type { ApiCaller } from '../call.js';
import {
  defineTool,
  fromApi,
  idArg,
  invalidArguments,
  type ToolDef,
  type ToolOutcome,
} from './define.js';

const meetingInput = z.object({
  itemId: idArg('meeting (knowledge item)'),
  durationMinutes: z.number().int().min(15).max(480).optional(),
  attendees: z
    .array(z.object({ email: z.string().max(254), name: z.string().max(200).optional() }))
    .max(100)
    .optional()
    .describe('Who gets an Outlook invitation (list_teams_invitees offers the client’s people)'),
  recordAutomatically: z.boolean().optional().describe('Record and transcribe (default true)'),
});

/** Creates through the route; `following` (the series) is the tool's, never the caller's. */
async function create(
  api: ApiCaller,
  args: z.output<typeof meetingInput>,
  following: boolean,
): Promise<ToolOutcome> {
  const { itemId, ...rest } = args;
  const body = { ...rest, following };
  const checked = TeamsCreateBodySchema.safeParse(body);
  if (!checked.success) return invalidArguments(checked.error);
  return fromApi(await api('POST', `/api/knowledge/${itemId}/teams/meeting`, { body }));
}

/**
 * Microsoft Teams for a knowledge meeting (call), managers only and only where Teams is set up
 * (else 404). Creating a meeting sends real Outlook invitations from Microsoft.
 */
export const teamsTools: ToolDef[] = [
  defineTool({
    name: 'get_meeting_teams',
    title: 'Get a meeting’s Teams link',
    description:
      'The Teams side of a meeting (a knowledge item of type meeting): the join link, organizer, duration, recording, the transcript import state, the public invitation page, and for a recurring call whether later calls get Teams meetings too. `link: null`: no Teams meeting yet.',
    input: z.object({ itemId: idArg('meeting (knowledge item)') }),
    run: async ({ api }, { itemId }) => fromApi(await api('GET', `/api/knowledge/${itemId}/teams`)),
  }),
  defineTool({
    name: 'list_teams_invitees',
    title: 'List people to invite to Teams',
    description: 'The people of the meeting’s client (its clients and managers) with their emails.',
    input: z.object({ itemId: idArg('meeting (knowledge item)') }),
    run: async ({ api }, { itemId }) =>
      fromApi(await api('GET', `/api/knowledge/${itemId}/teams/people`)),
  }),
  defineTool({
    name: 'create_teams_meeting',
    title: 'Create a Teams meeting',
    description:
      'Creates a Microsoft Teams meeting for the meeting item, organized by the user, and SENDS OUTLOOK INVITATIONS to every `attendees` email at once (nobody is invited unless listed). Duration in minutes (default 60); recorded and transcribed by default. The transcript is imported after the call.',
    input: meetingInput,
    write: true,
    target: ({ itemId }) => itemId,
    run: async ({ api }, args) => create(api, args, false),
  }),
  defineTool({
    name: 'create_teams_series',
    title: 'Create Teams meetings for a call series',
    description:
      'For a recurring call: creates the Teams meeting of this call and, from now on, one for each later call of the series, organized by the user; each SENDS OUTLOOK INVITATIONS to every `attendees` email. Stopping it for the following calls stays in the app.',
    input: meetingInput,
    write: true,
    target: ({ itemId }) => itemId,
    run: async ({ api }, args) => create(api, args, true),
  }),
];
