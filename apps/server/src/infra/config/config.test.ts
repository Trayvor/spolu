import { describe, expect, it } from 'vitest';
import { ConfigError, egrantWebhookKey, loadConfig } from './config.js';

const validEnv = {
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://spolu:spolu@localhost:5432/spolu',
  SUPERADMIN_EMAIL: 'admin@example.com',
  APP_SECRET: 'x'.repeat(32),
  EMAIL_DRIVER: 'smtp',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  MAIL_FROM: 'Help by eGrant <noreply@example.com>',
};

function errorOf(env: NodeJS.ProcessEnv): ConfigError {
  try {
    loadConfig(env);
  } catch (e) {
    if (e instanceof ConfigError) return e;
    throw e;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('loads a valid smtp env and applies defaults', () => {
    const config = loadConfig(validEnv);
    expect(config.email).toEqual({
      driver: 'smtp',
      host: 'localhost',
      port: 1025,
      secure: false,
      from: 'Help by eGrant <noreply@example.com>',
    });
    expect(config.port).toBe(3000);
    expect(config.appVersion).toBe('dev');
    expect(config.filesDir).toBe('./data/files');
    expect(config.webDistDir).toBeUndefined();
  });

  it('loads smtp auth and defaults secure on for port 465', () => {
    const config = loadConfig({
      ...validEnv,
      SMTP_HOST: 'smtp.elasticemail.com',
      SMTP_PORT: '465',
      SMTP_USER: 'me@example.com',
      SMTP_PASSWORD: 'pw',
    });
    expect(config.email).toEqual({
      driver: 'smtp',
      host: 'smtp.elasticemail.com',
      port: 465,
      secure: true,
      auth: { user: 'me@example.com', pass: 'pw' },
      from: 'Help by eGrant <noreply@example.com>',
    });
  });

  it('lets SMTP_SECURE override the port default', () => {
    expect(loadConfig({ ...validEnv, SMTP_PORT: '465', SMTP_SECURE: 'false' }).email).toMatchObject(
      { secure: false },
    );
    expect(loadConfig({ ...validEnv, SMTP_SECURE: 'true' }).email).toMatchObject({ secure: true });
  });

  it('rejects SMTP_USER without SMTP_PASSWORD and vice versa without echoing values', () => {
    const noPass = errorOf({ ...validEnv, SMTP_USER: 'someone' });
    expect(noPass.message).toContain('SMTP_PASSWORD');
    const noUser = errorOf({ ...validEnv, SMTP_PASSWORD: 'hunter2-secret' });
    expect(noUser.message).toContain('SMTP_USER');
    expect(noUser.message).not.toContain('hunter2-secret');
  });

  it('rejects an invalid SMTP_SECURE', () => {
    expect(errorOf({ ...validEnv, SMTP_SECURE: 'yes' }).message).toContain('SMTP_SECURE');
  });

  it('loads an elastic env', () => {
    const config = loadConfig({
      ...validEnv,
      EMAIL_DRIVER: 'elastic',
      ELASTIC_EMAIL_API_KEY: 'key',
      // The smtp bulk driver needs SMTP settings, which an elastic env has none of.
      BULK_EMAIL_DRIVER: 'elastic',
    });
    expect(config.email).toEqual({
      driver: 'elastic',
      apiKey: 'key',
      from: 'Help by eGrant <noreply@example.com>',
    });
  });

  it('requires ELASTIC_EMAIL_API_KEY for the elastic driver', () => {
    const error = errorOf({ ...validEnv, EMAIL_DRIVER: 'elastic' });
    expect(error.message).toContain('ELASTIC_EMAIL_API_KEY');
  });

  it('names every invalid variable in one error', () => {
    const error = errorOf({ ...validEnv, DATABASE_URL: undefined, APP_SECRET: 'short' });
    expect(error.message).toContain('DATABASE_URL');
    expect(error.message).toContain('APP_SECRET');
  });

  it('treats empty strings as missing', () => {
    expect(errorOf({ ...validEnv, DATABASE_URL: '' }).message).toContain('DATABASE_URL');
  });

  it('rejects an invalid SUPERADMIN_EMAIL', () => {
    expect(errorOf({ ...validEnv, SUPERADMIN_EMAIL: 'not-an-email' }).message).toContain(
      'SUPERADMIN_EMAIL',
    );
  });

  it('defaults SUPERADMIN_NAME to the email local part', () => {
    expect(loadConfig({ ...validEnv, SUPERADMIN_EMAIL: ' Boss.Man@Example.com ' })).toMatchObject({
      superadminEmail: 'boss.man@example.com',
      superadminName: 'boss.man',
    });
  });

  it('uses SUPERADMIN_NAME when set', () => {
    expect(loadConfig({ ...validEnv, SUPERADMIN_NAME: 'The Boss' }).superadminName).toBe(
      'The Boss',
    );
  });

  describe('push and batching', () => {
    it('push is null without VAPID vars', () => {
      expect(loadConfig(validEnv).push).toBeNull();
    });

    it('all three VAPID vars give webpush', () => {
      const config = loadConfig({
        ...validEnv,
        VAPID_PUBLIC_KEY: 'pub',
        VAPID_PRIVATE_KEY: 'priv',
        VAPID_SUBJECT: 'mailto:ops@example.com',
      });
      expect(config.push).toEqual({
        provider: 'webpush',
        publicKey: 'pub',
        privateKey: 'priv',
        subject: 'mailto:ops@example.com',
      });
    });

    it('only VAPID_PUBLIC_KEY names the two missing vars', () => {
      expect(errorOf({ ...validEnv, VAPID_PUBLIC_KEY: 'pub' }).variables).toEqual([
        'VAPID_PRIVATE_KEY',
        'VAPID_SUBJECT',
      ]);
    });

    it('VAPID_SUBJECT must be mailto: or https:', () => {
      expect(
        errorOf({
          ...validEnv,
          VAPID_PUBLIC_KEY: 'pub',
          VAPID_PRIVATE_KEY: 'priv',
          VAPID_SUBJECT: 'ftp://x',
        }).variables,
      ).toEqual(['VAPID_SUBJECT']);
    });

    it('PUSH_PROVIDER=fake needs no keys', () => {
      expect(loadConfig({ ...validEnv, PUSH_PROVIDER: 'fake' }).push).toEqual({
        provider: 'fake',
        publicKey: null,
        file: undefined,
      });
      const withFile = loadConfig({
        ...validEnv,
        PUSH_PROVIDER: 'fake',
        PUSH_FAKE_FILE: '/tmp/p.jsonl',
        VAPID_PUBLIC_KEY: 'pub',
      });
      expect(withFile.push).toEqual({ provider: 'fake', publicKey: 'pub', file: '/tmp/p.jsonl' });
    });

    it('PUSH_PROVIDER=fake is refused in production unless PUSH_ALLOW_FAKE=1', () => {
      const env = { ...validEnv, NODE_ENV: 'production', PUSH_PROVIDER: 'fake' };
      expect(errorOf(env).variables).toEqual(['PUSH_PROVIDER']);
      expect(loadConfig({ ...env, PUSH_ALLOW_FAKE: '1' }).push?.provider).toBe('fake');
    });

    it('a missing VAPID_SUBJECT alone fails', () => {
      expect(
        errorOf({ ...validEnv, VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }).variables,
      ).toEqual(['VAPID_SUBJECT']);
    });

    it('a missing VAPID_PRIVATE_KEY alone fails', () => {
      expect(
        errorOf({
          ...validEnv,
          VAPID_PUBLIC_KEY: 'pub',
          VAPID_SUBJECT: 'mailto:ops@example.com',
        }).variables,
      ).toEqual(['VAPID_PRIVATE_KEY']);
    });

    it("LOGIN_CODES_PER_MINUTE defaults to 10 and parses '200'", () => {
      expect(loadConfig(validEnv).loginCodesPerMinute).toBe(10);
      expect(loadConfig({ ...validEnv, LOGIN_CODES_PER_MINUTE: '200' }).loginCodesPerMinute).toBe(
        200,
      );
    });

    it("JOIN_REQUESTS_PER_MINUTE defaults to 10 and parses '200'", () => {
      expect(loadConfig(validEnv).joinRequestsPerMinute).toBe(10);
      expect(
        loadConfig({ ...validEnv, JOIN_REQUESTS_PER_MINUTE: '200' }).joinRequestsPerMinute,
      ).toBe(200);
    });

    it("EMAIL_BATCH_DELAY_MS defaults to 600000 and parses '3000'", () => {
      expect(loadConfig(validEnv).emailBatchDelayMs).toBe(600_000);
      expect(loadConfig({ ...validEnv, EMAIL_BATCH_DELAY_MS: '3000' }).emailBatchDelayMs).toBe(
        3000,
      );
    });
  });
  it('has no AI without OPENAI_API_KEY and defaults the model to gpt-5-mini', () => {
    expect(loadConfig(validEnv).ai).toBeNull();
    expect(loadConfig({ ...validEnv, OPENAI_API_KEY: 'sk-test' }).ai).toEqual({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-5-mini',
    });
    expect(
      loadConfig({ ...validEnv, OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-5' }).ai,
    ).toMatchObject({ model: 'gpt-5' });
  });

  it('the text tools (Phase 28) use OPENAI_TEXT_MODEL, default gpt-5.4-mini with low reasoning', () => {
    expect(loadConfig(validEnv).textAi).toBeNull();
    expect(loadConfig({ ...validEnv, OPENAI_API_KEY: 'sk-test' }).textAi).toEqual({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-5.4-mini',
      reasoningEffort: 'low',
    });
    expect(
      loadConfig({
        ...validEnv,
        OPENAI_API_KEY: 'sk-test',
        OPENAI_TEXT_MODEL: 'gpt-4.1-mini',
        OPENAI_TEXT_REASONING_EFFORT: 'off',
      }).textAi,
    ).toMatchObject({ model: 'gpt-4.1-mini', reasoningEffort: 'off' });
    expect(loadConfig({ ...validEnv, AI_PROVIDER: 'fake' }).textAi).toEqual({ provider: 'fake' });
    expect(errorOf({ ...validEnv, OPENAI_TEXT_REASONING_EFFORT: 'huge' }).variables).toEqual([
      'OPENAI_TEXT_REASONING_EFFORT',
    ]);
  });

  it('uses the fake provider when AI_PROVIDER=fake, key or not', () => {
    expect(loadConfig({ ...validEnv, AI_PROVIDER: 'fake' }).ai).toEqual({ provider: 'fake' });
    expect(loadConfig({ ...validEnv, AI_PROVIDER: 'fake', OPENAI_API_KEY: 'k' }).ai).toEqual({
      provider: 'fake',
    });
  });

  it('refuses the fake provider in production unless AI_ALLOW_FAKE=1', () => {
    const prod = { ...validEnv, NODE_ENV: 'production', AI_PROVIDER: 'fake' };
    expect(errorOf(prod).variables).toEqual(['AI_PROVIDER']);
    expect(errorOf({ ...prod, AI_ALLOW_FAKE: 'yes' }).message).toContain('AI_ALLOW_FAKE');
    expect(loadConfig({ ...prod, AI_ALLOW_FAKE: '1' }).ai).toEqual({ provider: 'fake' });
    expect(loadConfig({ ...validEnv, NODE_ENV: 'development', AI_PROVIDER: 'fake' }).ai).toEqual({
      provider: 'fake',
    });
  });

  it('rejects an unknown AI_PROVIDER without echoing the key', () => {
    const error = errorOf({ ...validEnv, AI_PROVIDER: 'claude', OPENAI_API_KEY: 'sk-secret' });
    expect(error.message).toContain('AI_PROVIDER');
    expect(error.message).not.toContain('sk-secret');
  });
});

describe('loadConfig: meeting transcription (Phase 30)', () => {
  it('openai by default: on with OPENAI_API_KEY (default model gpt-transcribe), off without', () => {
    expect(loadConfig(validEnv).transcription).toBeNull();
    expect(loadConfig({ ...validEnv, OPENAI_API_KEY: 'sk' }).transcription).toEqual({
      provider: 'openai',
      apiKey: 'sk',
      model: 'gpt-transcribe',
    });
    expect(
      loadConfig({
        ...validEnv,
        OPENAI_API_KEY: 'sk',
        OPENAI_TRANSCRIBE_MODEL: 'gpt-4o-mini-transcribe',
      }).transcription,
    ).toMatchObject({ model: 'gpt-4o-mini-transcribe' });
    expect(loadConfig(validEnv).ffmpegPath).toBe('ffmpeg');
  });

  it('elevenlabs needs ELEVENLABS_API_KEY; one line switches', () => {
    expect(errorOf({ ...validEnv, TRANSCRIPTION_PROVIDER: 'elevenlabs' }).variables).toEqual([
      'ELEVENLABS_API_KEY',
    ]);
    expect(
      loadConfig({ ...validEnv, TRANSCRIPTION_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'el' })
        .transcription,
    ).toEqual({ provider: 'elevenlabs', apiKey: 'el', model: 'scribe_v2' });
  });

  it('fake is refused in production unless AI_ALLOW_FAKE=1', () => {
    const prod = { ...validEnv, NODE_ENV: 'production', TRANSCRIPTION_PROVIDER: 'fake' };
    expect(errorOf(prod).variables).toEqual(['TRANSCRIPTION_PROVIDER']);
    expect(loadConfig({ ...prod, AI_ALLOW_FAKE: '1' }).transcription).toEqual({ provider: 'fake' });
  });
});

describe('loadConfig: bulk email', () => {
  it('MAIL_FROM_BULK defaults to MAIL_FROM', () => {
    const config = loadConfig(validEnv);
    expect(config.bulkEmail).toEqual({
      driver: 'smtp',
      from: 'Help by eGrant <noreply@example.com>',
    });
    expect(
      loadConfig({ ...validEnv, MAIL_FROM_BULK: 'eGrant <info@egrant.sk>' }).bulkEmail,
    ).toEqual({ driver: 'smtp', from: 'eGrant <info@egrant.sk>' });
  });

  it('BULK_EMAIL_DRIVER=elastic without ELASTIC_EMAIL_API_KEY is a ConfigError', () => {
    const error = errorOf({ ...validEnv, BULK_EMAIL_DRIVER: 'elastic' });
    expect(error.variables).toEqual(['ELASTIC_EMAIL_API_KEY']);
  });

  it('BULK_EMAIL_DRIVER=elastic works with EMAIL_DRIVER=smtp', () => {
    const config = loadConfig({
      ...validEnv,
      BULK_EMAIL_DRIVER: 'elastic',
      ELASTIC_EMAIL_API_KEY: 'bulk-key',
      MAIL_FROM_BULK: 'eGrant <info@egrant.sk>',
    });
    expect(config.email.driver).toBe('smtp');
    expect(config.bulkEmail).toEqual({
      driver: 'elastic',
      apiKey: 'bulk-key',
      from: 'eGrant <info@egrant.sk>',
      unsubscribe: 'elastic',
    });
  });

  it('BULK_EMAIL_DRIVER=elastic shares the key with EMAIL_DRIVER=elastic', () => {
    const config = loadConfig({
      ...validEnv,
      EMAIL_DRIVER: 'elastic',
      ELASTIC_EMAIL_API_KEY: 'key',
      BULK_EMAIL_DRIVER: 'elastic',
      BULK_EMAIL_UNSUBSCRIBE: 'spolu',
    });
    expect(config.email).toEqual({ driver: 'elastic', apiKey: 'key', from: validEnv.MAIL_FROM });
    expect(config.bulkEmail).toEqual({
      driver: 'elastic',
      apiKey: 'key',
      from: validEnv.MAIL_FROM,
      unsubscribe: 'spolu',
    });
  });

  it('BULK_EMAIL_DRIVER defaults to EMAIL_DRIVER, so a server on elastic keeps starting', () => {
    const config = loadConfig({ ...validEnv, EMAIL_DRIVER: 'elastic', ELASTIC_EMAIL_API_KEY: 'k' });
    expect(config.bulkEmail).toMatchObject({ driver: 'elastic', apiKey: 'k' });
    expect(loadConfig(validEnv).bulkEmail).toMatchObject({ driver: 'smtp' });
  });

  it('BULK_EMAIL_DRIVER=smtp with EMAIL_DRIVER=elastic is a ConfigError', () => {
    const error = errorOf({
      ...validEnv,
      EMAIL_DRIVER: 'elastic',
      ELASTIC_EMAIL_API_KEY: 'k',
      BULK_EMAIL_DRIVER: 'smtp',
    });
    expect(error.variables).toEqual(['BULK_EMAIL_DRIVER']);
    expect(error.message).not.toContain('k,');
  });

  it('BULK_EMAIL_PER_MINUTE defaults to 120', () => {
    expect(loadConfig(validEnv).bulkEmailPerMinute).toBe(120);
    expect(loadConfig({ ...validEnv, BULK_EMAIL_PER_MINUTE: '60' }).bulkEmailPerMinute).toBe(60);
    expect(errorOf({ ...validEnv, BULK_EMAIL_PER_MINUTE: '0' }).variables).toEqual([
      'BULK_EMAIL_PER_MINUTE',
    ]);
  });

  it('BULK_EMAIL_UNSUBSCRIBE defaults to elastic and accepts only elastic or spolu', () => {
    const env = { ...validEnv, BULK_EMAIL_DRIVER: 'elastic', ELASTIC_EMAIL_API_KEY: 'k' };
    expect(loadConfig(env).bulkEmail).toMatchObject({ unsubscribe: 'elastic' });
    expect(errorOf({ ...env, BULK_EMAIL_UNSUBSCRIBE: 'both' }).variables).toEqual([
      'BULK_EMAIL_UNSUBSCRIBE',
    ]);
  });

  it('rejects an unknown BULK_EMAIL_DRIVER', () => {
    expect(errorOf({ ...validEnv, BULK_EMAIL_DRIVER: 'ses' }).variables).toEqual([
      'BULK_EMAIL_DRIVER',
    ]);
  });

  describe('Microsoft Teams', () => {
    const tenant = '11111111-2222-4333-8444-555555555555';
    const client = '66666666-7777-4888-9999-000000000000';
    const thumbprint = 'ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89:ab:cd:ef:01';

    it('is off (null) when no TEAMS_ variable is set', () => {
      expect(loadConfig(validEnv).teams).toBeNull();
    });

    it('takes a client secret', () => {
      const env = {
        ...validEnv,
        TEAMS_TENANT_ID: tenant.toUpperCase(),
        TEAMS_CLIENT_ID: client,
        TEAMS_CLIENT_SECRET: 's3cret',
      };
      expect(loadConfig(env).teams).toEqual({
        tenantId: tenant,
        clientId: client,
        credential: { kind: 'secret', secret: 's3cret' },
      });
    });

    it('takes a certificate path and thumbprint (normalised to 40 hex digits)', () => {
      const env = {
        ...validEnv,
        TEAMS_TENANT_ID: tenant,
        TEAMS_CLIENT_ID: client,
        TEAMS_CERT_PATH: '/run/secrets/teams.pem',
        TEAMS_CERT_THUMBPRINT: thumbprint,
      };
      expect(loadConfig(env).teams?.credential).toEqual({
        kind: 'certificate',
        keyPath: '/run/secrets/teams.pem',
        thumbprint: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
      });
    });

    it('names what is missing or conflicting, never echoing values', () => {
      expect(errorOf({ ...validEnv, TEAMS_TENANT_ID: tenant }).variables).toEqual([
        'TEAMS_CLIENT_ID',
        'TEAMS_CLIENT_SECRET',
      ]);
      const both = {
        ...validEnv,
        TEAMS_TENANT_ID: tenant,
        TEAMS_CLIENT_ID: client,
        TEAMS_CLIENT_SECRET: 'top-secret-value',
        TEAMS_CERT_PATH: '/k.pem',
        TEAMS_CERT_THUMBPRINT: thumbprint,
      };
      const error = errorOf(both);
      expect(error.variables).toEqual(['TEAMS_CLIENT_SECRET']);
      expect(error.message).not.toContain('top-secret-value');
      expect(
        errorOf({
          ...validEnv,
          TEAMS_TENANT_ID: tenant,
          TEAMS_CLIENT_ID: client,
          TEAMS_CERT_PATH: '/k.pem',
        }).variables,
      ).toEqual(['TEAMS_CERT_THUMBPRINT']);
      expect(errorOf({ ...validEnv, TEAMS_CERT_THUMBPRINT: 'nope' }).variables).toEqual([
        'TEAMS_CERT_THUMBPRINT',
      ]);
      expect(errorOf({ ...validEnv, TEAMS_TENANT_ID: 'eGrant' }).variables).toEqual([
        'TEAMS_TENANT_ID',
      ]);
    });
  });

  it('the eGrant groups key is its own, else the tickets key, else off', () => {
    const own = 'g'.repeat(16);
    const egrantGroupsKey = (config: ReturnType<typeof loadConfig>) =>
      egrantWebhookKey(config, 'groups');
    const tickets = 't'.repeat(16);
    expect(egrantGroupsKey(loadConfig(validEnv))).toBeNull();
    expect(egrantGroupsKey(loadConfig({ ...validEnv, TICKETS_API_KEY: tickets }))).toBe(tickets);
    expect(
      egrantGroupsKey(
        loadConfig({ ...validEnv, TICKETS_API_KEY: tickets, EGRANT_GROUPS_API_KEY: own }),
      ),
    ).toBe(own);
    expect(egrantGroupsKey(loadConfig({ ...validEnv, EGRANT_GROUPS_API_KEY: own }))).toBe(own);
    expect(errorOf({ ...validEnv, EGRANT_GROUPS_API_KEY: 'short' }).variables).toEqual([
      'EGRANT_GROUPS_API_KEY',
    ]);
  });
});
