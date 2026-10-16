import { describe, expect, it } from 'vitest';
import {
  TicketCreateBodySchema,
  TicketIntakeBodySchema,
  TicketListQuerySchema,
  TicketPatchBodySchema,
} from './tickets.js';

describe('TicketIntakeBodySchema', () => {
  it('rejects a body without subject, body and area', () => {
    expect(TicketIntakeBodySchema.safeParse({}).success).toBe(false);
    expect(TicketIntakeBodySchema.safeParse({ email: 'a@b.sk', subject: '  ' }).success).toBe(
      false,
    );
  });

  it('accepts a subject alone and fills the rest with nulls', () => {
    const parsed = TicketIntakeBodySchema.parse({ subject: 'Chyba' });
    expect(parsed).toMatchObject({
      subject: 'Chyba',
      email: null,
      body: null,
      file_links: [],
      due_date: null,
      instance_url: null,
    });
  });

  it('takes an optional request_id of 1 to 100 characters', () => {
    expect(TicketIntakeBodySchema.parse({ subject: 'x' }).request_id).toBeNull();
    expect(TicketIntakeBodySchema.parse({ subject: 'x', request_id: ' abc-1 ' }).request_id).toBe(
      'abc-1',
    );
    expect(TicketIntakeBodySchema.safeParse({ subject: 'x', request_id: '' }).success).toBe(false);
    expect(
      TicketIntakeBodySchema.safeParse({ subject: 'x', request_id: 'a'.repeat(101) }).success,
    ).toBe(false);
    expect(TicketIntakeBodySchema.safeParse({ subject: 'x', request_id: 7 }).success).toBe(false);
  });

  it('trims and lower-cases the email; empty strings are not given', () => {
    const parsed = TicketIntakeBodySchema.parse({ body: 'x', email: ' Jana@X.sk ', phone: '' });
    expect(parsed.email).toBe('jana@x.sk');
    expect(parsed.phone).toBeNull();
  });

  it('rejects 21 file links, a ftp: link, a bad date and a bad email', () => {
    const many = Array.from({ length: 21 }, (_, i) => `https://f.sk/${i}`);
    expect(TicketIntakeBodySchema.safeParse({ body: 'x', file_links: many }).success).toBe(false);
    expect(
      TicketIntakeBodySchema.safeParse({ body: 'x', file_links: ['ftp://f.sk/a'] }).success,
    ).toBe(false);
    expect(TicketIntakeBodySchema.safeParse({ body: 'x', due_date: '2026-02-30' }).success).toBe(
      false,
    );
    expect(TicketIntakeBodySchema.safeParse({ body: 'x', email: 'nope' }).success).toBe(false);
    expect(TicketIntakeBodySchema.safeParse({ body: 'x', url: 'javascript:1' }).success).toBe(
      false,
    );
  });

  it('rejects a subject over 300 characters', () => {
    expect(TicketIntakeBodySchema.safeParse({ subject: 'x'.repeat(301) }).success).toBe(false);
  });
});

describe('TicketCreateBodySchema', () => {
  it('needs a group and content; dedupes file ids', () => {
    expect(TicketCreateBodySchema.safeParse({ subject: 'x' }).success).toBe(false);
    const parsed = TicketCreateBodySchema.parse({ groupId: 'g', body: 'x', fileIds: ['f', 'f'] });
    expect(parsed.fileIds).toEqual(['f']);
    expect(parsed.requesterEmail).toBeNull();
  });
});

describe('TicketPatchBodySchema', () => {
  it('needs at least one field and keeps only the sent ones', () => {
    expect(TicketPatchBodySchema.safeParse({}).success).toBe(false);
    expect(TicketPatchBodySchema.parse({ status: 'resolved' })).toEqual({ status: 'resolved' });
    expect(TicketPatchBodySchema.parse({ dueDate: null })).toEqual({ dueDate: null });
    expect(TicketPatchBodySchema.safeParse({ status: 'closed' }).success).toBe(false);
  });
});

describe('TicketListQuerySchema', () => {
  it('defaults to open tickets of my clients and parses the clients list', () => {
    expect(TicketListQuerySchema.parse({})).toMatchObject({ status: 'open', scope: 'mine' });
    expect(TicketListQuerySchema.parse({ clients: 'a,b,a', following: 'true' })).toMatchObject({
      clients: ['a', 'b'],
      following: true,
    });
  });
});
