import { describe, expect, it } from 'vitest';
import { createFakeProvider } from './fake-provider.js';
import type { SplitRequest } from './provider.js';

const request = (text: string): SplitRequest => ({
  text,
  quoted: null,
  files: [{ id: 'f1', name: 'report.pdf' }],
  people: [
    { id: 'u1', name: 'Ana', team: 'client' },
    { id: 'u2', name: 'Boris', team: 'egrant' },
  ],
  projects: [{ id: 'p1', name: 'Alfa' }],
  today: '2026-10-16',
  source: 'message',
  details: [],
  conversation: [],
});

const split = (text: string) =>
  createFakeProvider().split(request(text), new AbortController().signal);

describe('fake provider', () => {
  it('makes one task per list line with deadline, assignee, files and urgent', async () => {
    const result = await split(
      'Hi team\n- Write report.pdf by 2026-11-01 for Ana\n- Call bank urgent\nthanks',
    );
    expect(result).toEqual({
      tasks: [
        {
          title: 'Write report.pdf by 2026-11-01 for Ana',
          description: '',
          assigneeIds: ['u1'],
          fileIds: ['f1'],
          deadline: '2026-11-01',
          urgent: false,
          link: null,
          projectId: null,
        },
        {
          title: 'Call bank urgent',
          description: '',
          assigneeIds: [],
          fileIds: [],
          deadline: null,
          urgent: true,
          link: null,
          projectId: null,
        },
      ],
      usage: null,
    });
  });

  it('accepts *, •, N. and N) markers and Slovak urgency', async () => {
    const { tasks } = await split('* one\n• two\n1. three SÚRNE\n2) four @boris');
    expect(tasks.map((t) => t.title)).toEqual(['one', 'two', 'three SÚRNE', 'four @boris']);
    expect(tasks[2]!.urgent).toBe(true);
    expect(tasks[3]!.assigneeIds).toEqual(['u2']);
  });

  it("a project's name in the line makes it the task's project", async () => {
    const { tasks } = await split('- Write the alfa report\n- Call the bank');
    expect(tasks.map((t) => t.projectId)).toEqual(['p1', null]);
  });

  it('returns no tasks without list lines', async () => {
    expect((await split('Just a note, -nothing here\n2026 was fine')).tasks).toEqual([]);
  });
});
