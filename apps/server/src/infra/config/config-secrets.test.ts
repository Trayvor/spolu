import { describe, expect, it } from 'vitest';
import { ConfigError, egrantWebhookKey, loadConfig, PLACEHOLDER_APP_SECRET } from './config.js';

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

describe('loadConfig: placeholder secrets in production', () => {
  const prod = {
    ...validEnv,
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://spolu:a-real-password-0123456789@postgres:5432/spolu',
    POSTGRES_PASSWORD: 'a-real-password-0123456789',
  };

  it('starts with real values', () => {
    expect(loadConfig(prod).appSecret).toBe('x'.repeat(32));
  });

  it("refuses the example files' APP_SECRET without echoing it", () => {
    const error = errorOf({ ...prod, APP_SECRET: PLACEHOLDER_APP_SECRET });
    expect(error.variables).toEqual(['APP_SECRET']);
    expect(error.message).not.toContain(PLACEHOLDER_APP_SECRET);
  });

  it('refuses the placeholder database passwords spolu and change-me', () => {
    for (const password of ['spolu', 'change-me']) {
      expect(errorOf({ ...prod, POSTGRES_PASSWORD: password }).variables).toEqual([
        'POSTGRES_PASSWORD',
      ]);
      expect(
        errorOf({ ...prod, DATABASE_URL: `postgres://spolu:${password}@postgres:5432/spolu` })
          .variables,
      ).toEqual(['DATABASE_URL']);
    }
  });

  it('allows the placeholder password in DATABASE_URL on a local host (the e2e server)', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(() =>
        loadConfig({ ...prod, DATABASE_URL: `postgres://spolu:spolu@${host}:5432/spolu_e2e` }),
      ).not.toThrow();
    }
  });

  it('allows POSTGRES_PASSWORD=spolu when DATABASE_URL is local (a dev shell running e2e)', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(() =>
        loadConfig({
          ...prod,
          POSTGRES_PASSWORD: 'spolu',
          DATABASE_URL: `postgres://spolu:spolu@${host}:5432/spolu_e2e`,
        }),
      ).not.toThrow();
    }
    // A server's DATABASE_URL points at compose's `postgres` host: still refused there.
    expect(errorOf({ ...prod, POSTGRES_PASSWORD: 'spolu' }).variables).toEqual([
      'POSTGRES_PASSWORD',
    ]);
  });

  it('a malformed % in the DATABASE_URL password fails with an error naming DATABASE_URL', () => {
    for (const env of [prod, { ...validEnv, NODE_ENV: 'development' }]) {
      const error = errorOf({ ...env, DATABASE_URL: 'postgres://spolu:p%zz@postgres:5432/spolu' });
      expect(error.variables).toEqual(['DATABASE_URL']);
      expect(error.message).toContain('DATABASE_URL');
      expect(error.message).not.toContain('p%zz');
    }
    // Well-formed percent-encoding still works.
    expect(() =>
      loadConfig({ ...prod, DATABASE_URL: 'postgres://spolu:p%25zz@postgres:5432/spolu' }),
    ).not.toThrow();
  });

  it('refuses only the exact placeholders, never weak-looking values', () => {
    expect(() =>
      loadConfig({
        ...prod,
        APP_SECRET: `${PLACEHOLDER_APP_SECRET}!`,
        POSTGRES_PASSWORD: 'spolu1',
        DATABASE_URL: 'postgres://spolu:spolu1@postgres:5432/spolu',
      }),
    ).not.toThrow();
  });

  it('accepts the placeholders outside production', () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        NODE_ENV: 'development',
        APP_SECRET: PLACEHOLDER_APP_SECRET,
        POSTGRES_PASSWORD: 'spolu',
        DATABASE_URL: 'postgres://spolu:spolu@postgres:5432/spolu',
      }),
    ).not.toThrow();
  });
});

describe('egrantWebhookKey', () => {
  it("uses each webhook's own key, falling back to TICKETS_API_KEY", () => {
    const shared = loadConfig({ ...validEnv, TICKETS_API_KEY: 't'.repeat(16) });
    expect(egrantWebhookKey(shared, 'tickets')).toBe('t'.repeat(16));
    expect(egrantWebhookKey(shared, 'managers')).toBe('t'.repeat(16));
    expect(egrantWebhookKey(shared, 'projects')).toBe('t'.repeat(16));

    const own = loadConfig({
      ...validEnv,
      TICKETS_API_KEY: 't'.repeat(16),
      EGRANT_MANAGERS_API_KEY: 'm'.repeat(16),
      EGRANT_PROJECTS_API_KEY: 'p'.repeat(16),
    });
    expect(egrantWebhookKey(own, 'tickets')).toBe('t'.repeat(16));
    expect(egrantWebhookKey(own, 'managers')).toBe('m'.repeat(16));
    expect(egrantWebhookKey(own, 'projects')).toBe('p'.repeat(16));
  });

  it('is null when no key is set, and a short key is refused', () => {
    expect(egrantWebhookKey(loadConfig(validEnv), 'managers')).toBeNull();
    expect(errorOf({ ...validEnv, EGRANT_MANAGERS_API_KEY: 'short' }).variables).toEqual([
      'EGRANT_MANAGERS_API_KEY',
    ]);
  });
});
