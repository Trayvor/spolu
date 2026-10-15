import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const validEnv = {
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://spolu:spolu@localhost:5432/spolu',
  SUPERADMIN_EMAIL: 'admin@example.com',
  APP_SECRET: 'x'.repeat(32),
  EMAIL_DRIVER: 'smtp',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  MAIL_FROM: 'Spolu <noreply@example.com>',
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
      from: 'Spolu <noreply@example.com>',
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
      from: 'Spolu <noreply@example.com>',
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
    });
    expect(config.email).toEqual({
      driver: 'elastic',
      apiKey: 'key',
      from: 'Spolu <noreply@example.com>',
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
