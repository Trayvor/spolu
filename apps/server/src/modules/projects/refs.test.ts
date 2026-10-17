import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createGroup } from '../groups/service.js';
import { addAdmin } from '../users/service.js';
import { InvalidProjectError } from './errors.js';
import { colorOf, getProjectRef, listPickerProjects, projectRefs } from './refs.js';
import { createEvent, createProject, setProjectStatus } from './service.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const newUrl = () => `https://r${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`;

async function setup() {
  const g = await createGroup(db, { name: 'Firma', egrantUrl: newUrl() });
  const other = await createGroup(db, { name: 'Iná', egrantUrl: newUrl() });
  const a = await addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'A' });
  const project = await createProject(db, a.id, g.id, {
    name: 'Kultúra',
    description: '',
    fileIds: [],
  });
  const second = await createProject(db, a.id, g.id, {
    name: 'Šport',
    description: '',
    fileIds: [],
  });
  const event = await createEvent(db, a.id, project.id, {
    name: 'Kickoff',
    occursOn: '2026-11-04',
    description: '',
    fileIds: [],
  });
  const theirs = await createProject(db, a.id, other.id, {
    name: 'X',
    description: '',
    fileIds: [],
  });
  return { g, project, second, event, theirs };
}

describe('getProjectRef', () => {
  it('accepts no project, a project of the client and an event of that project', async () => {
    const { g, project, event } = await setup();
    expect(await getProjectRef(db, g.id, null, null)).toBeNull();
    expect(await getProjectRef(db, g.id, project.id, null)).toEqual({
      projectId: project.id,
      eventId: null,
    });
    expect(await getProjectRef(db, g.id, project.id, event.id)).toEqual({
      projectId: project.id,
      eventId: event.id,
    });
  });

  it('refuses another client’s project, an event of another project and an event alone', async () => {
    const { g, second, event, theirs } = await setup();
    await expect(getProjectRef(db, g.id, theirs.id, null)).rejects.toBeInstanceOf(
      InvalidProjectError,
    );
    await expect(getProjectRef(db, g.id, second.id, event.id)).rejects.toBeInstanceOf(
      InvalidProjectError,
    );
    await expect(getProjectRef(db, g.id, null, event.id)).rejects.toBeInstanceOf(
      InvalidProjectError,
    );
    await expect(getProjectRef(db, g.id, randomUUID(), null)).rejects.toBeInstanceOf(
      InvalidProjectError,
    );
  });
});

describe('projectRefs', () => {
  it('names and colours of a page’s projects and events; unknown ids are null', async () => {
    const { project, event } = await setup();
    const refs = await projectRefs(db, [
      { projectId: project.id, eventId: event.id },
      { projectId: project.id, eventId: null },
      { projectId: null, eventId: null },
    ]);
    expect(refs.project(project.id)).toEqual({
      id: project.id,
      name: 'Kultúra',
      color: colorOf(project.id),
    });
    expect(refs.event(event.id)).toEqual({ id: event.id, name: 'Kickoff', occursOn: '2026-11-04' });
    expect(refs.project(null)).toBeNull();
    expect(refs.project(randomUUID())).toBeNull();
    expect((await projectRefs(db, [])).event(event.id)).toBeNull();
  });
});

describe('listPickerProjects', () => {
  it('lists active projects first, then archived, by name', async () => {
    const { g, project, second } = await setup();
    await setProjectStatus(db, project.id, 'archived');
    expect((await listPickerProjects(db, g.id)).map((p) => [p.name, p.status])).toEqual([
      ['Šport', 'active'],
      ['Kultúra', 'archived'],
    ]);
    expect(second.color).toBe(colorOf(second.id));
  });
});
