import { z } from 'zod';

/** The text tools' `reasoning_effort`; `off` sends none. */
const REASONING_EFFORTS = ['off', 'none', 'minimal', 'low', 'medium'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

const base = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: z.url(),
  // A raw `%` in the password that is not percent-encoding (`p%zz`) cannot be decoded: name the
  // variable at startup instead of a bare URIError (2026-10-18).
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((v) => dbPassword(v) !== undefined),
  SUPERADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
  SUPERADMIN_NAME: z.string().trim().min(1).optional(),
  APP_SECRET: z.string().min(32),
  APP_VERSION: z.string().default('dev'),
  FILES_DIR: z.string().default('./data/files'),
  WEB_DIST_DIR: z.string().optional(),
  MAIL_FROM: z.string().min(1),
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z
    .string()
    .regex(/^(mailto:|https:)\S+$/, 'must start with mailto: or https:')
    .optional(),
  PUSH_PROVIDER: z.enum(['webpush', 'fake']).default('webpush'),
  PUSH_FAKE_FILE: z.string().min(1).optional(),
  PUSH_ALLOW_FAKE: z.enum(['1']).optional(),
  EMAIL_BATCH_DELAY_MS: z.coerce.number().int().min(0).default(600_000),
  LOGIN_CODES_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  JOIN_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  // `fake` is for local development and e2e only, never on a server: in production it needs
  // AI_ALLOW_FAKE=1 (set only by the e2e web server).
  AI_PROVIDER: z.enum(['openai', 'fake']).default('openai'),
  AI_ALLOW_FAKE: z.enum(['1']).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default('gpt-5-mini'),
  // Phase 28 — the chat composer's AI text tools: a fast, cheap model of their own.
  OPENAI_TEXT_MODEL: z.string().min(1).default('gpt-5.4-mini'),
  // `off` omits reasoning_effort (for models without reasoning, such as gpt-4.1-mini).
  OPENAI_TEXT_REASONING_EFFORT: z.enum(REASONING_EFFORTS).default('low'),
  // Phase 30 — meeting transcription. `openai` uses OPENAI_API_KEY (off without it);
  // `elevenlabs` needs ELEVENLABS_API_KEY; `fake` is refused in production like AI_PROVIDER.
  TRANSCRIPTION_PROVIDER: z.enum(['openai', 'elevenlabs', 'fake']).default('openai'),
  OPENAI_TRANSCRIBE_MODEL: z.string().min(1).default('gpt-transcribe'),
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_STT_MODEL: z.string().min(1).default('scribe_v2'),
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  TICKETS_API_KEY: z.string().min(16).optional(),
  // Optional keys of their own for the other eGrant webhooks; unset = TICKETS_API_KEY.
  EGRANT_MANAGERS_API_KEY: z.string().min(16).optional(),
  EGRANT_PROJECTS_API_KEY: z.string().min(16).optional(),
  // Only to tell the placeholder password apart (compose builds DATABASE_URL from it).
  POSTGRES_PASSWORD: z.string().optional(),
  // Phase 23 — bulk email. The API key is optional here and required (below) when either
  // EMAIL_DRIVER or BULK_EMAIL_DRIVER is `elastic`.
  ELASTIC_EMAIL_API_KEY: z.string().min(1).optional(),
  MAIL_FROM_BULK: z.string().min(1).optional(),
  // Unset: the same as EMAIL_DRIVER, so a server already on elastic keeps starting.
  BULK_EMAIL_DRIVER: z.enum(['smtp', 'elastic']).optional(),
  BULK_EMAIL_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  BULK_EMAIL_UNSUBSCRIBE: z.enum(['elastic', 'spolu']).default('elastic'),
  // Microsoft Teams (T1): an Entra app, app-only. Off when none of these is set.
  TEAMS_TENANT_ID: z.uuid().optional(),
  TEAMS_CLIENT_ID: z.uuid().optional(),
  TEAMS_CLIENT_SECRET: z.string().min(1).optional(),
  TEAMS_CERT_PATH: z.string().min(1).optional(),
  // The SHA-1 thumbprint Entra shows for the uploaded certificate (40 hex digits).
  TEAMS_CERT_THUMBPRINT: z
    .string()
    .transform((v) => v.replace(/[\s:]/g, '').toUpperCase())
    .pipe(z.string().regex(/^[0-9A-F]{40}$/))
    .optional(),
};

const EnvSchema = z.discriminatedUnion('EMAIL_DRIVER', [
  z
    .object({
      ...base,
      EMAIL_DRIVER: z.literal('smtp'),
      SMTP_HOST: z.string().min(1),
      SMTP_PORT: z.coerce.number().int().min(1).max(65535),
      SMTP_USER: z.string().min(1).optional(),
      SMTP_PASSWORD: z.string().min(1).optional(),
      SMTP_SECURE: z
        .enum(['true', 'false'])
        .transform((v) => v === 'true')
        .optional(),
    })
    .superRefine((v, ctx) => {
      if ((v.SMTP_USER === undefined) !== (v.SMTP_PASSWORD === undefined)) {
        ctx.addIssue({
          code: 'custom',
          path: [v.SMTP_USER === undefined ? 'SMTP_USER' : 'SMTP_PASSWORD'],
          message: 'SMTP_USER and SMTP_PASSWORD must be set together',
        });
      }
    }),
  z.object({
    ...base,
    EMAIL_DRIVER: z.literal('elastic'),
    ELASTIC_EMAIL_API_KEY: z.string().min(1),
  }),
]);

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  publicUrl: string;
  databaseUrl: string;
  superadminEmail: string;
  superadminName: string;
  appSecret: string;
  appVersion: string;
  filesDir: string;
  webDistDir: string | undefined;
  email:
    | {
        driver: 'smtp';
        host: string;
        port: number;
        secure: boolean;
        auth?: { user: string; pass: string };
        from: string;
      }
    | { driver: 'elastic'; apiKey: string; from: string };
  /** null = web push is off (no VAPID keys). The fake provider is for tests and e2e. */
  push:
    | { provider: 'webpush'; publicKey: string; privateKey: string; subject: string }
    | { provider: 'fake'; publicKey: string | null; file: string | undefined }
    | null;
  /** How long a group's email notifications wait so several events go out as one email. */
  emailBatchDelayMs: number;
  /** Login code requests allowed per minute and IP (production only; e2e raises it). */
  loginCodesPerMinute: number;
  /** Invite-link email submissions per minute and IP (`POST /api/join/:token`). */
  joinRequestsPerMinute: number;
  /**
   * Tests only, never read from the environment: lower per-minute limits of the AI text tools and
   * voice input, so a rate-limit test needs a few requests instead of 30 (production and e2e
   * leave it unset and use `TEXT_TOOL_LIMITS` and `VOICE_RATE_LIMITS`).
   */
  aiBurstLimits?: { textPerMinute: number; voicePerMinute: number };
  /** The task split provider; null when OpenAI is chosen but no key is set (AI is off). */
  ai: { provider: 'openai'; apiKey: string; model: string } | { provider: 'fake' } | null;
  /** The chat composer's AI text tools (Phase 28); null like `ai`, with their own model. */
  textAi:
    | { provider: 'openai'; apiKey: string; model: string; reasoningEffort: ReasoningEffort }
    | { provider: 'fake' }
    | null;
  /**
   * Speech to text for meeting recordings (Phase 30); null when OpenAI is chosen but no key is
   * set (transcription is off; pasted transcripts still work).
   */
  transcription:
    | { provider: 'openai'; apiKey: string; model: string }
    | { provider: 'elevenlabs'; apiKey: string; model: string }
    | { provider: 'fake' }
    | null;
  /** The ffmpeg binary for meeting recordings (Phase 30); `fake` (e2e) copies bytes instead. */
  ffmpegPath: string;
  /** The shared Bearer key of the ticket intake API (Phase 21); null = intake is off. */
  ticketsApiKey: string | null;
  /**
   * The eGrant managers and projects webhooks' own keys; null = they use `ticketsApiKey`.
   * Read them through `egrantWebhookKey`, never directly.
   */
  egrantManagersApiKey: string | null;
  egrantProjectsApiKey: string | null;
  /** Calls a minute per admin to become or stop being a manager; unset = 120 (tests lower it). */
  managerRateLimitPerMinute?: number;
  /**
   * The bulk email sender (Phase 23), separate from the transactional one. `smtp` reuses the
   * SMTP settings of `email` (dev, tests, e2e); `elastic` posts to Elastic's `/v4/emails`.
   * `unsubscribe`: whether the footer link passes through Elastic (`elastic`) or goes straight
   * to Spolu with Spolu's own `List-Unsubscribe` header (`spolu`).
   */
  bulkEmail:
    | { driver: 'smtp'; from: string }
    | { driver: 'elastic'; apiKey: string; from: string; unsubscribe: 'elastic' | 'spolu' };
  /** Upper bound of bulk emails sent a minute. */
  bulkEmailPerMinute: number;
  /**
   * Microsoft Teams (T1): the Entra app Help calls Graph as, with a client secret or a
   * certificate (its private key file and thumbprint). null = the feature is off and hidden.
   */
  teams: TeamsConfig | null;
};

export type TeamsConfig = {
  tenantId: string;
  clientId: string;
  credential:
    | { kind: 'secret'; secret: string }
    | { kind: 'certificate'; keyPath: string; thumbprint: string };
};

export class ConfigError extends Error {
  constructor(readonly variables: string[]) {
    super(`Invalid environment configuration: ${variables.join(', ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  // Drop empty values so they are reported as missing or fall back to defaults.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    const names = new Set(result.error.issues.map((i) => String(i.path[0] ?? 'EMAIL_DRIVER')));
    throw new ConfigError([...names]);
  }
  const e = result.data;
  if (e.NODE_ENV === 'production' && e.AI_PROVIDER === 'fake' && e.AI_ALLOW_FAKE !== '1') {
    throw new ConfigError(['AI_PROVIDER']);
  }
  if (
    e.NODE_ENV === 'production' &&
    e.TRANSCRIPTION_PROVIDER === 'fake' &&
    e.AI_ALLOW_FAKE !== '1'
  ) {
    throw new ConfigError(['TRANSCRIPTION_PROVIDER']);
  }
  if (e.NODE_ENV === 'production' && e.FFMPEG_PATH === 'fake' && e.AI_ALLOW_FAKE !== '1') {
    throw new ConfigError(['FFMPEG_PATH']);
  }
  if (e.NODE_ENV === 'production') refusePlaceholderSecrets(e);
  if (e.TRANSCRIPTION_PROVIDER === 'elevenlabs' && e.ELEVENLABS_API_KEY === undefined) {
    throw new ConfigError(['ELEVENLABS_API_KEY']);
  }
  const bulkEmail = bulkEmailConfig(e);
  const teams = teamsConfig(e);
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    publicUrl: e.PUBLIC_URL,
    databaseUrl: e.DATABASE_URL,
    superadminEmail: e.SUPERADMIN_EMAIL,
    superadminName: e.SUPERADMIN_NAME ?? e.SUPERADMIN_EMAIL.split('@')[0]!,
    appSecret: e.APP_SECRET,
    appVersion: e.APP_VERSION,
    filesDir: e.FILES_DIR,
    webDistDir: e.WEB_DIST_DIR,
    push: pushConfig(e),
    emailBatchDelayMs: e.EMAIL_BATCH_DELAY_MS,
    loginCodesPerMinute: e.LOGIN_CODES_PER_MINUTE,
    joinRequestsPerMinute: e.JOIN_REQUESTS_PER_MINUTE,
    ticketsApiKey: e.TICKETS_API_KEY ?? null,
    egrantManagersApiKey: e.EGRANT_MANAGERS_API_KEY ?? null,
    egrantProjectsApiKey: e.EGRANT_PROJECTS_API_KEY ?? null,
    email:
      e.EMAIL_DRIVER === 'smtp'
        ? {
            driver: 'smtp',
            host: e.SMTP_HOST,
            port: e.SMTP_PORT,
            secure: e.SMTP_SECURE ?? e.SMTP_PORT === 465,
            ...(e.SMTP_USER !== undefined && e.SMTP_PASSWORD !== undefined
              ? { auth: { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } }
              : {}),
            from: e.MAIL_FROM,
          }
        : { driver: 'elastic', apiKey: e.ELASTIC_EMAIL_API_KEY, from: e.MAIL_FROM },
    bulkEmail,
    bulkEmailPerMinute: e.BULK_EMAIL_PER_MINUTE,
    teams,
    transcription: transcriptionConfig(e),
    ffmpegPath: e.FFMPEG_PATH,
    ai:
      e.AI_PROVIDER === 'fake'
        ? { provider: 'fake' }
        : e.OPENAI_API_KEY === undefined
          ? null
          : { provider: 'openai', apiKey: e.OPENAI_API_KEY, model: e.OPENAI_MODEL },
    textAi:
      e.AI_PROVIDER === 'fake'
        ? { provider: 'fake' }
        : e.OPENAI_API_KEY === undefined
          ? null
          : {
              provider: 'openai',
              apiKey: e.OPENAI_API_KEY,
              model: e.OPENAI_TEXT_MODEL,
              reasoningEffort: e.OPENAI_TEXT_REASONING_EFFORT,
            },
  };
}

/**
 * Teams is off when no TEAMS_ variable is set. Otherwise the tenant, the client and exactly one
 * credential are needed: a secret, or a certificate (both its path and thumbprint).
 */
function teamsConfig(e: {
  TEAMS_TENANT_ID?: string | undefined;
  TEAMS_CLIENT_ID?: string | undefined;
  TEAMS_CLIENT_SECRET?: string | undefined;
  TEAMS_CERT_PATH?: string | undefined;
  TEAMS_CERT_THUMBPRINT?: string | undefined;
}): Config['teams'] {
  const set = [
    e.TEAMS_TENANT_ID,
    e.TEAMS_CLIENT_ID,
    e.TEAMS_CLIENT_SECRET,
    e.TEAMS_CERT_PATH,
    e.TEAMS_CERT_THUMBPRINT,
  ].some((v) => v !== undefined);
  if (!set) return null;
  const missing: string[] = [];
  if (e.TEAMS_TENANT_ID === undefined) missing.push('TEAMS_TENANT_ID');
  if (e.TEAMS_CLIENT_ID === undefined) missing.push('TEAMS_CLIENT_ID');
  const cert = e.TEAMS_CERT_PATH !== undefined || e.TEAMS_CERT_THUMBPRINT !== undefined;
  const secret = e.TEAMS_CLIENT_SECRET !== undefined;
  if (cert && secret) missing.push('TEAMS_CLIENT_SECRET');
  if (cert && e.TEAMS_CERT_PATH === undefined) missing.push('TEAMS_CERT_PATH');
  if (cert && e.TEAMS_CERT_THUMBPRINT === undefined) missing.push('TEAMS_CERT_THUMBPRINT');
  if (!cert && !secret) missing.push('TEAMS_CLIENT_SECRET');
  if (missing.length > 0) throw new ConfigError(missing);
  return {
    tenantId: e.TEAMS_TENANT_ID!.toLowerCase(),
    clientId: e.TEAMS_CLIENT_ID!.toLowerCase(),
    credential: secret
      ? { kind: 'secret', secret: e.TEAMS_CLIENT_SECRET! }
      : { kind: 'certificate', keyPath: e.TEAMS_CERT_PATH!, thumbprint: e.TEAMS_CERT_THUMBPRINT! },
  };
}

/**
 * The Bearer key of an eGrant webhook: its own key when set, otherwise the ticket intake's
 * `TICKETS_API_KEY` (so a server with only that key keeps working). null = the webhook is off.
 * `projects` is for the project webhook (PR #113).
 */
export function egrantWebhookKey(
  config: Pick<Config, 'ticketsApiKey' | 'egrantManagersApiKey' | 'egrantProjectsApiKey'>,
  webhook: 'tickets' | 'managers' | 'projects',
): string | null {
  if (webhook === 'managers') return config.egrantManagersApiKey ?? config.ticketsApiKey;
  if (webhook === 'projects') return config.egrantProjectsApiKey ?? config.ticketsApiKey;
  return config.ticketsApiKey;
}

/** The APP_SECRET of `.env.example` and `deploy/test.env.example`, public in the repository. */
export const PLACEHOLDER_APP_SECRET = 'change-me-to-a-random-string-of-32-chars-or-more';
/** The database passwords of `.env.example` (`spolu`) and `deploy/test.env.example`. */
const PLACEHOLDER_DB_PASSWORDS = new Set(['spolu', 'change-me']);
/** Hosts of a database on this machine: the e2e run (production mode) uses the dev one. */
const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Production refuses to start with the example files' placeholder secrets. Only those exact
 * values are refused, never values that merely look weak: a real server's env must keep starting.
 * The placeholder password, in DATABASE_URL or POSTGRES_PASSWORD, is allowed while DATABASE_URL
 * points at a local host (the e2e server runs in production mode against the dev PostgreSQL,
 * with whatever the developer's shell exports); compose's `postgres` host is not local.
 */
function refusePlaceholderSecrets(e: {
  APP_SECRET: string;
  DATABASE_URL: string;
  POSTGRES_PASSWORD?: string | undefined;
}): void {
  const bad: string[] = [];
  if (e.APP_SECRET === PLACEHOLDER_APP_SECRET) bad.push('APP_SECRET');
  const url = parseUrl(e.DATABASE_URL);
  const local = url !== null && LOCAL_DB_HOSTS.has(url.hostname);
  if (
    !local &&
    e.POSTGRES_PASSWORD !== undefined &&
    PLACEHOLDER_DB_PASSWORDS.has(e.POSTGRES_PASSWORD)
  ) {
    bad.push('POSTGRES_PASSWORD');
  }
  const password = dbPassword(e.DATABASE_URL);
  if (!local && password !== undefined && PLACEHOLDER_DB_PASSWORDS.has(password)) {
    bad.push('DATABASE_URL');
  }
  if (bad.length > 0) throw new ConfigError(bad);
}

/**
 * The decoded password of a DATABASE_URL: '' when the value is no URL or has none, undefined when
 * its percent-encoding is malformed (`decodeURIComponent` throws).
 */
function dbPassword(value: string): string | undefined {
  const url = parseUrl(value);
  if (!url) return '';
  try {
    return decodeURIComponent(url.password);
  } catch {
    return undefined;
  }
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function transcriptionConfig(e: {
  TRANSCRIPTION_PROVIDER: 'openai' | 'elevenlabs' | 'fake';
  OPENAI_API_KEY?: string | undefined;
  OPENAI_TRANSCRIBE_MODEL: string;
  ELEVENLABS_API_KEY?: string | undefined;
  ELEVENLABS_STT_MODEL: string;
}): Config['transcription'] {
  if (e.TRANSCRIPTION_PROVIDER === 'fake') return { provider: 'fake' };
  if (e.TRANSCRIPTION_PROVIDER === 'elevenlabs') {
    return { provider: 'elevenlabs', apiKey: e.ELEVENLABS_API_KEY!, model: e.ELEVENLABS_STT_MODEL };
  }
  if (e.OPENAI_API_KEY === undefined) return null;
  return { provider: 'openai', apiKey: e.OPENAI_API_KEY, model: e.OPENAI_TRANSCRIBE_MODEL };
}

function bulkEmailConfig(e: {
  EMAIL_DRIVER: 'smtp' | 'elastic';
  ELASTIC_EMAIL_API_KEY?: string | undefined;
  MAIL_FROM: string;
  MAIL_FROM_BULK?: string | undefined;
  BULK_EMAIL_DRIVER?: 'smtp' | 'elastic' | undefined;
  BULK_EMAIL_UNSUBSCRIBE: 'elastic' | 'spolu';
}): Config['bulkEmail'] {
  const from = e.MAIL_FROM_BULK ?? e.MAIL_FROM;
  const driver = e.BULK_EMAIL_DRIVER ?? e.EMAIL_DRIVER;
  if (driver === 'smtp') {
    // The smtp bulk driver reuses the transactional SMTP settings; with EMAIL_DRIVER=elastic
    // there are none.
    if (e.EMAIL_DRIVER !== 'smtp') throw new ConfigError(['BULK_EMAIL_DRIVER']);
    return { driver: 'smtp', from };
  }
  if (e.ELASTIC_EMAIL_API_KEY === undefined) throw new ConfigError(['ELASTIC_EMAIL_API_KEY']);
  return {
    driver: 'elastic',
    apiKey: e.ELASTIC_EMAIL_API_KEY,
    from,
    unsubscribe: e.BULK_EMAIL_UNSUBSCRIBE,
  };
}

function pushConfig(e: {
  NODE_ENV: 'development' | 'test' | 'production';
  PUSH_ALLOW_FAKE?: '1' | undefined;
  PUSH_PROVIDER: 'webpush' | 'fake';
  PUSH_FAKE_FILE?: string | undefined;
  VAPID_PUBLIC_KEY?: string | undefined;
  VAPID_PRIVATE_KEY?: string | undefined;
  VAPID_SUBJECT?: string | undefined;
}): Config['push'] {
  if (e.PUSH_PROVIDER === 'fake') {
    // A stray env line must not make production silently drop every push; the e2e server,
    // which runs as production, opts in with PUSH_ALLOW_FAKE=1.
    if (e.NODE_ENV === 'production' && e.PUSH_ALLOW_FAKE !== '1') {
      throw new ConfigError(['PUSH_PROVIDER']);
    }
    return { provider: 'fake', publicKey: e.VAPID_PUBLIC_KEY ?? null, file: e.PUSH_FAKE_FILE };
  }
  const vars = {
    VAPID_PUBLIC_KEY: e.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: e.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: e.VAPID_SUBJECT,
  };
  const missing = Object.entries(vars)
    .filter(([, v]) => v === undefined)
    .map(([k]) => k);
  if (missing.length === 3) return null;
  if (missing.length > 0) throw new ConfigError(missing);
  return {
    provider: 'webpush',
    publicKey: e.VAPID_PUBLIC_KEY!,
    privateKey: e.VAPID_PRIVATE_KEY!,
    subject: e.VAPID_SUBJECT!,
  };
}
