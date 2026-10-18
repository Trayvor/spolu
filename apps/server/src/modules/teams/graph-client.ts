import { createPrivateKey, randomUUID, sign, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { TeamsConfig } from '../../infra/config/config.js';

// Teams T1: Microsoft Graph v1.0 over plain fetch (no Graph SDK, no MSAL; ADR 0036). App-only:
// the client-credentials grant with a client secret or a certificate-signed client assertion.
// The access token lives in memory only and is never logged.

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const LOGIN_BASE = 'https://login.microsoftonline.com';
/** Renew a token this long before it expires. */
const TOKEN_MARGIN_MS = 5 * 60_000;
/** A client assertion is valid this long. */
const ASSERTION_SECONDS = 10 * 60;
/** Retries of a 429 or 503 (each waits `Retry-After`, at most `MAX_RETRY_WAIT_MS`). */
const RETRIES = 2;
const MAX_RETRY_WAIT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * A Graph (or token endpoint) answer that was not a success: the HTTP status and the error code
 * (the inner code when Graph gives one, e.g. `GraphAccessToTranscriptsDisabled`). Never the body.
 */
export class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Microsoft Graph answered ${status} ${code}`);
    this.name = 'GraphError';
  }
}

export type GraphUser = { id: string; displayName: string | null; userPrincipalName: string };

export type GraphOnlineMeeting = {
  id: string;
  joinWebUrl: string;
  subject: string | null;
  startDateTime: string | null;
  endDateTime: string | null;
  /** The organizer's Entra object id and tenant, as Graph states them. */
  organizerId: string | null;
  organizerTenantId: string | null;
};

export type GraphEvent = { id: string; iCalUId: string | null; joinUrl: string | null };

export type GraphTranscript = { id: string; createdDateTime: string };

export type GraphEventInput = {
  subject: string;
  bodyHtml: string;
  start: Date;
  end: Date;
  attendees: { email: string; name?: string | undefined }[];
  /** Graph's idempotency key for the create: a retried POST does not make a second event. */
  transactionId: string;
};

/** What the teams module calls; tests pass a fake `fetch`. */
export interface TeamsGraph {
  getUser(emailOrId: string): Promise<GraphUser | null>;
  createEvent(organizerId: string, input: GraphEventInput): Promise<GraphEvent>;
  /** The online meeting of a join URL or meeting ID, as seen through `userId`; null when none. */
  findOnlineMeeting(
    userId: string,
    by: { joinWebUrl: string } | { joinMeetingId: string },
  ): Promise<GraphOnlineMeeting | null>;
  setRecordAutomatically(userId: string, meetingId: string, on: boolean): Promise<void>;
  listTranscripts(userId: string, meetingId: string): Promise<GraphTranscript[]>;
  /** WebVTT; falls back to the unattributed text format when speaker attribution is off. */
  transcriptContent(userId: string, meetingId: string, transcriptId: string): Promise<string>;
}

export type GraphClientOptions = {
  config: TeamsConfig;
  fetch?: typeof fetch;
  /** Tests: no real waiting on Retry-After. */
  sleep?: (ms: number) => Promise<void>;
  /** Tests: the clock for token expiry and assertions. */
  now?: () => number;
  /** Tests: the certificate's private key PEM instead of reading `keyPath`. */
  readKey?: (path: string) => Promise<string>;
};

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/** The private key block of a PEM file that may also hold the certificate. */
export function privateKeyFromPem(pem: string): KeyObject {
  const block =
    /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/.exec(
      pem,
    );
  if (!block) throw new Error('TEAMS_CERT_PATH holds no private key');
  return createPrivateKey(block[0]);
}

/**
 * The client assertion (a JWT signed RS256 with the certificate's key, `x5t` = the SHA-1
 * thumbprint) that Entra accepts instead of a client secret.
 */
export function clientAssertion(input: {
  tenantId: string;
  clientId: string;
  thumbprint: string;
  key: KeyObject;
  nowMs: number;
}): string {
  const now = Math.floor(input.nowMs / 1000);
  const header = { alg: 'RS256', typ: 'JWT', x5t: base64url(Buffer.from(input.thumbprint, 'hex')) };
  const payload = {
    aud: `${LOGIN_BASE}/${input.tenantId}/oauth2/v2.0/token`,
    iss: input.clientId,
    sub: input.clientId,
    jti: randomUUID(),
    nbf: now - 60,
    iat: now,
    exp: now + ASSERTION_SECONDS,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = sign('RSA-SHA256', Buffer.from(unsigned), input.key);
  return `${unsigned}.${base64url(signature)}`;
}

/** Graph's error code of a failed answer: the inner error code, else the outer one. */
async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?:
        string | { code?: string; innerError?: { code?: string }; innererror?: { code?: string } };
    };
    const error = body.error;
    if (typeof error === 'string') return error;
    return error?.innerError?.code ?? error?.innererror?.code ?? error?.code ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** `YYYY-MM-DDTHH:mm:ss.sss` in UTC (Graph's dateTimeTimeZone wants no offset). */
const graphDateTime = (date: Date) => date.toISOString().replace(/Z$/, '');

/** A single-quoted OData string literal. */
const odataString = (value: string) => `'${value.replace(/'/g, "''")}'`;

export function createGraphClient(options: GraphClientOptions): TeamsGraph {
  const { config } = options;
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const readKey = options.readKey ?? ((path: string) => readFile(path, 'utf8'));
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;
  let key: KeyObject | null = null;

  async function fetchToken(): Promise<string> {
    const form = new URLSearchParams({
      client_id: config.clientId,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const credential = config.credential;
    if (credential.kind === 'secret') {
      form.set('client_secret', credential.secret);
    } else {
      key ??= privateKeyFromPem(await readKey(credential.keyPath));
      form.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
      form.set(
        'client_assertion',
        clientAssertion({
          tenantId: config.tenantId,
          clientId: config.clientId,
          thumbprint: credential.thumbprint,
          key,
          nowMs: now(),
        }),
      );
    }
    const response = await doFetch(`${LOGIN_BASE}/${config.tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new GraphError(response.status, await errorCode(response));
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new GraphError(response.status, 'no_token');
    cached = {
      token: body.access_token,
      expiresAt: now() + (body.expires_in ?? 3600) * 1000 - TOKEN_MARGIN_MS,
    };
    return body.access_token;
  }

  /** A valid access token; concurrent callers share one request. */
  async function token(): Promise<string> {
    if (cached && cached.expiresAt > now()) return cached.token;
    pending ??= fetchToken().finally(() => (pending = null));
    return pending;
  }

  async function call(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    options: { body?: unknown; accept?: string } = {},
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const response = await doFetch(`${GRAPH_BASE}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${await token()}`,
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(options.accept ? { accept: options.accept } : {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 401 && attempt === 0) {
        cached = null; // revoked or rotated: one more try with a fresh token
        continue;
      }
      if ((response.status === 429 || response.status === 503) && attempt < RETRIES) {
        const seconds = Number(response.headers.get('retry-after'));
        await sleep(Math.min(MAX_RETRY_WAIT_MS, Number.isFinite(seconds) ? seconds * 1000 : 2000));
        continue;
      }
      if (!response.ok) throw new GraphError(response.status, await errorCode(response));
      return response;
    }
  }

  const json = async <T>(response: Response) => (await response.json()) as T;
  const user = (id: string) => `/users/${encodeURIComponent(id)}`;

  type RawMeeting = {
    id: string;
    joinWebUrl?: string;
    subject?: string | null;
    startDateTime?: string | null;
    endDateTime?: string | null;
    participants?: { organizer?: { identity?: { user?: { id?: string; tenantId?: string } } } };
  };

  return {
    async getUser(emailOrId) {
      try {
        const response = await call(
          'GET',
          `${user(emailOrId)}?$select=id,displayName,userPrincipalName`,
        );
        const body = await json<GraphUser>(response);
        return {
          id: body.id,
          displayName: body.displayName ?? null,
          userPrincipalName: body.userPrincipalName,
        };
      } catch (error) {
        if (error instanceof GraphError && error.status === 404) return null;
        throw error;
      }
    },

    async createEvent(organizerId, input) {
      const response = await call('POST', `${user(organizerId)}/events`, {
        body: {
          subject: input.subject,
          body: { contentType: 'HTML', content: input.bodyHtml },
          start: { dateTime: graphDateTime(input.start), timeZone: 'UTC' },
          end: { dateTime: graphDateTime(input.end), timeZone: 'UTC' },
          attendees: input.attendees.map((a) => ({
            emailAddress: { address: a.email, ...(a.name ? { name: a.name } : {}) },
            type: 'required',
          })),
          isOnlineMeeting: true,
          onlineMeetingProvider: 'teamsForBusiness',
          allowNewTimeProposals: false,
          transactionId: input.transactionId,
        },
      });
      const body = await json<{
        id: string;
        iCalUId?: string;
        onlineMeeting?: { joinUrl?: string } | null;
      }>(response);
      return {
        id: body.id,
        iCalUId: body.iCalUId ?? null,
        joinUrl: body.onlineMeeting?.joinUrl ?? null,
      };
    },

    async findOnlineMeeting(userId, by) {
      const filter =
        'joinWebUrl' in by
          ? `JoinWebUrl eq ${odataString(by.joinWebUrl)}`
          : `joinMeetingIdSettings/joinMeetingId eq ${odataString(by.joinMeetingId)}`;
      const response = await call(
        'GET',
        `${user(userId)}/onlineMeetings?$filter=${encodeURIComponent(filter)}`,
      );
      const body = await json<{ value?: RawMeeting[] }>(response);
      const meeting = body.value?.[0];
      if (!meeting) return null;
      const organizer = meeting.participants?.organizer?.identity?.user;
      return {
        id: meeting.id,
        joinWebUrl: meeting.joinWebUrl ?? ('joinWebUrl' in by ? by.joinWebUrl : ''),
        subject: meeting.subject ?? null,
        startDateTime: meeting.startDateTime ?? null,
        endDateTime: meeting.endDateTime ?? null,
        organizerId: organizer?.id?.toLowerCase() ?? null,
        organizerTenantId: organizer?.tenantId?.toLowerCase() ?? null,
      };
    },

    async setRecordAutomatically(userId, meetingId, on) {
      await call('PATCH', `${user(userId)}/onlineMeetings/${encodeURIComponent(meetingId)}`, {
        body: { recordAutomatically: on, allowTranscription: true },
      });
    },

    async listTranscripts(userId, meetingId) {
      const response = await call(
        'GET',
        `${user(userId)}/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts`,
      );
      const body = await json<{ value?: { id: string; createdDateTime: string }[] }>(response);
      return (body.value ?? []).map((t) => ({ id: t.id, createdDateTime: t.createdDateTime }));
    },

    async transcriptContent(userId, meetingId, transcriptId) {
      const path = `${user(userId)}/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts/${encodeURIComponent(transcriptId)}/content`;
      try {
        return await (await call('GET', path, { accept: 'text/vtt' })).text();
      } catch (error) {
        if (!(error instanceof GraphError) || error.code !== 'SpeakerAttributionNotAllowed') {
          throw error;
        }
        const plain = 'application/vnd.microsoft.graph.transcript+text';
        return (await call('GET', path, { accept: plain })).text();
      }
    },
  };
}
