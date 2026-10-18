import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { mergeProject, projectPickerQuery } from './api';

/**
 * "Merge into…" in the project sheet (Phase 33 part P3, decision 4): pick another project of the
 * client; the confirmation names what moves. Everything of this project (events, tasks, tickets,
 * files, names and eGrant ids) goes to the chosen one, and this one is deleted.
 */
export function MergePanel({
  groupId,
  project,
  onCancel,
  onMerged,
}: {
  groupId: string;
  project: ProjectDto;
  onCancel: () => void;
  onMerged: () => void;
}) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) => t(`projects.merge.${key}`, options);
  const id = useId();
  const others = (useQuery(projectPickerQuery(groupId)).data ?? []).filter(
    (p) => p.id !== project.id,
  );
  const [into, setInto] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const target = others.find((p) => p.id === into);

  const merge = async () => {
    setSaving(true);
    setFailed(false);
    try {
      await mergeProject(project.id, into);
      onMerged();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-3 rounded-lg bg-secondary p-3"
    >
      <p id={`${id}-title`} className="text-button font-semibold">
        {k('title', { name: project.name })}
      </p>
      {others.length === 0 ? (
        <p className="text-button text-muted-foreground">{k('none')}</p>
      ) : (
        <label className="flex flex-col gap-1 text-tiny font-semibold">
          {k('into')}
          <Select value={into} onChange={(e) => setInto(e.target.value)}>
            <option value="">{k('choose')}</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.status === 'archived' ? k('archivedOption', { name: p.name }) : p.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      {target && (
        <p className="text-button">
          {k('confirm', {
            from: project.name,
            into: target.name,
            events: project.eventCount,
            tasks: project.openTasks,
            tickets: project.openTickets,
          })}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-button text-error-ink">
          {k('failed')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="destructive" disabled={!target || saving} onClick={() => void merge()}>
          {k('submit')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {k('cancel')}
        </Button>
      </div>
    </div>
  );
}
