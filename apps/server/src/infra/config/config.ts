import { z } from 'zod';

const base = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  SUPERADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
  SUPERADMIN_NAME: z.string().trim().min(1).optional(),
  APP_SECRET: z.string().min(32),
  APP_VERSION: z.string().default('dev'),
  FILES_DIR: z.string().default('./data/files'),
  WEB_DIST_DIR: z.string().optional(),
  MAIL_FROM: z.string().min(1),
  // `fake` is for local development and e2e only, never on a server.
  AI_PROVIDER: z.enum(['openai', 'fake']).default('openai'),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default('gpt-5-mini'),
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
  /** The task split provider; null when OpenAI is chosen but no key is set (AI is off). */
  ai: { provider: 'openai'; apiKey: string; model: string } | { provider: 'fake' } | null;
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
    ai:
      e.AI_PROVIDER === 'fake'
        ? { provider: 'fake' }
        : e.OPENAI_API_KEY === undefined
          ? null
          : { provider: 'openai', apiKey: e.OPENAI_API_KEY, model: e.OPENAI_MODEL },
  };
}
