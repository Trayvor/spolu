import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createGroup } from '../groups/service.js';
import { addAdmin } from '../users/service.js';
import { files } from '../files/schema.js';
import { reminderSets } from '../reminders/schema.js';
import { knowledgeItems } from './schema.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const newGroup = () =>
  createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk/app`,
  });
const newAdmin = () => addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Ada' });

/** The CHECK constraint a failed insert violated (drizzle wraps the postgres error in `cause`). */
async function violatedConstraint(insert: Promise<unknown>): Promise<string | undefined> {
  try {
    await insert;
  } catch (error) {
    const pg = (error as { cause?: { constraint_name?: string } }).cause;
    return pg?.constraint_name ?? (error as { constraint_name?: string }).constraint_name;
  }
  return undefined;
}

describe('knowledge and reminders tables', () => {
  it('pg_trgm is installed', async () => {
    const rows = await db.execute(sql`select 1 from pg_extension where extname = 'pg_trgm'`);
    expect(rows).toHaveLength(1);
  });

  it('a link row without url violates knowledge_items_url_check', async () => {
    const [group, admin] = await Promise.all([newGroup(), newAdmin()]);
    const base = {
      groupId: group.id,
      title: 'Calls',
      createdBy: admin.id,
      searchText: 'calls',
    };
    expect(
      await violatedConstraint(
        db.insert(knowledgeItems).values({ ...base, id: randomUUID(), type: 'link' }),
      ),
    ).toBe('knowledge_items_url_check');
    expect(
      await violatedConstraint(
        db
          .insert(knowledgeItems)
          .values({ ...base, id: randomUUID(), type: 'note', url: 'https://x.sk' }),
      ),
    ).toBe('knowledge_items_url_check');
    const id = randomUUID();
    await db
      .insert(knowledgeItems)
      .values({ ...base, id, type: 'link', url: 'https://opvai.sk/vyzvy' });
    const [row] = await db.select().from(knowledgeItems).where(eq(knowledgeItems.id, id));
    expect(row).toMatchObject({ visibility: 'public', body: '', url: 'https://opvai.sk/vyzvy' });
  });

  it('rejects an unknown type or visibility and a title over 200 characters', async () => {
    const [group, admin] = await Promise.all([newGroup(), newAdmin()]);
    const base = { groupId: group.id, title: 't', createdBy: admin.id, searchText: 't' };
    expect(
      await violatedConstraint(
        db.insert(knowledgeItems).values({ ...base, id: randomUUID(), type: 'video' }),
      ),
    ).toBe('knowledge_items_type_check');
    expect(
      await violatedConstraint(
        db
          .insert(knowledgeItems)
          .values({ ...base, id: randomUUID(), type: 'note', visibility: 'secret' }),
      ),
    ).toBe('knowledge_items_visibility_check');
    expect(
      await violatedConstraint(
        db
          .insert(knowledgeItems)
          .values({ ...base, id: randomUUID(), type: 'note', title: 'a'.repeat(201) }),
      ),
    ).toBe('knowledge_items_title_check');
  });

  it('a reminder set needs its knowledge item', async () => {
    const [group, admin] = await Promise.all([newGroup(), newAdmin()]);
    expect(
      await violatedConstraint(
        db
          .insert(reminderSets)
          .values({ id: randomUUID(), groupId: group.id, createdBy: admin.id }),
      ),
    ).toBe('reminder_sets_subject_check');
    expect(
      await violatedConstraint(
        db.insert(reminderSets).values({
          id: randomUUID(),
          groupId: group.id,
          createdBy: admin.id,
          knowledgeItemId: randomUUID(),
        }),
      ),
    ).toBe('reminder_sets_knowledge_item_id_knowledge_items_id_fk');
  });

  it('files.admins_only defaults to false', async () => {
    const [group, admin] = await Promise.all([newGroup(), newAdmin()]);
    const id = randomUUID();
    await db.insert(files).values({
      id,
      groupId: group.id,
      uploadedBy: admin.id,
      name: 'a.pdf',
      mime: 'application/pdf',
      size: 1,
      storageKey: `files/${group.id}/${id}`,
    });
    const [row] = await db.select().from(files).where(eq(files.id, id));
    expect(row?.adminsOnly).toBe(false);
  });
});
