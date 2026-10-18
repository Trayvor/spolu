import { useQuery } from '@tanstack/react-query';
import type { ProjectRefDto } from '@spolu/shared';
import { Select } from '@/components/ui/select';
import { projectPickerQuery } from './api';

/**
 * The Project select of the task and ticket forms (Phase 33 part P2, spec §6): "No project",
 * then the client's active projects by name. The list (the picker route, one small indexed read,
 * cached per client) loads when the select mounts: a native select opened before its options
 * arrive would not show them. Until it has loaded the select offers the current project
 * (`current`). An archived project shows only while it is the value.
 * Texts come from the caller's namespace (`labels`).
 */
export function ProjectSelect({
  id,
  groupId,
  value,
  current,
  onChange,
  labels,
  disabled,
  describedBy,
  className,
}: {
  id?: string;
  groupId: string;
  value: string | null;
  /** The value's name, when the caller knows it (the task's or ticket's DTO). */
  current?: Pick<ProjectRefDto, 'id' | 'name'> | null;
  onChange: (projectId: string | null) => void;
  labels: { label: string; none: string; archived: (name: string) => string };
  disabled?: boolean;
  describedBy?: string;
  className?: string;
}) {
  const picker = useQuery(projectPickerQuery(groupId));
  const items = picker.data ?? [];
  const shown = items.filter((p) => p.status === 'active' || p.id === value);
  const known = shown.some((p) => p.id === value);
  const fallback = value !== null && !known ? (current?.id === value ? current : null) : null;

  return (
    <Select
      id={id}
      aria-label={id ? undefined : labels.label}
      aria-describedby={describedBy}
      aria-busy={picker.isFetching || undefined}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      containerClassName={className ?? 'w-full'}
    >
      <option value="">{labels.none}</option>
      {fallback && <option value={fallback.id}>{fallback.name}</option>}
      {value !== null && !known && !fallback && <option value={value}>…</option>}
      {shown.map((p) => (
        <option key={p.id} value={p.id}>
          {p.status === 'archived' ? labels.archived(p.name) : p.name}
        </option>
      ))}
    </Select>
  );
}
