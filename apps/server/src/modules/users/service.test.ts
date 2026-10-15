import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { user } from './schema.js';
import {
  addAdmin,
  deactivateUser,
  EmailTakenError,
  ensureSuperadmin,
  findUserByEmail,
  getUserById,
  listAdmins,
} from './service.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const uniqueEmail = (): string => `${randomUUID()}@example.com`;

async function insertUser(role: 'admin' | 'client', disabled = false) {
  const email = uniqueEmail();
  const id = randomUUID();
  await db.insert(user).values({
    id,
    name: `Name ${id}`,
    email,
    role,
    emailVerified: true,
    disabledAt: disabled ? new Date() : null,
  });
  return { id, email };
}

describe('ensureSuperadmin', () => {
  it('creates the user once', async () => {
    const email = uniqueEmail();
    await ensureSuperadmin(db, { email: ` ${email.toUpperCase()} `, name: 'Root' });
    await ensureSuperadmin(db, { email, name: 'Root' });
    const rows = await db.select().from(user).where(eq(user.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: 'superadmin', name: 'Root', emailVerified: true });
    expect(rows[0]?.disabledAt).toBeNull();
  });

  it('promotes an existing admin and re-enables a disabled user, keeping the name', async () => {
    const existing = await insertUser('admin', true);
    const before = await getUserById(db, existing.id);
    await ensureSuperadmin(db, { email: existing.email, name: 'Other name' });
    const after = await getUserById(db, existing.id);
    expect(after).toMatchObject({ role: 'superadmin', disabledAt: null, name: before?.name });
  });
});

describe('addAdmin', () => {
  it('lower-cases and trims the email', async () => {
    const email = uniqueEmail();
    const admin = await addAdmin(db, { email: ` ${email.toUpperCase()} `, name: ' Jane ' });
    expect(admin).toMatchObject({ email, name: 'Jane', role: 'admin' });
    expect(await findUserByEmail(db, email)).toMatchObject({ id: admin.id, emailVerified: true });
  });

  it('rejects an existing admin with kind admin, ignoring case and spaces', async () => {
    const { email } = await insertUser('admin');
    await expect(
      addAdmin(db, { email: ` ${email.toUpperCase()} `, name: 'X' }),
    ).rejects.toMatchObject({
      name: 'EmailTakenError',
      kind: 'admin',
    });
  });

  it('rejects a client email with kind client', async () => {
    const { email } = await insertUser('client');
    const error = await addAdmin(db, { email, name: 'X' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailTakenError);
    expect(error).toMatchObject({ kind: 'client' });
  });

  it('reactivates a disabled admin with the new name', async () => {
    const { id, email } = await insertUser('admin', true);
    const admin = await addAdmin(db, { email, name: 'New name' });
    expect(admin).toMatchObject({ id, name: 'New name', role: 'admin' });
    expect((await getUserById(db, id))?.disabledAt).toBeNull();
  });

  it('maps a concurrent duplicate insert to EmailTakenError admin', async () => {
    const email = uniqueEmail();
    const results = await Promise.allSettled([
      addAdmin(db, { email, name: 'A' }),
      addAdmin(db, { email, name: 'B' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
      name: 'EmailTakenError',
      kind: 'admin',
    });
  });
});

describe('listAdmins and deactivateUser', () => {
  it('skips disabled users and orders superadmin first, then by name', async () => {
    const sup = await insertUser('admin');
    await db.update(user).set({ role: 'superadmin', name: 'ZZZ super' }).where(eq(user.id, sup.id));
    const b = await addAdmin(db, { email: uniqueEmail(), name: 'bbb-order' });
    const a = await addAdmin(db, { email: uniqueEmail(), name: 'aaa-order' });
    const gone = await addAdmin(db, { email: uniqueEmail(), name: 'ccc-order' });
    const client = await insertUser('client');
    await deactivateUser(db, gone.id);

    const ids = (await listAdmins(db)).map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining([sup.id, a.id, b.id]));
    expect(ids).not.toContain(gone.id);
    expect(ids).not.toContain(client.id);
    expect(ids.indexOf(sup.id)).toBeLessThan(ids.indexOf(a.id));
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
  });

  it('getUserById and findUserByEmail return null for unknown users', async () => {
    expect(await getUserById(db, randomUUID())).toBeNull();
    expect(await findUserByEmail(db, uniqueEmail())).toBeNull();
  });
});

describe('user table checks', () => {
  /** Tries the insert in a transaction that is always rolled back, so no row can be left behind. */
  async function insertIsRejected(values: Record<string, unknown>): Promise<boolean> {
    let rejected = false;
    await db
      .transaction(async (tx) => {
        try {
          await tx.insert(user).values(values as never);
        } catch {
          rejected = true;
        }
        tx.rollback();
      })
      .catch(() => undefined); // rollback() throws by design
    return rejected;
  }

  it("inserting a user with role 'boss' fails", async () => {
    const values = { id: randomUUID(), name: 'Boss', email: uniqueEmail(), role: 'boss' };
    expect(await insertIsRejected(values)).toBe(true);
  });

  it('inserting an upper-case email fails', async () => {
    const values = { id: randomUUID(), name: 'Upper', email: `${randomUUID()}@EXAMPLE.com` };
    expect(await insertIsRejected(values)).toBe(true);
  });
});
