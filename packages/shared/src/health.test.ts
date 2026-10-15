import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from './health.js';

describe('HealthResponseSchema', () => {
  it('accepts a valid response', () => {
    expect(HealthResponseSchema.parse({ status: 'ok', db: 'ok', version: 'abc' })).toEqual({
      status: 'ok',
      db: 'ok',
      version: 'abc',
    });
  });

  it('rejects an unknown status', () => {
    expect(() => HealthResponseSchema.parse({ status: 'fine', db: 'ok', version: 'abc' })).toThrow();
  });

  it('rejects a missing version', () => {
    expect(() => HealthResponseSchema.parse({ status: 'ok', db: 'ok' })).toThrow();
  });
});
