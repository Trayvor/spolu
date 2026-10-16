import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { DEFAULT_CHANNELS, NotificationCategories } from '@spolu/shared';
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
  findUserByMailbox,
  getNotificationChannels,
  getNotificationProfiles,
  getUserById,
  listAdmins,
  mailboxKey,
  reactivateUser,
  setNotificationChannel,
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
  it('a new user has the default channels, no default mode and language sk', async () => {
    const { id, email } = await insertUser('client');
    const profiles = await getNotificationProfiles(db, [id]);
    expect(profiles.get(id)).toEqual({
      id,
      email,
      name: `Name ${id}`,
      role: 'client',
      language: 'sk',
      channels: DEFAULT_CHANNELS,
      defaultGroupMode: null,
      disabled: false,
    });
    expect(await getNotificationChannels(db, id)).toEqual(DEFAULT_CHANNELS);
    expect((await getNotificationProfiles(db, [])).size).toBe(0);
  });

  it('setNotificationChannel changes only the given group', async () => {
    const { id } = await insertUser('admin');
    await setNotificationChannel(db, id, 'chat', 'none');
    await setNotificationChannel(db, id, 'tickets', 'email');
    expect(await getNotificationChannels(db, id)).toEqual({
      ...DEFAULT_CHANNELS,
      chat: 'none',
      tickets: 'email',
    });
    expect((await getNotificationProfiles(db, [id])).get(id)?.channels.chat).toBe('none');
  });

  it('a stored value that is not a channel falls back to the default', async () => {
    const { id } = await insertUser('client');
    await db.execute(
      sql`update "user" set notification_channels = '{"chat": 5, "tasks": "loud"}'::jsonb where id = ${id}`,
    );
    expect(await getNotificationChannels(db, id)).toEqual(DEFAULT_CHANNELS);
  });

  it('the migration dropped the old switches and defaults the column to {}', async () => {
    const columns = await db.execute<{ column_name: string; column_default: string | null }>(sql`
      select column_name, column_default from information_schema.columns
      where table_name = 'user' and column_name in ('push_enabled', 'email_enabled', 'notification_channels')
    `);
    expect([...columns]).toEqual([
      { column_name: 'notification_channels', column_default: "'{}'::jsonb" },
    ]);
  });
});

describe('applyEmailFallback', () => {
  it('adds email to every listed push group once', async () => {
    const { id } = await insertUser('client');
    expect(await applyEmailFallback(db, id, [...NotificationCategories])).toBe(true);
    expect(await getNotificationChannels(db, id)).toEqual({
      chat: 'both',
      tasks: 'both',
      tickets: 'both',
      knowledge: 'both',
    });
    expect(await applyEmailFallback(db, id, [...NotificationCategories])).toBe(false);
  });

  it('keeps email, both and none, and touches only the listed groups', async () => {
    const { id } = await insertUser('client');
    await setNotificationChannel(db, id, 'chat', 'none');
    await setNotificationChannel(db, id, 'tasks', 'email');
    expect(await applyEmailFallback(db, id, ['chat', 'tasks', 'tickets'])).toBe(false);
    expect(await getNotificationChannels(db, id)).toEqual({
      chat: 'none',
      tasks: 'email',
      tickets: 'both',
      knowledge: 'push',
    });
  });

  it('never undoes a later manual change', async () => {
    const { id } = await insertUser('client');
    expect(await applyEmailFallback(db, id, ['chat'])).toBe(true);
    await setNotificationChannel(db, id, 'chat', 'push');
    expect(await applyEmailFallback(db, id, ['chat'])).toBe(false);
    expect((await getNotificationChannels(db, id)).chat).toBe('push');
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

describe('migration 0016 keeps the iOS fallback email', () => {
  const migration = readFileSync(
    new URL('../../infra/db/migrations/0016_notification_groups.sql', import.meta.url),
    'utf8',
  );
  const statements = migration.split('--> statement-breakpoint').map((s) => s.trim());
  const keep = statements.find((s) => s.includes('"email_fallback_at" IS NOT NULL'));

  it('runs after the new column and before the old switches are dropped', () => {
    expect(keep).toBeDefined();
    const at = statements.indexOf(keep!);
    expect(statements.findIndex((s) => s.includes('ADD COLUMN "notification_channels"'))).toBe(
      at - 1,
    );
    expect(statements.findIndex((s) => s.includes('DROP COLUMN "email_enabled"'))).toBeGreaterThan(
      at,
    );
  });

  it('gives email and push to users whose email came from the fallback, nobody else', async () => {
    // A temporary "user" table shadows the real one inside this transaction, so the migration's
    // own statement runs unchanged on rows shaped like the database before 0016.
    class Rollback extends Error {}
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`
          create temp table "user" (
            id text primary key,
            email_enabled boolean not null,
            email_fallback_at timestamptz,
            notification_channels jsonb not null default '{}'
          ) on commit drop
        `);
        await tx.execute(sql`
          insert into "user" (id, email_enabled, email_fallback_at) values
            ('fallback', true, now()),
            ('fallback-then-off', false, now()),
            ('chose-email', true, null),
            ('plain', false, null)
        `);
        await tx.execute(sql.raw(keep!));
        const rows = await tx.execute<{ id: string; notification_channels: unknown }>(
          sql`select id, notification_channels from "user" order by id`,
        );
        expect(Object.fromEntries([...rows].map((r) => [r.id, r.notification_channels]))).toEqual({
          'chose-email': {},
          fallback: { chat: 'both', tasks: 'both', knowledge: 'both' },
          'fallback-then-off': {},
          plain: {},
        });
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});

describe('mailboxKey', () => {
  it('ignores case and spaces, a +tag, and for gmail the dots and googlemail.com', () => {
    expect(mailboxKey(' Jana.Nova+eGrant@Firma.sk ')).toBe('jana.nova@firma.sk');
    expect(mailboxKey('j.a.n.a+x@googlemail.com')).toBe('jana@gmail.com');
    expect(mailboxKey('JANA@gmail.com')).toBe('jana@gmail.com');
  });
});

describe('findUserByMailbox', () => {
  it('finds the account of the same mailbox, preferring an admin', async () => {
    const local = `m${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const clientId = randomUUID();
    const adminId = randomUUID();
    await db.insert(user).values([
      { id: clientId, name: 'C', email: `${local}+old@gmail.com`, role: 'client' },
      {
        id: adminId,
        name: 'A',
        email: `${local.slice(0, 4)}.${local.slice(4)}@gmail.com`,
        role: 'admin',
      },
    ]);
    try {
      expect((await findUserByMailbox(db, `${local}@googlemail.com`))?.id).toBe(adminId);
      expect(await findUserByMailbox(db, `${local}x@gmail.com`)).toBeNull();
    } finally {
      await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, adminId));
    }
  });
});

describe('one account per address', () => {
  it('the database refuses a second account with the same address, also in another case', async () => {
    const email = uniqueEmail();
    await db.insert(user).values({ id: randomUUID(), name: 'A', email, role: 'client' });
    await expect(
      db.insert(user).values({ id: randomUUID(), name: 'B', email, role: 'admin' }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(user)
        .values({ id: randomUUID(), name: 'C', email: email.toUpperCase(), role: 'client' }),
    ).rejects.toThrow();
  });
});
