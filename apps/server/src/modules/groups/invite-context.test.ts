import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { InviteContext } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import type { EmailMessage } from '../../infra/email/index.js';
import { EMAIL_JOB } from '../../infra/email/index.js';
import { addAdmin, findUserByEmail } from '../users/service.js';
import { removeMembership } from './memberships.js';
import { createGroup, setGroupDeactivated } from './service.js';
import { signInviteToken, verifyInviteToken } from './invite-token.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://i${randomUUID().replaceAll('-', '')}.egrant.sk`;

describe('invite token', () => {
  const input = { groupId: randomUUID(), invitedBy: 'Jana Nováková', email: 'Eva@Example.com' };

  it('round-trips the group and the inviter for the same email, in any case', () => {
    const token = signInviteToken('secret', input);
    expect(verifyInviteToken('secret', token, 'eva@example.com')).toEqual({
      groupId: input.groupId,
      invitedBy: 'Jana Nováková',
    });
  });

  it('refuses another email, another secret, a changed name and malformed tokens', () => {
    const token = signInviteToken('secret', input);
    expect(verifyInviteToken('secret', token, 'other@example.com')).toBeNull();
    expect(verifyInviteToken('other', token, input.email)).toBeNull();
    const [g, , sig] = token.split('.');
    const forged = `${g}.${Buffer.from('Banka').toString('base64url')}.${sig}`;
    expect(verifyInviteToken('secret', forged, input.email)).toBeNull();
    for (const bad of ['', 'a.b', 'a.b.c.d', `${g}.!!.${sig}`, `${g}.x.`]) {
      expect(verifyInviteToken('secret', bad, input.email)).toBeNull();
    }
  });
});

describe('invitation context API', () => {
  let test: TestApp;
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  const context = (token: string, email: string) =>
    test.app.inject({
      method: 'GET',
      url: `/api/invitations/context?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`,
    });

  /** Invites a new email into a new group and returns the link of the email that went out. */
  async function invited() {
    const adminEmail = newEmail();
    await addAdmin(test.deps.db, { email: adminEmail, name: 'Jana Nováková' });
    const cookie = await loginAs(test.app, adminEmail);
    const group = await createGroup(test.deps.db, { name: 'Obec Lúky', egrantUrl: newUrl() });
    const email = newEmail();
    const send = vi.spyOn(test.deps.jobs, 'send');
    try {
      const res = await test.app.inject({
        method: 'POST',
        url: `/api/groups/${group.id}/members`,
        headers: { cookie },
        payload: { email },
      });
      expect(res.statusCode).toBe(201);
      const mail = send.mock.calls.find(([name]) => name === EMAIL_JOB)![1] as EmailMessage;
      const link = /https?:\/\/\S*\/login\?\S+/.exec(mail.text)![0];
      return { group, email, link: new URL(link) };
    } finally {
      send.mockRestore();
    }
  }

  it('the invitation link carries a token that names the group and the inviter, without a session', async () => {
    const { email, link } = await invited();
    expect(link.searchParams.get('email')).toBe(email);
    const token = link.searchParams.get('invite');
    expect(token).toBeTruthy();
    const res = await context(token!, email);
    expect(res.statusCode).toBe(200);
    expect(res.json<InviteContext>()).toEqual({
      groupName: 'Obec Lúky',
      invitedBy: 'Jana Nováková',
    });
  });

  it('is 404 for another email, a forged token, and after the membership was removed', async () => {
    const { group, email, link } = await invited();
    const token = link.searchParams.get('invite')!;
    expect((await context(token, newEmail())).statusCode).toBe(404);
    expect((await context(`${token}x`, email)).statusCode).toBe(404);
    expect(
      (await test.app.inject({ method: 'GET', url: '/api/invitations/context' })).statusCode,
    ).toBe(404);

    const person = await findUserByEmail(test.deps.db, email);
    await removeMembership(test.deps.db, group.id, person!.id);
    const gone = await context(token, email);
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toEqual({ error: 'not_found' });
  });

  it('is 404 while the group is deactivated', async () => {
    const { group, email, link } = await invited();
    await setGroupDeactivated(test.deps.db, group.id, true);
    expect((await context(link.searchParams.get('invite')!, email)).statusCode).toBe(404);
  });
});
