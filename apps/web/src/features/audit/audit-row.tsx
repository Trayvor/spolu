import { useId, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { AuditEntryDto } from '@spolu/shared';
import { AuditChanges, changeLines } from './audit-changes';
import { exactTime, timeOf } from './format';
import { recordLink } from './links';

/** At most three change lines show; the rest open in place (spec §4.2). */
const SHOWN = 3;

/** What clicking an author or "Len tento záznam" sets (with the chip's label). */
export type AuditPick =
  | { kind: 'actor'; actor: string; label: string }
  | { kind: 'record'; entityType: string; entityId: string; label: string };

/** The author as a filter value and a name (spec §4.3: a token filters by the token). */
export function actorFilterOf(entry: AuditEntryDto): { actor: string; label: string } {
  const a = entry.actor;
  switch (a.kind) {
    case 'user':
      return { actor: `user:${a.userId}`, label: a.name };
    case 'mcp':
      return { actor: `token:${a.tokenId}`, label: a.tokenName || a.name };
    case 'egrant':
      return { actor: 'kind:egrant', label: 'eGrant' };
    case 'system':
      return { actor: 'kind:system', label: a.job };
  }
}

/** The row's sentence: the action as a verbal noun with the record's label (spec §4.2). */
export function useSentence() {
  const { t } = useTranslation();
  return (type: string, action: string, label: string) =>
    t(`audit.actions.${type}.${action}`, { label, defaultValue: `${type} ${action}: ${label}` });
}

/**
 * One change: the time and the author on the left (the author is a button that filters by
 * them), the sentence with the record's label (a link while the record exists), the client, up
 * to three change lines and the consequence line. "Podrobnosti" opens the rest and "Len tento
 * záznam".
 */
export function AuditRow({
  entry,
  onPick,
}: {
  entry: AuditEntryDto;
  onPick: (pick: AuditPick) => void;
}) {
  const { t, i18n } = useTranslation();
  const sentence = useSentence();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const lang = i18n.language;
  const lines = changeLines(entry.changes);
  // A created row shows its initial values only when opened.
  const visible = entry.action === 'created' && !open ? [] : open ? lines : lines.slice(0, SHOWN);
  const hidden = entry.action === 'created' ? 0 : lines.length - visible.length;
  const batch = (entry.changes as { _batch?: { count: number } })._batch;
  const link = recordLink(entry);
  const author = actorFilterOf(entry);
  const deletedRecord = entry.action === 'deleted' && !entry.linkable;

  const text = sentence(entry.entityType, entry.action, '\u0000');
  const [before, after] = text.split('\u0000');
  const label = link ? (
    <Link
      to={link.to as never}
      params={link.params as never}
      search={link.search as never}
      className="font-semibold text-foreground underline-offset-4 hover:underline"
    >
      {entry.entityLabel}
    </Link>
  ) : (
    <span className="font-semibold">{entry.entityLabel}</span>
  );

  return (
    <li className="grid grid-cols-1 gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(9rem,13rem)_1fr] sm:px-5">
      <div className="flex min-w-0 items-baseline gap-3 sm:flex-col sm:gap-0.5">
        <time
          dateTime={entry.createdAt}
          title={exactTime(entry.createdAt, lang)}
          className="text-tiny text-muted-foreground tabular-nums"
        >
          {timeOf(entry.createdAt, lang)}
        </time>
        <AuthorLabel entry={entry} onPick={() => onPick({ kind: 'actor', ...author })} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-button break-words">
          {before}
          {label}
          {after}
          {deletedRecord && (
            <span className="text-muted-foreground"> {t('audit.row.deleted')}</span>
          )}
          {entry.group && <span className="text-muted-foreground"> · {entry.group.name}</span>}
        </p>
        {entry.cause && (
          <p className="text-tiny text-muted-foreground">
            {t('audit.row.consequence', {
              sentence: sentence(
                entry.cause.entityType,
                entry.cause.action,
                entry.cause.entityLabel,
              ),
            })}
          </p>
        )}
        {batch && (
          <p className="text-tiny text-muted-foreground">
            {t('audit.row.batch', { count: batch.count })}
          </p>
        )}
        {visible.length > 0 && <AuditChanges type={entry.entityType} lines={visible} />}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {hidden > 0 && !open && (
            <button
              type="button"
              className="text-tiny font-semibold text-foreground underline-offset-4 hover:underline"
              onClick={() => setOpen(true)}
            >
              {t('audit.row.more', { count: hidden })}
            </button>
          )}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailsId}
            className="text-tiny text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? t('audit.row.hideDetails') : t('audit.row.details')}
          </button>
        </div>
        <div id={detailsId} hidden={!open}>
          {open && (
            <button
              type="button"
              className="text-tiny font-semibold text-foreground underline-offset-4 hover:underline"
              onClick={() =>
                onPick({
                  kind: 'record',
                  entityType: entry.entityType,
                  entityId: entry.entityId,
                  label: entry.entityLabel,
                })
              }
            >
              {t('audit.row.onlyThis')}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** The author: a person, a person through AI with the token, eGrant with the instance, the system. */
function AuthorLabel({ entry, onPick }: { entry: AuditEntryDto; onPick: () => void }) {
  const { t } = useTranslation();
  const a = entry.actor;
  const name =
    a.kind === 'user'
      ? a.name
      : a.kind === 'mcp'
        ? t('audit.authors.viaAi', { name: a.name })
        : a.kind === 'egrant'
          ? t('audit.authors.egrant')
          : t('audit.authors.system');
  const detail =
    a.kind === 'mcp'
      ? t('audit.authors.token', { name: a.tokenName })
      : a.kind === 'egrant'
        ? a.instance
        : a.kind === 'system'
          ? t('audit.authors.job', { job: a.job })
          : null;
  const deactivated = (a.kind === 'user' || a.kind === 'mcp') && a.deactivated;
  return (
    <span className="flex min-w-0 flex-col">
      <button
        type="button"
        onClick={onPick}
        title={t('audit.row.filterAuthor', { name })}
        className="truncate text-left text-button font-semibold text-foreground underline-offset-4 hover:underline"
      >
        {name}
        {deactivated && (
          <span className="font-normal text-muted-foreground">
            {' '}
            {t('audit.authors.deactivated')}
          </span>
        )}
      </button>
      {detail && <span className="truncate text-tiny text-muted-foreground">{detail}</span>}
    </span>
  );
}
