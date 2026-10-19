import { useId, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Admin, Substitution } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { ApiError } from '@/lib/api';
import { todayInBratislava } from '@/features/tasks/dates';
import { setSubstitution } from './api';

/** "24. 10." in the UI language: the end date of a substitution (`YYYY-MM-DD`, a whole day). */
export function formatEndsOn(endsOn: string, language: string): string {
  const [y, m, d] = endsOn.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'numeric' }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
}

/**
 * Who may be picked to substitute `admin`: every other admin on the list who is not substituted
 * themselves (no chains, ADR 0059). The server checks the same.
 */
export function substituteCandidates(admin: Admin, admins: Admin[]): Admin[] {
  return admins.filter((a) => a.id !== admin.id && !a.substitution);
}

/**
 * "Zastúpiť" (2026-10-19): a short dialog with the substitute and an optional last day. Saving
 * starts the substitution at once; `onDone(substitution)` closes it, `onDone(null)` cancels.
 */
export function SubstitutionDialog({
  admin,
  admins,
  onDone,
}: {
  admin: Admin;
  admins: Admin[];
  onDone: (substitution: Substitution | null) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const pickId = useId();
  const dateId = useId();
  const pickRef = useRef<HTMLSelectElement>(null);
  const candidates = substituteCandidates(admin, admins);
  const [substituteId, setSubstituteId] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const today = todayInBratislava();

  const save = useMutation({
    mutationFn: () => setSubstitution(admin.id, { substituteId, endsOn: endsOn || null }),
    onSuccess: (substitution) => onDone(substitution),
    onError: (e) => {
      const code = e instanceof ApiError ? e.code : null;
      setError(
        code === 'already_substituted'
          ? t('admins.substitution.errors.already')
          : code === 'substitute_away'
            ? t('admins.substitution.errors.away')
            : code === 'invalid_substitute'
              ? t('admins.substitution.errors.invalid')
              : code === 'validation_failed'
                ? t('admins.substitution.errors.pastDate')
                : t('errors.generic'),
      );
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    if (!substituteId) {
      setError(t('admins.substitution.errors.pick'));
      pickRef.current?.focus();
      return;
    }
    if (endsOn && endsOn < today) {
      setError(t('admins.substitution.errors.pastDate'));
      return;
    }
    setError(null);
    save.mutate();
  }

  return (
    <SheetDialog
      compact
      onEscape={() => onDone(null)}
      labelledBy={titleId}
      initialFocus={pickRef}
      testId="substitution-dialog"
    >
      <form className="flex min-h-0 flex-1 flex-col" noValidate onSubmit={onSubmit}>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5 min-[641px]:px-6">
          <div className="flex flex-col gap-1">
            <SheetDialogTitle asChild>
              <h2 id={titleId} className="text-medium leading-tight font-semibold break-words">
                {t('admins.substitution.title', { name: admin.name })}
              </h2>
            </SheetDialogTitle>
            <p className="text-button text-muted-foreground">
              {t('admins.substitution.intro', { name: admin.name })}
            </p>
          </div>

          {candidates.length === 0 ? (
            <p className="text-button">{t('admins.substitution.noCandidates')}</p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={pickId} className="text-micro font-semibold">
                  {t('admins.substitution.substitute')}
                </label>
                <Select
                  id={pickId}
                  ref={pickRef}
                  value={substituteId}
                  onChange={(e) => {
                    setSubstituteId(e.target.value);
                    setError(null);
                  }}
                  containerClassName="w-full"
                >
                  <option value="">{t('admins.substitution.pick')}</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={dateId} className="text-micro font-semibold">
                  {t('admins.substitution.endsOn')}
                </label>
                <Input
                  id={dateId}
                  type="date"
                  min={today}
                  value={endsOn}
                  onChange={(e) => {
                    setEndsOn(e.target.value);
                    setError(null);
                  }}
                  aria-describedby={`${dateId}-hint`}
                />
                <p id={`${dateId}-hint`} className="text-micro text-muted-foreground">
                  {t('admins.substitution.endsOnHint')}
                </p>
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="text-button text-error-ink">
              {error}
            </p>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border px-5 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] min-[641px]:flex-row min-[641px]:justify-end min-[641px]:px-6">
          <Button type="button" variant="ghost" onClick={() => onDone(null)}>
            {t('admins.substitution.cancel')}
          </Button>
          {candidates.length > 0 && (
            <Button type="submit" disabled={save.isPending}>
              {t('admins.substitution.save')}
            </Button>
          )}
        </div>
      </form>
    </SheetDialog>
  );
}
