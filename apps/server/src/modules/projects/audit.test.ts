import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectDto, ProjectEventDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { createGroup } from '../groups/service.js';
import { addAdmin, deactivateUser } from '../users/service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;

describe('projects and events: audit rows', () => {
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
  const newProject = async (groupId: string, name: string) => {
    const res = await call('POST', `/api/groups/${groupId}/projects`, {
      name,
      description: 'Popis',
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<ProjectDto>();
  };

  it('create, rename, status change and delete record one row each', async () => {
    const g = await createGroup(db(), { name: 'Firma', egrantUrl: newUrl() });
    const p = await newProject(g.id, 'Kultúra 2026');
    const renamed = await call('PATCH', `/api/projects/${p.id}`, {
      name: 'Kultúra 2027',
      updatedAt: p.updatedAt,
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    await call('POST', `/api/projects/${p.id}/archive`);
    await call('POST', `/api/projects/${p.id}/archive`); // already archived
    expect((await call('DELETE', `/api/projects/${p.id}`)).statusCode).toBe(204);
    const rows = await auditRowsOf(db(), p.id);
    expect(rows.map((r) => [r.action, r.entityLabel])).toEqual([
      ['created', 'Kultúra 2026'],
      ['updated', 'Kultúra 2027'],
      ['status_changed', 'Kultúra 2027'],
      ['deleted', 'Kultúra 2027'],
    ]);
    expect(rows[1]!.changes).toEqual({ name: { from: 'Kultúra 2026', to: 'Kultúra 2027' } });
    expect(rows[2]!.changes).toEqual({ status: { from: 'active', to: 'archived' } });
    expect(rows.every((r) => r.actorUserId === admin.id && r.groupId === g.id)).toBe(true);
  });

  it('merging records merged and the absorbed project deletion with cause_id', async () => {
    const g = await createGroup(db(), { name: 'Firma', egrantUrl: newUrl() });
    const kept = await newProject(g.id, 'Hlavný');
    const absorbed = await newProject(g.id, 'Vedľajší');
    const res = await call('POST', `/api/projects/${absorbed.id}/merge`, { into: kept.id });
    expect(res.statusCode, res.body).toBe(200);
    const [, merged] = await auditRowsOf(db(), kept.id);
    expect(merged).toMatchObject({
      action: 'merged',
      changes: { merged: { from: { id: absorbed.id, label: 'Vedľajší' }, to: null } },
    });
    const gone = (await auditRowsOf(db(), absorbed.id)).at(-1)!;
    expect(gone).toMatchObject({ action: 'deleted', causeId: merged!.id });
  });

  it('event create, date change and delete record one row each', async () => {
    const g = await createGroup(db(), { name: 'Firma', egrantUrl: newUrl() });
    const p = await newProject(g.id, 'Projekt');
    const created = await call('POST', `/api/projects/${p.id}/events`, {
      name: 'Uzávierka',
      occursOn: '2026-12-20',
      description: 'Tajný popis udalosti 6t',
    });
    expect(created.statusCode, created.body).toBe(201);
    const e = created.json<ProjectEventDto>();
    const moved = await call('PATCH', `/api/project-events/${e.id}`, {
      occursOn: '2026-12-22',
      updatedAt: e.updatedAt,
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect((await call('DELETE', `/api/project-events/${e.id}`)).statusCode).toBe(204);
    const rows = await auditRowsOf(db(), e.id);
    expect(rows.map((r) => r.action)).toEqual(['created', 'updated', 'deleted']);
    expect(rows[1]!.changes).toEqual({ date: { from: '2026-12-20', to: '2026-12-22' } });
    expect(JSON.stringify(rows)).not.toContain('Tajný popis');
  });
});
