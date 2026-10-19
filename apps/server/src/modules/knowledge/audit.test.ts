import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { KnowledgeFolderDto, KnowledgeItemDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { createGroup } from '../groups/service.js';
import { addAdmin, deactivateUser } from '../users/service.js';
import { attachTeamsTranscript } from './meeting-teams.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;

describe('knowledge: audit rows', () => {
  let test: TestApp;
  let admin: { id: string; cookie: string };

  beforeAll(async () => {
    test = await buildTestApp();
    const email = `${randomUUID()}@example.com`;
    const row = await addAdmin(test.deps.db, { email, name: 'Jana Nováková' });
    admin = { id: row.id, cookie: await loginAs(test.app, email) };
  });
  afterAll(async () => {
    await deactivateUser(test.deps.db, admin.id);
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    test.app.inject({
      method,
      url,
      headers: { cookie: admin.cookie },
      ...(payload ? { payload } : {}),
    });
  const newGroup = () => createGroup(db(), { name: 'Mesto Senica', egrantUrl: newUrl() });
  const create = async (groupId: string, draft: object) => {
    const res = await call('POST', `/api/groups/${groupId}/knowledge`, draft);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<KnowledgeItemDto>();
  };
  const folder = async (groupId: string, name: string) => {
    const res = await call('POST', `/api/groups/${groupId}/knowledge/folders`, {
      name,
      visibility: 'public',
      parentId: null,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<KnowledgeFolderDto>();
  };

  it('creating records knowledge_item.created with title, type and visibility; the body only as changed', async () => {
    const g = await newGroup();
    const item = await create(g.id, {
      type: 'note',
      title: 'Zápisnica',
      body: 'Tajný text poznámky 4r',
    });
    const rows = await auditRowsOf(db(), item.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: 'knowledge_item',
      action: 'created',
      entityLabel: 'Zápisnica',
      groupId: g.id,
      actorUserId: admin.id,
      changes: {
        title: { to: 'Zápisnica' },
        type: { to: 'note' },
        visibility: { to: 'public' },
        body: { changed: true },
      },
    });
    expect(JSON.stringify(rows)).not.toContain('Tajný text');
  });

  it('switching visibility, moving to a folder and editing the body record one row with the diff', async () => {
    const g = await newGroup();
    const f = await folder(g.id, 'Zmluvy');
    const item = await create(g.id, { type: 'note', title: 'Poznámka', body: 'a' });
    const res = await call('PATCH', `/api/knowledge/${item.id}`, {
      visibility: 'admins',
      folderId: f.id,
      body: 'Nový tajný text 8w',
      updatedAt: item.updatedAt,
    });
    expect(res.statusCode, res.body).toBe(200);
    const rows = await auditRowsOf(db(), item.id);
    expect(rows.map((r) => r.action)).toEqual(['created', 'updated']);
    expect(rows[1]!.changes).toEqual({
      visibility: { from: 'public', to: 'admins' },
      folder: { from: null, to: { id: f.id, label: 'Zmluvy' } },
      body: { changed: true },
    });
    expect(JSON.stringify(rows)).not.toContain('Nový tajný text');
  });

  it('deleting records the title', async () => {
    const g = await newGroup();
    const item = await create(g.id, { type: 'note', title: 'Na zmazanie', body: 'obsah' });
    expect((await call('DELETE', `/api/knowledge/${item.id}`)).statusCode).toBe(204);
    const rows = await auditRowsOf(db(), item.id);
    expect(rows.map((r) => r.action)).toEqual(['created', 'deleted']);
    expect(rows[1]!.changes).toMatchObject({ title: { from: 'Na zmazanie' } });
    expect(rows[1]!.changes).not.toHaveProperty('body');
  });

  it('folder create, rename, delete record one row each', async () => {
    const g = await newGroup();
    const f = await folder(g.id, 'Projekty');
    await call('PATCH', `/api/knowledge/folders/${f.id}`, { name: 'Projekty 2026' });
    await call('PATCH', `/api/knowledge/folders/${f.id}`, { name: 'Projekty 2026' }); // unchanged
    await call('DELETE', `/api/knowledge/folders/${f.id}`);
    const rows = await auditRowsOf(db(), f.id);
    expect(rows.map((r) => [r.entityType, r.action, r.entityLabel])).toEqual([
      ['knowledge_folder', 'created', 'Projekty'],
      ['knowledge_folder', 'updated', 'Projekty 2026'],
      ['knowledge_folder', 'deleted', 'Projekty 2026'],
    ]);
    expect(rows[1]!.changes).toEqual({ name: { from: 'Projekty', to: 'Projekty 2026' } });
  });

  it('a Teams transcript import is a system row with the transcript only as changed', async () => {
    const g = await newGroup();
    const item = await create(g.id, {
      type: 'meeting',
      title: 'Porada',
      meeting: { startsAt: new Date(Date.now() - 3_600_000).toISOString(), meetingUrl: null },
    });
    expect(await attachTeamsTranscript(db(), item.id, 'Tajný prepis 2p', { replace: false })).toBe(
      'imported',
    );
    const rows = await auditRowsOf(db(), item.id);
    expect(rows[1]).toMatchObject({
      action: 'updated',
      actorKind: 'system',
      actorLabel: 'teams.transcript',
      changes: { transcript: { changed: true } },
    });
    expect(JSON.stringify(rows)).not.toContain('Tajný prepis');
  });
});
