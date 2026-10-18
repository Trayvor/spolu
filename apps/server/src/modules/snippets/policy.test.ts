import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@spolu/shared';
import { canChangeSnippet, canReadSnippet, canUseSnippets } from './policy.js';

const user = (role: SessionUser['role'], id: string = role): SessionUser => ({
  id,
  email: `${id}@example.com`,
  name: id,
  role,
  finance: false,
});
const superadmin = user('superadmin');
const admin = user('admin');
const other = user('admin', 'other');
const client = user('client');

describe('snippets policy', () => {
  it.each([
    [superadmin, true],
    [admin, true],
    [client, false],
  ] as const)('canUseSnippets(%o) is %s', (actor, expected) => {
    expect(canUseSnippets(actor)).toBe(expected);
  });

  it.each([
    ['own private', admin, { authorId: admin.id, shared: false }, true],
    ['own shared', admin, { authorId: admin.id, shared: true }, true],
    ["another's shared", other, { authorId: admin.id, shared: true }, true],
    ["another's private", other, { authorId: admin.id, shared: false }, false],
    [
      "the superadmin and another's private",
      superadmin,
      { authorId: admin.id, shared: false },
      false,
    ],
    ['a client, even a shared one', client, { authorId: admin.id, shared: true }, false],
  ] as const)('read: %s', (_case, actor, snippet, expected) => {
    expect(canReadSnippet(actor, snippet)).toBe(expected);
  });

  it.each([
    ['own private', admin, { authorId: admin.id, shared: false }, true],
    ['own shared', admin, { authorId: admin.id, shared: true }, true],
    ["another's shared", other, { authorId: admin.id, shared: true }, false],
    [
      "the superadmin and another's shared",
      superadmin,
      { authorId: admin.id, shared: true },
      false,
    ],
    ['a client who once was its author', client, { authorId: client.id, shared: false }, false],
  ] as const)('change: %s', (_case, actor, snippet, expected) => {
    expect(canChangeSnippet(actor, snippet)).toBe(expected);
  });
});
