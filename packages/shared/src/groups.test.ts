import { describe, expect, it } from 'vitest';
import { GroupInputSchema, JoinBodySchema, NameBodySchema } from './groups.js';

describe('GroupInputSchema', () => {
  it('trims the name', () => {
    expect(GroupInputSchema.parse({ name: ' Firma ', egrantUrl: 'https://f.egrant.sk' }).name).toBe(
      'Firma',
    );
  });
  it('rejects an empty or too long name', () => {
    expect(GroupInputSchema.safeParse({ name: '  ', egrantUrl: 'x' }).success).toBe(false);
    expect(GroupInputSchema.safeParse({ name: 'a'.repeat(101), egrantUrl: 'x' }).success).toBe(
      false,
    );
  });
});

describe('NameBodySchema', () => {
  it('trims and bounds the name', () => {
    expect(NameBodySchema.parse({ name: ' Jan ' })).toEqual({ name: 'Jan' });
    expect(NameBodySchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('JoinBodySchema', () => {
  it('lower-cases and trims the email', () => {
    expect(JoinBodySchema.parse({ email: ' A@Example.com ' })).toEqual({ email: 'a@example.com' });
    expect(JoinBodySchema.safeParse({ email: 'nope' }).success).toBe(false);
  });
});
