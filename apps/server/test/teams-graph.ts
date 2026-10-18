import { randomUUID } from 'node:crypto';
import type { TeamsConfig } from '../src/infra/config/config.js';

// Teams T1 tests: a fake of the Microsoft Graph endpoints Help calls, behind a `fetch`. It keeps
// users, online meetings and transcripts in memory and records every call.

export const TENANT = '11111111-2222-4333-8444-555555555555';
export const OTHER_TENANT = '99999999-2222-4333-8444-555555555555';
export const CLIENT_ID = '66666666-7777-4888-9999-000000000000';

export const teamsConfig = (): TeamsConfig => ({
  tenantId: TENANT,
  clientId: CLIENT_ID,
  credential: { kind: 'secret', secret: 'test-secret' },
});

export type FakeUser = { id: string; email: string; displayName: string };
export type FakeMeeting = {
  id: string;
  joinWebUrl: string;
  joinMeetingId: string;
  organizerId: string;
  tenantId: string;
  subject: string;
  startDateTime: string;
  endDateTime: string;
  /** Graph leaves the organizer out of the meeting's participants. */
  omitOrganizer?: boolean;
};
export type FakeTranscript = { id: string; createdDateTime: string; content: string };
export type GraphCall = { method: string; url: string; body: unknown; accept: string | null };

export type FakeGraph = {
  fetch: typeof fetch;
  calls: GraphCall[];
  users: FakeUser[];
  meetings: FakeMeeting[];
  transcripts: Map<string, FakeTranscript[]>;
  /** Entra ids the application access policy / RBAC scope covers (the organizers group). */
  inGroup: Set<string>;
  /** The created events' bodies. */
  events: { organizerId: string; body: Record<string, unknown>; id: string; iCalUId: string }[];
  /** Answers every transcript call with 403 GraphAccessToTranscriptsDisabled. */
  transcriptsDisabled: boolean;
  /** Every call fails without an answer, as `fetch` does when the network is down. */
  networkDown: boolean;
  addUser(email: string, name: string, inGroup?: boolean): FakeUser;
  /** A meeting made in Teams by `organizer` (classic link with Tid/Oid). */
  addMeeting(organizer: FakeUser, over?: Partial<FakeMeeting>): FakeMeeting;
  addTranscript(meetingId: string, createdAt: Date, content: string): FakeTranscript;
  callsTo(fragment: string, method?: string): GraphCall[];
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const graphError = (status: number, code: string, inner?: string) =>
  json(status, {
    error: { code, message: 'x', ...(inner ? { innerError: { code: inner } } : {}) },
  });

export function classicLink(meetingKey: string, tenantId: string, organizerId: string): string {
  const context = encodeURIComponent(JSON.stringify({ Tid: tenantId, Oid: organizerId }));
  return `https://teams.microsoft.com/l/meetup-join/19%3ameeting_${meetingKey}%40thread.v2/0?context=${context}`;
}

export function createFakeGraph(): FakeGraph {
  const graph: FakeGraph = {
    calls: [],
    users: [],
    meetings: [],
    transcripts: new Map(),
    inGroup: new Set(),
    events: [],
    transcriptsDisabled: false,
    networkDown: false,
    fetch: undefined as unknown as typeof fetch,
    addUser(email, name, inGroup = true) {
      const u = { id: randomUUID(), email: email.toLowerCase(), displayName: name };
      graph.users.push(u);
      if (inGroup) graph.inGroup.add(u.id);
      return u;
    },
    addMeeting(organizer, over = {}) {
      const key = randomUUID().replaceAll('-', '');
      const start = new Date(Date.now() + 3_600_000);
      const m: FakeMeeting = {
        id: `MSo${key}`,
        joinWebUrl: classicLink(key, TENANT, organizer.id),
        joinMeetingId: String(Math.floor(1e11 + Math.random() * 8e11)),
        organizerId: organizer.id,
        tenantId: TENANT,
        subject: 'Made in Teams',
        startDateTime: start.toISOString(),
        endDateTime: new Date(start.getTime() + 45 * 60_000).toISOString(),
        ...over,
      };
      graph.meetings.push(m);
      return m;
    },
    addTranscript(meetingId, createdAt, content) {
      const t = { id: `tr-${randomUUID()}`, createdDateTime: createdAt.toISOString(), content };
      graph.transcripts.set(meetingId, [...(graph.transcripts.get(meetingId) ?? []), t]);
      return t;
    },
    callsTo(fragment, method) {
      return graph.calls.filter(
        (c) => c.url.includes(fragment) && (method === undefined || c.method === method),
      );
    },
  };

  const userOf = (key: string) =>
    graph.users.find((u) => u.id === key || u.email === decodeURIComponent(key).toLowerCase());

  graph.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const raw = typeof init?.body === 'string' ? init.body : null;
    let body: unknown = raw;
    if (raw && headers.get('content-type') === 'application/json') body = JSON.parse(raw);
    graph.calls.push({ method, url, body, accept: headers.get('accept') });
    if (graph.networkDown) throw new TypeError('fetch failed');

    if (url.startsWith('https://login.microsoftonline.com/')) {
      return json(200, { access_token: `token-${randomUUID()}`, expires_in: 3599 });
    }
    if (headers.get('authorization')?.startsWith('Bearer token-') !== true) {
      return graphError(401, 'InvalidAuthenticationToken');
    }
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.replace(/^\/v1\.0/, ''));
    let m: RegExpExecArray | null;

    if ((m = /^\/users\/([^/]+)$/.exec(path)) && method === 'GET') {
      const user = userOf(m[1]!);
      if (!user) return graphError(404, 'Request_ResourceNotFound');
      return json(200, {
        id: user.id,
        displayName: user.displayName,
        userPrincipalName: user.email,
      });
    }
    if ((m = /^\/users\/([^/]+)\/events$/.exec(path)) && method === 'POST') {
      const user = userOf(m[1]!);
      if (!user) return graphError(404, 'ErrorInvalidUser');
      if (!graph.inGroup.has(user.id)) return graphError(403, 'ErrorAccessDenied');
      const key = randomUUID().replaceAll('-', '');
      const event = {
        organizerId: user.id,
        body: body as Record<string, unknown>,
        id: `ev-${key}`,
        iCalUId: `ical-${key}`,
      };
      graph.events.push(event);
      const b = body as { subject: string; start: { dateTime: string }; end: { dateTime: string } };
      const meeting = graph.addMeeting(user, {
        subject: b.subject,
        startDateTime: `${b.start.dateTime}Z`,
        endDateTime: `${b.end.dateTime}Z`,
      });
      return json(201, {
        id: event.id,
        iCalUId: event.iCalUId,
        onlineMeeting: { joinUrl: meeting.joinWebUrl },
      });
    }
    if ((m = /^\/users\/([^/]+)\/onlineMeetings$/.exec(path)) && method === 'GET') {
      const user = userOf(m[1]!);
      if (!user) return graphError(404, 'NotFound');
      if (!graph.inGroup.has(user.id)) return graphError(403, 'Forbidden');
      const filter = u.searchParams.get('$filter') ?? '';
      const value = /'(.*)'$/.exec(filter)?.[1]?.replace(/''/g, "'") ?? '';
      const byUrl = filter.startsWith('JoinWebUrl eq');
      const found = graph.meetings.filter(
        (x) =>
          x.organizerId === user.id && (byUrl ? x.joinWebUrl === value : x.joinMeetingId === value),
      );
      return json(200, {
        value: found.map((x) => ({
          id: x.id,
          joinWebUrl: x.joinWebUrl,
          subject: x.subject,
          startDateTime: x.startDateTime,
          endDateTime: x.endDateTime,
          participants: x.omitOrganizer
            ? {}
            : { organizer: { identity: { user: { id: x.organizerId, tenantId: x.tenantId } } } },
        })),
      });
    }
    if ((m = /^\/users\/([^/]+)\/onlineMeetings\/([^/]+)$/.exec(path)) && method === 'PATCH') {
      return json(200, { id: m[2] });
    }
    if ((m = /^\/users\/([^/]+)\/onlineMeetings\/([^/]+)\/transcripts$/.exec(path))) {
      if (graph.transcriptsDisabled)
        return graphError(403, 'Forbidden', 'GraphAccessToTranscriptsDisabled');
      const list = graph.transcripts.get(m[2]!) ?? [];
      return json(200, {
        value: list.map((t) => ({ id: t.id, createdDateTime: t.createdDateTime })),
      });
    }
    if (
      (m = /^\/users\/([^/]+)\/onlineMeetings\/([^/]+)\/transcripts\/([^/]+)\/content$/.exec(path))
    ) {
      const t = (graph.transcripts.get(m[2]!) ?? []).find((x) => x.id === m![3]);
      if (!t) return graphError(404, 'NotFound');
      return new Response(t.content, { status: 200, headers: { 'content-type': 'text/vtt' } });
    }
    return graphError(400, `unexpected ${method} ${path}`);
  }) as typeof fetch;
  return graph;
}

export const vtt = (lines: [string, string][]) =>
  [
    'WEBVTT',
    '',
    ...lines.flatMap(([who, text], i) => [
      `00:00:${String(i * 5).padStart(2, '0')}.000 --> 00:00:${String(i * 5 + 4).padStart(2, '0')}.000`,
      `<v ${who}>${text}</v>`,
      '',
    ]),
  ].join('\n');
