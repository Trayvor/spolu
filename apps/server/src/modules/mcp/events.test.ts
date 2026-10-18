import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BoardEvents, ChatEvents } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { callTool, mcpToken } from '../../../test/mcp.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';

/** A write through MCP is the route itself: the same socket events and notifications (spec §5.3). */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

describe('MCP writes emit the app’s events', () => {
  let test: TestApp;
  let baseUrl = '';
  let groupId: string;
  let adminId: string;
  let token: string;
  let clientId: string;
  let socket: Socket;
  const admins: string[] = [];

  beforeAll(async () => {
    test = await buildTestApp();
    await test.app.listen({ port: 0, host: '127.0.0.1' });
    const address = test.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
    const db = test.deps.db;
    const a = await addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Ada' });
    admins.push(a.id);
    adminId = a.id;
    token = await mcpToken(db, a.id);
    const g = await createGroup(db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    groupId = g.id;
    const email = `${randomUUID()}@example.com`;
    const c = await createUnverifiedClient(db, email, 'Cyril');
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, c.id));
    await addMembership(db, c.id, groupId, 'client');
    clientId = c.id;
    // A client's socket joins its group's room by itself.
    socket = connect(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { cookie: await loginAs(test.app, email) },
    });
    await new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(null));
      socket.once('connect_error', reject);
    });
  });
  afterAll(async () => {
    socket?.close();
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  const next = <T>(event: string) =>
    new Promise<T>((resolve) => socket.once(event, (payload: T) => resolve(payload)));

  it('create_task pushes board:task to the group and notifies the assignee', async () => {
    const heard = next<{ task: { id: string; title: string }; actor: { id: string } }>(
      BoardEvents.task,
    );
    const res = await callTool(test.app, token, 'create_task', {
      groupId,
      task: { title: 'Z MCP', assigneeIds: [clientId] },
    });
    expect(res.isError).toBe(false);
    const taskId = (res.json as { id: string }).id;
    const event = await heard;
    expect(event.task).toMatchObject({ id: taskId, title: 'Z MCP' });
    expect(event.actor.id).toBe(adminId);
    const told = await test.deps.db
      .select({ kind: notificationEvents.kind })
      .from(notificationEvents)
      .where(and(eq(notificationEvents.userId, clientId), eq(notificationEvents.groupId, groupId)));
    expect(told.map((e) => e.kind)).toContain('task.assigned');
  });

  it('send_message pushes chat:message with the user as its author', async () => {
    const channel = await callTool(test.app, token, 'get_chat_channel', { groupId });
    const channelId = (channel.json as { id: string }).id;
    const heard = next<{ message: { id: string; author: { id: string }; body: string } }>(
      ChatEvents.message,
    );
    const res = await callTool(test.app, token, 'send_message', { channelId, body: 'Ahoj z AI' });
    expect(res.isError).toBe(false);
    const event = await heard;
    expect(event.message).toMatchObject({
      id: (res.json as { id: string }).id,
      body: 'Ahoj z AI',
      author: { id: adminId },
    });
  });
});
