import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorCodes } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { groupsQuery } from '@/features/groups/api';
import { ApiError } from '@/lib/api';
import { useAssignGroup } from './api';

/**
 * An admin chooses the ticket's client: a select of every client and "Assign" (a ticket without
 * a client) or "Move" (another client). A ticket with tasks cannot move: the server answers
 * `409 has_tasks` and the message says why. `onDone` closes the chooser after a change.
 */
export function AssignClient({
  ticketId,
  currentGroupId,
  onDone,
}: {
  ticketId: string;
  currentGroupId: string | null;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const groups = useQuery(groupsQuery).data;
  const [groupId, setGroupId] = useState('');
  const assign = useAssignGroup(ticketId);
  const hasTasks = assign.error instanceof ApiError && assign.error.code === ErrorCodes.hasTasks;
  const options = (groups ?? []).filter((g) => g.id !== currentGroupId);

  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (groupId) assign.mutate(groupId, { onSuccess: () => onDone?.() });
      }}
    >
      <label htmlFor={id} className="text-micro font-semibold text-muted-foreground">
        {t(currentGroupId ? 'tickets.assign.moveLabel' : 'tickets.assign.label')}
      </label>
      <div className="flex flex-wrap gap-2">
        <Select
          id={id}
          value={groupId}
          disabled={!groups}
          onChange={(e) => setGroupId(e.target.value)}
          containerClassName="min-w-0 flex-1 basis-48"
          className="py-2"
        >
          <option value="">{t('tickets.assign.choose')}</option>
          {options.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
        <Button type="submit" disabled={!groupId || assign.isPending}>
          {t(currentGroupId ? 'tickets.assign.move' : 'tickets.assign.assign')}
        </Button>
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            {t('tickets.page.cancel')}
          </Button>
        )}
      </div>
      {assign.isError && (
        <p role="alert" className="text-tiny text-error-ink">
          {t(hasTasks ? 'tickets.assign.hasTasks' : 'errors.generic')}
        </p>
      )}
    </form>
  );
}
