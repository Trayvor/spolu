import { useId, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  TEAMS_LIMITS,
  type KnowledgeItemDto,
  type TeamsLink,
  type TeamsMeetingState,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PanelNotice } from '@/components/ui/panel-notice';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import {
  checkTeamsMeeting,
  connectTeamsMeeting,
  createTeamsMeeting,
  stopTeamsSeries,
  disconnectTeamsMeeting,
  inviteeOptionsQuery,
  teamsStateQuery,
} from './api';

// Teams T1: the Teams block of a knowledge meeting, admins only. Rendered lazily; while Teams
// is not configured the state answers 404 and the block renders nothing.

const SECTION = 'flex flex-col gap-3 border-t-2 border-border pt-4';
const DURATIONS = [30, 45, 60, 90, 120];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KNOWN_ERRORS = new Set([
  'teams_not_organizer',
  'teams_invalid_link',
  'teams_outside_tenant',
  'teams_unknown_organizer',
  'teams_meeting_not_found',
  'teams_linked',
  'teams_meeting_linked',
  'teams_unavailable',
  'rate_limited',
]);

const locale = (language: string) => (/^en\b/.test(language) ? 'en-GB' : language);

function errorKey(error: unknown): string {
  const code = error instanceof ApiError ? error.code : undefined;
  return code && KNOWN_ERRORS.has(code) ? `teams.errors.${code}` : 'teams.errors.generic';
}

type Mode = 'idle' | 'create' | 'connect';

export function TeamsSection({
  item,
  onChanged,
}: {
  item: KnowledgeItemDto;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const queryClient = useQueryClient();
  const state = useQuery(teamsStateQuery(item.id));
  const [mode, setMode] = useState<Mode>('idle');
  const [problem, setProblem] = useState<string | null>(null);

  // 404 (Teams off), not loaded yet or failed: nothing. The block is optional; the meeting
  // works without it.
  if (state.data === null || state.isPending || state.isError) return null;

  function done(next: TeamsMeetingState) {
    queryClient.setQueryData(teamsStateQuery(item.id).queryKey, next);
    // A disconnect answers without the series part: read it again.
    if (next.series === undefined && state.data?.series) {
      void queryClient.invalidateQueries({ queryKey: teamsStateQuery(item.id).queryKey });
    }
    setMode('idle');
    setProblem(null);
    onChanged();
  }

  async function stopSeries() {
    try {
      await stopTeamsSeries(item.id);
      await queryClient.invalidateQueries({ queryKey: teamsStateQuery(item.id).queryKey });
    } catch (error) {
      setProblem(t(errorKey(error)));
    }
  }

  return (
    <section aria-labelledby={`${uid}-title`} className={SECTION} data-testid="teams-section">
      <h3 id={`${uid}-title`} className="text-body font-semibold">
        {t('teams.block.title')}
      </h3>
      {problem && (
        <p role="alert" className="text-button font-semibold text-error-ink">
          {problem}
        </p>
      )}
      {state.data?.link ? (
        <ConnectedTeams
          itemId={item.id}
          link={state.data.link}
          onDone={done}
          onProblem={(error) => setProblem(t(errorKey(error)))}
        />
      ) : state.data && mode === 'idle' ? (
        <>
          <p className="text-button text-muted-foreground">{t('teams.block.notConnected')}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setMode('create')}>
              {t('teams.block.create')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setMode('connect')}>
              {t('teams.block.connect')}
            </Button>
          </div>
        </>
      ) : mode === 'create' ? (
        <CreateForm
          item={item}
          inSeries={!!state.data?.series}
          onCancel={() => setMode('idle')}
          onDone={done}
          onProblem={(error) => setProblem(t(errorKey(error)))}
        />
      ) : mode === 'connect' ? (
        <ConnectForm
          item={item}
          onCancel={() => setMode('idle')}
          onDone={done}
          onProblem={(error) => setProblem(t(errorKey(error)))}
        />
      ) : null}
      {state.data?.series?.planned && (
        <SeriesPlan
          organizerName={state.data.series.organizerName}
          lastError={state.data.series.lastError}
          onStop={() => void stopSeries()}
        />
      )}
    </section>
  );
}

/**
 * ADR 0049: Help gives each following call of the series its own Teams meeting; the admin can
 * stop that (the meetings made stay).
 */
function SeriesPlan({
  organizerName,
  lastError,
  onStop,
}: {
  organizerName: string | null;
  lastError: string | null;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="teams-series">
      <p className="text-button">
        {organizerName
          ? t('teams.series.planned', { name: organizerName })
          : t('teams.series.plannedNoName')}
      </p>
      {lastError && (
        <p className="text-tiny font-semibold text-error-ink">
          {lastError === 'teams_not_organizer'
            ? t('teams.errors.teams_not_organizer')
            : t('teams.block.error', { code: lastError })}
        </p>
      )}
      {confirm ? (
        <PanelNotice text={t('teams.series.stopConfirm')}>
          <Button variant="outline" onClick={() => setConfirm(false)}>
            {t('teams.block.cancel')}
          </Button>
          <Button variant="destructive" onClick={onStop}>
            {t('teams.series.stop')}
          </Button>
        </PanelNotice>
      ) : (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>
            {t('teams.series.stop')}
          </Button>
        </div>
      )}
    </div>
  );
}

type FormProps = {
  item: KnowledgeItemDto;
  /** The call is one of a recurring series (ADR 0049): offer "also for the following calls". */
  inSeries?: boolean;
  onCancel: () => void;
  onDone: (state: TeamsMeetingState) => void;
  onProblem: (error: unknown) => void;
};

/** "Create Teams meeting": length, automatic recording (on), and the invitees picked. */
function CreateForm({ item, inSeries = false, onCancel, onDone, onProblem }: FormProps) {
  const { t } = useTranslation();
  const uid = useId();
  const people = useQuery(inviteeOptionsQuery(item.id));
  const [duration, setDuration] = useState<number>(TEAMS_LIMITS.defaultMinutes);
  const [record, setRecord] = useState(true);
  const [following, setFollowing] = useState(true);
  // Nobody is preselected (owner answer 4).
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [draftInvalid, setDraftInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  function addEmail() {
    const email = draft.trim().toLowerCase();
    if (email === '') return;
    if (!EMAIL.test(email)) {
      setDraftInvalid(true);
      return;
    }
    if (!extra.includes(email)) setExtra([...extra, email]);
    setDraft('');
    setDraftInvalid(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const chosen = (people.data ?? []).filter((p) => picked.has(p.id));
    const attendees = [
      ...chosen.map((p) => ({ email: p.email, name: p.name })),
      ...extra.map((email) => ({ email })),
    ];
    try {
      onDone(
        await createTeamsMeeting(item.id, {
          durationMinutes: duration,
          attendees,
          recordAutomatically: record,
          ...(inSeries ? { following } : {}),
        }),
      );
    } catch (error) {
      onProblem(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      <p className="text-tiny text-muted-foreground">{t('teams.create.titleTimeHint')}</p>
      <label className="flex flex-col gap-1.5 text-button font-semibold">
        {t('teams.create.duration')}
        <Select
          value={String(duration)}
          onChange={(event) => setDuration(Number(event.target.value))}
          containerClassName="self-start"
        >
          {DURATIONS.map((m) => (
            <option key={m} value={m}>
              {t('teams.create.minutes', { minutes: m })}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex items-start gap-2 text-button">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-foreground"
          checked={record}
          onChange={(event) => setRecord(event.target.checked)}
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">{t('teams.create.record')}</span>
          <span className="text-tiny text-muted-foreground">{t('teams.create.recordHint')}</span>
        </span>
      </label>

      {inSeries && (
        <label className="flex items-start gap-2 text-button">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-foreground"
            checked={following}
            onChange={(event) => setFollowing(event.target.checked)}
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold">{t('teams.create.following')}</span>
            <span className="text-tiny text-muted-foreground">
              {t('teams.create.followingHint')}
            </span>
          </span>
        </label>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-button font-semibold">{t('teams.create.invitees')}</legend>
        <p className="text-tiny text-muted-foreground">{t('teams.create.inviteesHint')}</p>
        {people.data?.length === 0 && (
          <p className="text-tiny text-muted-foreground">{t('teams.create.nobody')}</p>
        )}
        <ul className="flex flex-col gap-1">
          {(people.data ?? []).map((person) => (
            <li key={person.id}>
              <label className="flex min-h-8 items-center gap-2 text-button touch:min-h-11">
                <input
                  type="checkbox"
                  className="size-4 accent-foreground"
                  checked={picked.has(person.id)}
                  onChange={(event) => {
                    const next = new Set(picked);
                    if (event.target.checked) next.add(person.id);
                    else next.delete(person.id);
                    setPicked(next);
                  }}
                />
                <span className="font-semibold">{person.name}</span>
                <span className="truncate text-muted-foreground">{person.email}</span>
                {person.isAdmin && (
                  <span className="text-micro text-muted-foreground">
                    {t('teams.create.manager')}
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
        {extra.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {extra.map((email) => (
              <li
                key={email}
                className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-3 text-tiny font-semibold"
              >
                {email}
                <button
                  type="button"
                  className="rounded-full px-2 text-muted-foreground hover:text-foreground"
                  aria-label={t('teams.create.remove', { email })}
                  onClick={() => setExtra(extra.filter((e) => e !== email))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-start gap-2">
          <label htmlFor={`${uid}-email`} className="sr-only">
            {t('teams.create.addEmail')}
          </label>
          <Input
            id={`${uid}-email`}
            type="email"
            className="max-w-xs"
            placeholder={t('teams.create.addEmail')}
            value={draft}
            aria-invalid={draftInvalid || undefined}
            onChange={(event) => {
              setDraft(event.target.value);
              setDraftInvalid(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addEmail();
              }
            }}
          />
          <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={addEmail}>
            {t('teams.create.add')}
          </Button>
        </div>
        {draftInvalid && (
          <p role="alert" className="text-tiny font-semibold text-error-ink">
            {t('teams.create.invalidEmail')}
          </p>
        )}
      </fieldset>

      <div className="rounded-lg bg-secondary p-3 text-button">
        <span className="text-muted-foreground">{t('teams.create.noticeLabel')} </span>
        <span className="font-semibold">
          {t(record ? 'teams.public.recorded' : 'teams.public.mayRecord')}
        </span>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? t('teams.create.creating') : t('teams.create.submit')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('teams.block.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** "Connect Teams link": the pasted join link, resolved by the server. */
function ConnectForm({ item, onCancel, onDone, onProblem }: FormProps) {
  const { t } = useTranslation();
  const uid = useId();
  const [url, setUrl] = useState(item.meetingDetail?.meetingUrl ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (url.trim() === '') return;
    setBusy(true);
    try {
      onDone(await connectTeamsMeeting(item.id, url.trim()));
    } catch (error) {
      onProblem(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
      <label htmlFor={`${uid}-url`} className="text-button font-semibold">
        {t('teams.connectForm.url')}
      </label>
      <Input
        id={`${uid}-url`}
        type="url"
        value={url}
        maxLength={TEAMS_LIMITS.link}
        onChange={(event) => setUrl(event.target.value)}
        aria-describedby={`${uid}-hint`}
      />
      <p id={`${uid}-hint`} className="text-tiny text-muted-foreground">
        {t('teams.connectForm.hint')}
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || url.trim() === ''}>
          {busy ? t('teams.connectForm.connecting') : t('teams.connectForm.submit')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('teams.block.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** A connected meeting: who organises it, where the transcript stands, and the actions. */
function ConnectedTeams({
  itemId,
  link,
  onDone,
  onProblem,
}: {
  itemId: string;
  link: TeamsLink;
  onDone: (state: TeamsMeetingState) => void;
  onProblem: (error: unknown) => void;
}) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [copied, setCopied] = useState(false);
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale(i18n.language), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));

  async function run(action: () => Promise<TeamsMeetingState | undefined>) {
    setBusy(true);
    try {
      onDone((await action()) ?? { link: null });
    } catch (error) {
      onProblem(error);
    } finally {
      setBusy(false);
    }
  }

  async function copyInvitation() {
    if (!link.invitationUrl) return;
    try {
      await navigator.clipboard.writeText(link.invitationUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const errorHint =
    link.lastError === 'GraphAccessToTranscriptsDisabled'
      ? t('teams.block.errorHint_GraphAccessToTranscriptsDisabled')
      : null;

  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col gap-1 text-button">
        <div className="flex flex-wrap gap-x-2">
          <dt className="sr-only">{t('teams.block.originLabel')}</dt>
          <dd className="font-semibold">{t(`teams.block.origin_${link.origin}`)}</dd>
          {link.organizerName && (
            <dd className="text-muted-foreground">
              {t('teams.block.organizer', { name: link.organizerName })}
            </dd>
          )}
        </div>
        <dt className="sr-only">{t('teams.block.recordingLabel')}</dt>
        <dd className="text-muted-foreground">
          {t(link.recordAutomatically ? 'teams.block.recording_on' : 'teams.block.recording_off')}
        </dd>
        <dt className="sr-only">{t('teams.block.transcriptLabel')}</dt>
        <dd>{t(`teams.block.state_${link.transcriptState}`)}</dd>
        {(link.lastCheckedAt || link.nextCheckAt) && (
          <dd className="text-tiny text-muted-foreground">
            {[
              link.lastCheckedAt &&
                t('teams.block.lastChecked', { when: when(link.lastCheckedAt) }),
              link.nextCheckAt && t('teams.block.nextCheck', { when: when(link.nextCheckAt) }),
            ]
              .filter(Boolean)
              .join('. ')}
          </dd>
        )}
      </dl>
      {link.lastError && (
        <p className="text-tiny font-semibold text-error-ink">
          {t('teams.block.error', { code: link.lastError })}
          {errorHint && <> {errorHint}</>}
        </p>
      )}
      {confirmDisconnect ? (
        <PanelNotice text={t('teams.block.disconnectConfirm')}>
          <Button variant="outline" onClick={() => setConfirmDisconnect(false)}>
            {t('teams.block.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => void run(async () => (await disconnectTeamsMeeting(itemId), undefined))}
          >
            {t('teams.block.disconnect')}
          </Button>
        </PanelNotice>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => checkTeamsMeeting(itemId, false))}
          >
            {t('teams.block.check')}
          </Button>
          {link.transcriptState === 'available' && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => checkTeamsMeeting(itemId, true))}
            >
              {t('teams.block.replace')}
            </Button>
          )}
          {link.invitationUrl && (
            <Button variant="secondary" size="sm" onClick={() => void copyInvitation()}>
              {copied ? t('teams.block.invitationCopied') : t('teams.block.copyInvitation')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(true)}>
            {t('teams.block.disconnect')}
          </Button>
        </div>
      )}
    </div>
  );
}
