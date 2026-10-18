import { queryOptions } from '@tanstack/react-query';
import {
  PublicMeetingSchema,
  TeamsInviteeOptionListSchema,
  TeamsMeetingStateSchema,
  type TeamsCreateBody,
  type TeamsMeetingState,
} from '@spolu/shared';
import { ApiError, apiGet, apiSend } from '@/lib/api';

// Teams T1: the admins' Teams block of a knowledge meeting and the public calendar page.
// Lazy: only those two chunks import this.

const enc = encodeURIComponent;
const base = (itemId: string) => `/knowledge/${enc(itemId)}/teams`;

/** The Teams state of a meeting; null when Teams is off or hidden for the viewer (404). */
export const teamsStateQuery = (itemId: string) =>
  queryOptions({
    queryKey: ['teams', itemId],
    queryFn: async (): Promise<TeamsMeetingState | null> => {
      const res = await fetch(`/api${base(itemId)}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (res.status === 404) return null;
      const body: unknown = await res.json().catch(() => undefined);
      if (!res.ok) throw new ApiError(`GET teams failed (HTTP ${res.status})`, res.status, body);
      return TeamsMeetingStateSchema.parse(body);
    },
    retry: false,
  });

export const inviteeOptionsQuery = (itemId: string) =>
  queryOptions({
    queryKey: ['teams', itemId, 'people'],
    queryFn: () => apiGet(`${base(itemId)}/people`, TeamsInviteeOptionListSchema),
    staleTime: 60_000,
  });

export const createTeamsMeeting = (itemId: string, body: Partial<TeamsCreateBody>) =>
  apiSend('POST', `${base(itemId)}/meeting`, body, TeamsMeetingStateSchema);

export const connectTeamsMeeting = (itemId: string, url: string) =>
  apiSend('POST', `${base(itemId)}/connect`, { url }, TeamsMeetingStateSchema);

export const checkTeamsMeeting = (itemId: string, replace: boolean) =>
  apiSend('POST', `${base(itemId)}/check`, { replace }, TeamsMeetingStateSchema);

export const disconnectTeamsMeeting = (itemId: string) => apiSend('DELETE', base(itemId));

/** The public page's meeting; 404 means the link is not valid (any more). */
export const publicMeetingQuery = (token: string) =>
  queryOptions({
    queryKey: ['public-meeting', token],
    queryFn: () => apiGet(`/public/meetings/${enc(token)}`, PublicMeetingSchema),
    retry: false,
    staleTime: Infinity,
  });
