import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { ProjectPickerItem } from '@spolu/shared';
import { i18n } from '@/i18n';
import {
  ALL_PROJECTS,
  filterFromSearch,
  filterSections,
  searchOfFilter,
  showTestFromSearch,
  toggleProject,
  type TimelineFilter,
} from './timeline-filter';
import { TimelineProjectFilter } from './timeline-project-filter';

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);
const k = (key: string, opts?: Record<string, unknown>) =>
  t(`projects.timeline.filter.${key}`, opts);

const item = (id: string, name: string, status: 'active' | 'archived' = 'active', isTest = false) =>
  ({ id, name, color: 'blue', status, isTest }) satisfies ProjectPickerItem;
const ACTIVE = [item('a', 'Alfa'), item('b', 'Beta'), item('c', 'Gama')];
const ARCHIVED = [item('z', 'Staré', 'archived')];
const TEST = [item('t', 'Skúška', 'active', true)];
const activeIds = ACTIVE.map((p) => p.id);
const archivedIds = ARCHIVED.map((p) => p.id);

describe('the timeline filter model', () => {
  it('reads and writes the URL, project winning over exclude', () => {
    expect(filterFromSearch({})).toEqual(ALL_PROJECTS);
    expect(filterFromSearch({ project: 'a,b' })).toEqual({ kind: 'only', ids: ['a', 'b'] });
    expect(filterFromSearch({ exclude: 'c' })).toEqual({ kind: 'except', ids: ['c'] });
    expect(filterFromSearch({ project: 'a', exclude: 'c' })).toEqual({ kind: 'only', ids: ['a'] });
    expect(searchOfFilter({ kind: 'except', ids: ['b', 'c'] })).toEqual({
      project: undefined,
      exclude: 'b,c',
    });
    expect(searchOfFilter(ALL_PROJECTS)).toEqual({ project: undefined, exclude: undefined });
  });

  it('unticking from all excludes; ticking back returns to all', () => {
    const except = toggleProject(ALL_PROJECTS, 'b', activeIds, archivedIds);
    expect(except).toEqual({ kind: 'except', ids: ['b'] });
    expect(toggleProject(except, 'b', activeIds, archivedIds)).toEqual(ALL_PROJECTS);
  });

  it('a chosen list stays a list; an archived project turns all into a list', () => {
    const only = toggleProject({ kind: 'only', ids: ['a'] }, 'b', activeIds, archivedIds);
    expect(only).toEqual({ kind: 'only', ids: ['a', 'b'] });
    expect(toggleProject(only, 'c', activeIds, archivedIds)).toEqual(ALL_PROJECTS);
    expect(toggleProject(ALL_PROJECTS, 'z', activeIds, archivedIds)).toEqual({
      kind: 'only',
      ids: ['a', 'b', 'c', 'z'],
    });
  });

  it('test projects are a section of their own unless shown (ADR 0073)', () => {
    const all = [...ACTIVE, ...TEST, ...ARCHIVED, item('y', 'Stará skúška', 'archived', true)];
    expect(showTestFromSearch({})).toBe(false);
    expect(showTestFromSearch({ test: '1' })).toBe(true);
    const hidden = filterSections(all, false);
    expect(hidden.active.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(hidden.test.map((p) => p.id)).toEqual(['t']);
    expect(hidden.archived.map((p) => p.id)).toEqual(['z', 'y']);
    expect(hidden.hasTest).toBe(true);
    const shown = filterSections(all, true);
    expect(shown.active.map((p) => p.id)).toEqual(['a', 'b', 'c', 't']);
    expect(shown.test).toEqual([]);
    expect(shown.hasTest).toBe(true);
    expect(filterSections(ACTIVE, false).hasTest).toBe(false);
    // while hidden, ticking a test project turns all into a list, as an archived one does
    expect(toggleProject(ALL_PROJECTS, 't', activeIds, ['t', ...archivedIds])).toEqual({
      kind: 'only',
      ids: ['a', 'b', 'c', 't'],
    });
  });

  it('never leaves no project shown', () => {
    const one: TimelineFilter = { kind: 'only', ids: ['a'] };
    expect(toggleProject(one, 'a', activeIds, archivedIds)).toBe(one);
  });
});

function Harness({
  initial = ALL_PROJECTS,
  projects = [...ACTIVE, ...ARCHIVED],
}: {
  initial?: TimelineFilter;
  projects?: ProjectPickerItem[];
}) {
  const [value, setValue] = useState<TimelineFilter>(initial);
  const [showTest, setShowTest] = useState(false);
  return (
    <>
      <TimelineProjectFilter
        projects={projects}
        value={value}
        onChange={setValue}
        showTest={showTest}
        onShowTestChange={setShowTest}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
      <output data-testid="test">{String(showTest)}</output>
    </>
  );
}

const pillOf = (text: string) => `${k('label')}: ${text}`;
const value = () => JSON.parse(screen.getByTestId('value').textContent ?? '') as TimelineFilter;

describe('TimelineProjectFilter', () => {
  it('picks all but one, several, or only one project', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(
      screen.getByRole('button', {
        name: pillOf(t('projects.timeline.allProjects')),
        hidden: true,
      }),
    );
    const panel = screen.getByRole('dialog');
    await user.click(within(panel).getByRole('checkbox', { name: 'Beta' }));
    expect(value()).toEqual({ kind: 'except', ids: ['b'] });
    expect(
      screen.getByRole('button', {
        name: pillOf(k('allExceptOne', { name: 'Beta' })),
        hidden: true,
      }),
    ).toBeInTheDocument();

    await user.click(
      within(panel).getByRole('button', { name: k('onlyThisNamed', { name: 'Gama' }) }),
    );
    expect(value()).toEqual({ kind: 'only', ids: ['c'] });
    // the last shown project cannot be unticked
    expect(within(panel).getByRole('checkbox', { name: 'Gama' })).toBeDisabled();
    await user.click(within(panel).getByRole('checkbox', { name: 'Staré' }));
    expect(value()).toEqual({ kind: 'only', ids: ['c', 'z'] });
    expect(
      screen.getByRole('button', { name: pillOf(k('selected', { count: 2 })), hidden: true }),
    ).toBeInTheDocument();

    await user.click(
      within(panel).getByRole('checkbox', { name: t('projects.timeline.allProjects') }),
    );
    expect(value()).toEqual(ALL_PROJECTS);
  });

  it('lists test projects apart with a "show" checkbox, only when the client has some', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    const allPill = pillOf(t('projects.timeline.allProjects'));
    await user.click(screen.getByRole('button', { name: allPill, hidden: true }));
    expect(screen.queryByRole('checkbox', { name: k('showTest') })).not.toBeInTheDocument();
    unmount();

    render(<Harness projects={[...ACTIVE, ...TEST, ...ARCHIVED]} />);
    await user.click(screen.getByRole('button', { name: allPill, hidden: true }));
    const panel = screen.getByRole('dialog');
    const section = within(panel).getByRole('group', { name: k('testSection') });
    expect(within(section).getByRole('checkbox', { name: /Skúška/ })).not.toBeChecked();
    expect(within(section).getByText(t('projects.testBadge'))).toBeInTheDocument();
    await user.click(within(panel).getByRole('checkbox', { name: k('showTest') }));
    expect(screen.getByTestId('test').textContent).toBe('true');
    // shown: an ordinary active project, ticked under "All projects"
    expect(within(panel).queryByRole('group', { name: k('testSection') })).toBeNull();
    expect(within(panel).getByRole('checkbox', { name: /Skúška/ })).toBeChecked();
  });
});
