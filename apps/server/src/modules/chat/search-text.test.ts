import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mentionToken, type SessionUser } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { buildTestApp } from '../../../test/test-app.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { createUnverifiedClient } from '../users/service.js';
import { deleteMessage, editMessage, getMessage, sendMessage } from './messages.js';
import { messages } from './schema.js';
import { ensureGroupChannel } from './service.js';

let deps: AppDeps;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ deps, close } = await buildTestApp());
});
afterAll(() => close());

async function setup() {
  const group = await createGroup(deps.db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk/app`,
  });
  const channel = await ensureGroupChannel(deps.db, group.id);
  const make = async (name: string) => {
    const row = await createUnverifiedClient(deps.db, `${randomUUID()}@example.com`);
    await deps.db.update(user).set({ emailVerified: true, name }).where(eq(user.id, row.id));
    await addMember(deps.db, group.id, row.id);
    return { id: row.id, email: row.email, name, role: 'client', finance: false } as SessionUser;
  };
  return { channel, author: await make('Anna'), other: await make('Boris') };
}

const searchTextOf = async (id: string) => {
  const [row] = await deps.db
    .select({ searchText: messages.searchText })
    .from(messages)
    .where(eq(messages.id, id));
  return row!.searchText;
};

/** Search in chat messages (2026-10-19): `messages.search_text`, a stored generated column. */
describe('messages.search_text', () => {
  it('stores the body folded, without mention tokens', async () => {
    const { channel, author, other } = await setup();
    const { message } = await sendMessage(deps, {
      channel,
      author,
      data: {
        body: `Dobrý deň ${mentionToken(other.id)}, ROZPOČET je v prílohe`,
        clientId: randomUUID(),
      },
    });
    expect(await searchTextOf(message.id)).toBe('dobry den  , rozpocet je v prilohe');
  });

  it('follows an edit and empties on delete', async () => {
    const { channel, author } = await setup();
    const { message } = await sendMessage(deps, {
      channel,
      author,
      data: { body: 'Pôvodný text', clientId: randomUUID() },
    });
    const row = (await getMessage(deps.db, message.id))!;
    await editMessage(deps, { message: row, channel, body: 'Faktúra' });
    expect(await searchTextOf(message.id)).toBe('faktura');
    await deleteMessage(deps, { message: (await getMessage(deps.db, message.id))!, channel });
    expect(await searchTextOf(message.id)).toBe('');
  });

  it('the index exists with its predicate', async () => {
    const [row] = await deps.db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'messages_search_text_trgm_idx'`,
    );
    const def = row!.indexdef;
    expect(def).toContain('gin_trgm_ops');
    expect(def).toContain('(deleted_at IS NULL)');
    expect(def).toContain("search_text <> ''");
  });
});
