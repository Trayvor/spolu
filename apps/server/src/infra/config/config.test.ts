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
      from: 'Spolu <noreply@example.com>',
    });
    expect(config.port).toBe(3000);
    expect(config.appVersion).toBe('dev');
    expect(config.filesDir).toBe('./data/files');
    expect(config.webDistDir).toBeUndefined();
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
});
