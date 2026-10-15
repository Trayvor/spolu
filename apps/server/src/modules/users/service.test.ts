import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { user } from './schema.js';
import {
  addAdmin,
  applyEmailFallback,
  changeUserEmail,
  deactivateUser,
  EmailTakenError,
  ensureSuperadmin,
  findUserByEmail,
  getNotificationProfiles,
  getUserById,
  listAdmins,
  reactivateUser,
  updateNotificationPrefs,
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

  it('re-enables a disabled superadmin, keeping the name', async () => {
    const email = uniqueEmail();
    expect(await ensureSuperadmin(db, { email, name: 'Root' })).toBe('ok');
    await db.update(user).set({ disabledAt: new Date() }).where(eq(user.email, email));
    expect(await ensureSuperadmin(db, { email, name: 'Other name' })).toBe('ok');
    const [row] = await db.select().from(user).where(eq(user.email, email));
    expect(row).toMatchObject({ role: 'superadmin', disabledAt: null, name: 'Root' });
  });

  it('never promotes an existing admin or client', async () => {
    for (const role of ['admin', 'client'] as const) {
      const existing = await insertUser(role, true);
      const before = await getUserById(db, existing.id);
      expect(await ensureSuperadmin(db, { email: existing.email, name: 'Root' })).toBe('refused');
      expect(await getUserById(db, existing.id)).toEqual(before);
    }
  });

  it('a client who claims the superadmin email does not become superadmin on boot', async () => {
    const email = uniqueEmail();
    const client = await insertUser('client');
    await db.update(user).set({ email }).where(eq(user.id, client.id));
    expect(await ensureSuperadmin(db, { email, name: 'Root' })).toBe('refused');
    expect(await getUserById(db, client.id)).toMatchObject({ role: 'client' });
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

describe('reactivateUser', () => {
  it('clears disabled_at', async () => {
    const { id } = await insertUser('client', true);
    await reactivateUser(db, id);
    expect((await getUserById(db, id))?.disabledAt).toBeNull();
  });
});

describe('notification profile', () => {
  it('a new user has push on, email off, no default mode and language sk', async () => {
    const { id, email } = await insertUser('client');
    const profiles = await getNotificationProfiles(db, [id]);
    expect(profiles.get(id)).toEqual({
      id,
      email,
      name: `Name ${id}`,
      role: 'client',
      language: 'sk',
      pushEnabled: true,
      emailEnabled: false,
      defaultGroupMode: null,
      disabled: false,
    });
    expect((await getNotificationProfiles(db, [])).size).toBe(0);
  });

  it('updateNotificationPrefs changes only the given switch', async () => {
    const { id } = await insertUser('admin');
    await updateNotificationPrefs(db, id, { emailEnabled: true });
    expect((await getNotificationProfiles(db, [id])).get(id)).toMatchObject({
      pushEnabled: true,
      emailEnabled: true,
    });
    await updateNotificationPrefs(db, id, { pushEnabled: false });
    expect((await getNotificationProfiles(db, [id])).get(id)).toMatchObject({
      pushEnabled: false,
      emailEnabled: true,
    });
  });

  it('applyEmailFallback turns email on once and never again', async () => {
    const { id } = await insertUser('client');
    expect(await applyEmailFallback(db, id)).toBe(true);
    expect((await getNotificationProfiles(db, [id])).get(id)?.emailEnabled).toBe(true);
    await updateNotificationPrefs(db, id, { emailEnabled: false });
    expect(await applyEmailFallback(db, id)).toBe(false);
    expect((await getNotificationProfiles(db, [id])).get(id)?.emailEnabled).toBe(false);
  });
});

describe('changeUserEmail', () => {
  it('to an address another account has throws EmailTakenError, and the email stays', async () => {
    const a = await insertUser('client');
    const b = await insertUser('admin');
    const error = await changeUserEmail(db, a.id, b.email).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailTakenError);
    expect(error).toMatchObject({ kind: 'admin' });
    expect((await getUserById(db, a.id))?.email).toBe(a.email);
  });

  it('stores the new address', async () => {
    const { id } = await insertUser('client');
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, id));
    const next = uniqueEmail();
    await changeUserEmail(db, id, next);
    expect(await getUserById(db, id)).toMatchObject({ email: next, emailVerified: true });
  });
});
