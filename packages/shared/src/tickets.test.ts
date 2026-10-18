import { describe, expect, it } from 'vitest';
import {
  TicketCreateBodySchema,
  TicketIntakeBodySchema,
  TicketListQuerySchema,
  TicketPatchBodySchema,
  intakeFieldNames,
} from './tickets.js';
import { base64DecodedSize } from './files.js';

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
      files: [],
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

  it('rejects a bad date, a bad email and a bad url', () => {
    expect(TicketIntakeBodySchema.safeParse({ body: 'x', due_date: '2026-02-30' }).success).toBe(
      false,
    );
    expect(TicketIntakeBodySchema.safeParse({ body: 'x', email: 'nope' }).success).toBe(false);
    expect(TicketIntakeBodySchema.safeParse({ body: 'x', url: 'javascript:1' }).success).toBe(
      false,
    );
  });

  it('ignores the removed file_links', () => {
    const parsed = TicketIntakeBodySchema.parse({ body: 'x', file_links: ['ftp://f.sk/a'] });
    expect(parsed).not.toHaveProperty('file_links');
  });

  describe('files', () => {
    const parse = (files: unknown) => TicketIntakeBodySchema.safeParse({ body: 'x', files });
    const fieldsOf = (files: unknown) => {
      const result = parse(files);
      return result.success ? [] : intakeFieldNames(result.error.issues);
    };

    it('takes name and strict base64; the path is dropped, content_type is optional', () => {
      const result = parse([
        { name: ' C:\\Users\\jana\\shot.png ', content_base64: 'iVBORw0KGgo=' },
        { name: 'a.pdf', content_base64: 'JVBERi0xLjcK', content_type: 'application/pdf' },
      ]);
      expect(result.success && result.data.files).toEqual([
        { name: 'shot.png', content_base64: 'iVBORw0KGgo=', content_type: null },
        { name: 'a.pdf', content_base64: 'JVBERi0xLjcK', content_type: 'application/pdf' },
      ]);
      expect(TicketIntakeBodySchema.parse({ body: 'x' }).files).toEqual([]);
    });

    it('names a bad file field as files[i].field', () => {
      const ok = { name: 'a.png', content_base64: 'QUJD' };
      expect(fieldsOf([ok, { ...ok, content_base64: 'QUJD\n' }])).toEqual([
        'files[1].content_base64',
      ]);
      for (const bad of ['QUJ', 'QU=D', 'QUJD====', 'Q+J_', '', 'QUJD QUJD', 42]) {
        expect(fieldsOf([{ ...ok, content_base64: bad }])).toEqual(['files[0].content_base64']);
      }
      expect(fieldsOf([{ ...ok, name: '' }])).toEqual(['files[0].name']);
      expect(fieldsOf([{ ...ok, name: 'dir/' }])).toEqual(['files[0].name']);
      expect(fieldsOf([{ ...ok, name: `${'a'.repeat(197)}.png` }])).toEqual(['files[0].name']);
      expect(fieldsOf([{ ...ok, name: `${'a'.repeat(196)}.png` }])).toEqual([]);
      expect(fieldsOf([{ content_base64: 'QUJD' }])).toEqual(['files[0].name']);
    });

    it('takes at most 10 files', () => {
      const file = { name: 'a.txt', content_base64: 'QUJD' };
      expect(fieldsOf(Array.from({ length: 10 }, () => file))).toEqual([]);
      expect(fieldsOf(Array.from({ length: 11 }, () => file))).toEqual(['files']);
      expect(fieldsOf('nope')).toEqual(['files']);
    });

    it('base64DecodedSize counts the decoded bytes without decoding', () => {
      expect(base64DecodedSize('')).toBe(0);
      expect(base64DecodedSize('QQ==')).toBe(1);
      expect(base64DecodedSize('QUI=')).toBe(2);
      expect(base64DecodedSize('QUJD')).toBe(3);
    });
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
    expect(TicketListQuerySchema.parse({ clients: 'a,b,a' })).toMatchObject({
      clients: ['a', 'b'],
    });
  });
});
