import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import {
  addMembership,
  getMembership,
  listMemberships,
  removeMembership,
} from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import {
  addAdmin,
  createUnverifiedClient,
  deactivateUser,
  findUserByEmail,
} from '../users/service.js';
import { resolveRequester } from './requester.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const newGroup = () =>
  createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });
const newEmail = () => `${randomUUID()}@example.com`;

describe('resolveRequester', () => {
  it("an admin's email: that admin, no membership", async () => {
    const g = await newGroup();
    const admin = await addAdmin(db, { email: newEmail(), name: 'Ad' });
    expect(await resolveRequester(db, g.id, admin.email, 'X')).toEqual({
      userId: admin.id,
      notify: true,
    });
    expect(await getMembership(db, admin.id, g.id)).toBeNull();
  });

  it('an active client of the group: that client, unchanged', async () => {
    const g = await newGroup();
    const c = await createUnverifiedClient(db, newEmail());
    await addMembership(db, c.id, g.id, 'client');
    expect(await resolveRequester(db, g.id, c.email, null)).toEqual({ userId: c.id, notify: true });
    expect((await getMembership(db, c.id, g.id))?.role).toBe('client');
  });

  it('a client of another group: a ziadatel membership here, still a client there', async () => {
    const [a, b] = [await newGroup(), await newGroup()];
    const c = await createUnverifiedClient(db, newEmail());
    await addMembership(db, c.id, a.id, 'client');
    expect((await resolveRequester(db, b.id, c.email, null)).userId).toBe(c.id);
    expect((await getMembership(db, c.id, a.id))?.role).toBe('client');
    expect((await getMembership(db, c.id, b.id))?.role).toBe('ziadatel');
  });

  it('an unknown email: a new client account with the name, a ziadatel membership', async () => {
    const g = await newGroup();
    const email = newEmail();
    const result = await resolveRequester(db, g.id, email, '  Jana Nová ');
    const created = await findUserByEmail(db, email);
    expect(result).toEqual({ userId: created!.id, notify: true });
    expect(created).toMatchObject({
      role: 'client',
      name: 'Jana Nová',
      language: 'sk',
      emailVerified: false,
    });
    expect((await getMembership(db, created!.id, g.id))?.role).toBe('ziadatel');
  });

  it('a membership an admin removed: no account link and no email', async () => {
    const g = await newGroup();
    const c = await createUnverifiedClient(db, newEmail());
    await addMembership(db, c.id, g.id, 'ziadatel');
    await removeMembership(db, g.id, c.id);
    expect(await resolveRequester(db, g.id, c.email, null)).toEqual({
      userId: null,
      notify: false,
    });
  });

  it('a disabled account: no account link and no email', async () => {
    const g = await newGroup();
    const c = await createUnverifiedClient(db, newEmail());
    await deactivateUser(db, c.id);
    expect(await resolveRequester(db, g.id, c.email, null)).toEqual({
      userId: null,
      notify: false,
    });
    expect(await getMembership(db, c.id, g.id)).toBeNull();
  });

  it('no email: no initiator account', async () => {
    const g = await newGroup();
    expect(await resolveRequester(db, g.id, null, 'Jana')).toEqual({ userId: null, notify: false });
  });

  it('the same email in tickets of two clients: one account, two ziadatel memberships', async () => {
    const [a, b] = [await newGroup(), await newGroup()];
    const email = newEmail();
    const first = await resolveRequester(db, a.id, email, 'J');
    const second = await resolveRequester(db, b.id, email, 'J');
    expect(second.userId).toBe(first.userId);
    expect((await listMemberships(db, first.userId!)).map((m) => m.role)).toEqual([
      'ziadatel',
      'ziadatel',
    ]);
  });

  it('matches the email whatever its case and spaces', async () => {
    const g = await newGroup();
    const c = await createUnverifiedClient(db, newEmail());
    await addMembership(db, c.id, g.id, 'client');
    const messy = `  ${c.email.toUpperCase()} `;
    expect((await resolveRequester(db, g.id, messy, null)).userId).toBe(c.id);
  });
});
