import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { KNOWLEDGE_LIMITS } from '@spolu/shared';
import { PeopleSelect } from '@/components/people-select';
import { Label } from '@/components/ui/label';
import { useGroupPeople } from '@/features/groups/use-group-people';

/**
 * The recipients of a reminder: a `PeopleSelect` of the group people (admins only for an
 * admins-only item) with the author as a fixed chip, always first. `value` may leave the author
 * out; it is shown and kept anyway. Needs the `forms` and `reminders` locale namespaces.
 */
export function RecipientsField({
  groupId,
  value,
  onChange,
  authorId,
  adminsOnly,
  error,
}: {
  groupId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  authorId: string;
  adminsOnly: boolean;
  error?: string;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const all = useGroupPeople(groupId).data;
  const people = useMemo(
    () => (adminsOnly ? all?.filter((p) => p.isAdmin) : all),
    [all, adminsOnly],
  );
  const shown = useMemo(
    () => [authorId, ...value.filter((id) => id !== authorId)],
    [authorId, value],
  );
  const fixedIds = useMemo(() => [authorId], [authorId]);
  const label = t('reminders.fields.recipients');

  return (
    <div className="flex flex-col gap-2.5">
      <Label htmlFor={`${uid}-input`}>{label}</Label>
      <PeopleSelect
        people={people}
        value={shown}
        onChange={onChange}
        fixedIds={fixedIds}
        inputId={`${uid}-input`}
        max={KNOWLEDGE_LIMITS.recipients}
        label={label}
        invalid={!!error}
        describedBy={error ? `${uid}-error` : undefined}
      />
      {error && (
        <p id={`${uid}-error`} className="text-tiny text-error-ink">
          {error}
        </p>
      )}
    </div>
  );
}
