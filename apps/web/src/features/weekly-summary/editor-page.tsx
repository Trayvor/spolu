import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  WEEKLY_SUMMARY_LIMITS,
  WeeklySummarySections,
  type UserLanguage,
  type WeeklySummaryChanged,
  type WeeklySummaryContent,
  type WeeklySummaryDto,
  type WeeklySummaryRevision,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { InlineConfirm } from '@/components/ui/inline-confirm';
import { PanelNotice } from '@/components/ui/panel-notice';
import { Select } from '@/components/ui/select';
import { ListSkeleton } from '@/components/ui/skeleton';
import { SUPPORTED_LANGUAGES } from '@/i18n/languages';
import { ApiError } from '@/lib/api';
import {
  conflictOf,
  regenerateSummary,
  restoreRevision,
  saveSummary,
  sendSummary,
  skipSummary,
  summaryKeys,
  summaryQuery,
  testSummary,
} from './api';
import { dateTimeLabel, isoWeek, rangeLabel, weekNumber } from './format';
import { PreviewDialog } from './preview-dialog';
import { RevisionsDialog } from './revisions-dialog';
import { SectionEditor, TEXTAREA } from './section-editor';
import { SendDialog } from './send-dialog';
import { SettingsStrip } from './settings-strip';
import { StatusChip } from './status-chip';
import { useSummaryEvents } from './use-summary-events';

/** Autosave this long after the last change. */
export const AUTOSAVE_MS = 1000;

/** The route component: reads the id from the path. */
export function WeeklySummaryEditorRoute() {
  const { summaryId } = useParams({ strict: false }) as { summaryId: string };
  return <EditorPage summaryId={summaryId} />;
}

export function EditorPage({ summaryId }: { summaryId: string }) {
  const { t } = useTranslation();
  const query = useQuery({
    ...summaryQuery(summaryId),
    // A regeneration runs in a job: look again until the new draft is there.
    refetchInterval: (q) => (q.state.data?.status === 'preparing' ? 3000 : false),
  });
  if (query.isPending) return <ListSkeleton rows={4} rowClassName="min-h-[72px]" />;
  if (query.isError || !query.data) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <p role="alert" className="text-button text-error-ink">
        {t(missing ? 'weeklySummary.editor.notFound' : 'errors.generic')}
      </p>
    );
  }
  return <Editor key={summaryId} dto={query.data} />;
}

type Draft = { content: WeeklySummaryContent; language: UserLanguage };
type Notice = 'refsChanged' | 'testSent' | 'error' | null;
type Layer = 'preview' | 'revisions' | 'send' | 'regenerate' | null;

/** Empty items are left out of what is saved (the server needs text); the editor keeps them. */
function cleaned(content: WeeklySummaryContent): WeeklySummaryContent {
  const next = { ...content };
  for (const s of WeeklySummarySections) next[s] = content[s].filter((i) => i.text.trim() !== '');
  return next;
}

function Editor({ dto }: { dto: WeeklySummaryDto }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [base, setBase] = useState(dto);
  const [draft, setDraft] = useState<Draft>({ content: dto.content, language: dto.language });
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<WeeklySummaryDto | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [layer, setLayer] = useState<Layer>(null);
  const [busy, setBusy] = useState(false);
  // A save on its way: the buttons and the autosave wait for it, else a second save would send
  // the same, by then old, version and get a 409 for the manager's own change.
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const edits = useRef(0);
  const editable = base.canEdit;

  const adopt = useCallback(
    (next: WeeklySummaryDto, replaceDraft: boolean) => {
      queryClient.setQueryData(summaryKeys.detail(next.id), next);
      setBase(next);
      if (replaceDraft) {
        setDraft({ content: next.content, language: next.language });
        setDirty(false);
      }
    },
    [queryClient],
  );

  // A newer version from the server (another manager, a job): taken over unless there are
  // unsaved changes, which ask first. Decided while rendering, once per new answer.
  const [seen, setSeen] = useState(dto);
  if (seen !== dto) {
    setSeen(dto);
    if (dto.version > base.version) {
      if (dirty) setConflict(dto);
      else {
        setBase(dto);
        setDraft({ content: dto.content, language: dto.language });
      }
    }
  }

  const onEvent = useCallback(
    (event: WeeklySummaryChanged) => {
      if (event.id === dto.id && event.version > base.version) {
        void queryClient.invalidateQueries({ queryKey: summaryKeys.detail(dto.id) });
      }
    },
    [dto.id, base.version, queryClient],
  );
  useSummaryEvents(onEvent);

  const save = useCallback(async (): Promise<WeeklySummaryDto | null> => {
    if (!dirty || conflict) return conflict ? null : base;
    if (savingRef.current) return null;
    savingRef.current = true;
    setSaving(true);
    const at = edits.current;
    try {
      const next = await saveSummary(base.id, {
        version: base.version,
        content: cleaned(draft.content),
        language: draft.language,
      });
      adopt(next, false);
      if (edits.current === at) setDirty(false);
      return next;
    } catch (error) {
      const c = conflictOf(error);
      if (c) setConflict(c.current);
      else setNotice('error');
      return null;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [dirty, conflict, base, draft, adopt]);

  // Autosave, never while a conflict is open.
  useEffect(() => {
    if (!dirty || conflict || !editable || saving) return;
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, dirty, conflict, editable, saving, save]);

  const edit = (change: (d: Draft) => Draft) => {
    edits.current++;
    setDraft(change);
    setDirty(true);
    setNotice(null);
  };

  /** Runs an action on the saved draft; a 409 shows the conflict or the corrected draft. */
  async function act(action: (saved: WeeklySummaryDto) => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      const saved = dirty ? await save() : base;
      if (saved) await action(saved);
    } catch (error) {
      const c = conflictOf(error);
      if (c?.code === 'refs_changed') {
        adopt(c.current, true);
        setNotice('refsChanged');
      } else if (c) setConflict(c.current);
      else setNotice('error');
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || saving;
  const refetch = () => queryClient.invalidateQueries({ queryKey: summaryKeys.detail(base.id) });

  const currentWeek = isoWeek(new Date());
  const older = base.status === 'draft' && base.week < currentWeek;
  const range = rangeLabel(i18n.language, new Date(base.windowStart), new Date(base.windowEnd));
  const sectionTitle = (s: (typeof WeeklySummarySections)[number]) =>
    t(`weeklySummary.sections.${s}`);

  return (
    <div className="flex max-w-[760px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          to="/weekly-summaries"
          className="self-start text-button font-medium text-muted-foreground hover:text-foreground"
        >
          {t('weeklySummary.editor.back')}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-medium leading-tight font-semibold">{base.groupName}</h1>
          <StatusChip status={base.status} skipReason={base.skipReason} />
        </div>
        <p className="text-button text-muted-foreground tabular-nums">
          {t('weeklySummary.list.subtitle', { week: weekNumber(base.week), range })}
        </p>
      </div>

      {base.status === 'draft' && base.aiFailed && (
        <p className="rounded-lg bg-attention p-3 text-button text-attention-foreground">
          {t('weeklySummary.editor.aiFailed')}
        </p>
      )}
      {base.status === 'draft' && !base.aiFailed && base.source === 'ai' && (
        <p className="text-button text-muted-foreground">{t('weeklySummary.editor.aiNote')}</p>
      )}
      {older && (
        <p className="rounded-lg bg-secondary p-3 text-button">
          {t('weeklySummary.editor.olderWeek', { week: weekNumber(base.week) })}
        </p>
      )}
      {base.status === 'preparing' && (
        <p className="text-button text-muted-foreground" aria-live="polite">
          {t('weeklySummary.editor.preparing')}
        </p>
      )}
      {base.status === 'sent' && base.sentAt && (
        <p className="text-button font-semibold">
          {t('weeklySummary.editor.sent', {
            date: dateTimeLabel(i18n.language, base.sentAt),
            name: base.sentBy?.name ?? '–',
          })}
        </p>
      )}
      {base.status === 'draft' && !base.managedByMe && (
        <p className="text-button text-muted-foreground">{t('weeklySummary.editor.readOnly')}</p>
      )}
      {base.groupDeactivated && (
        <p className="text-button text-muted-foreground">{t('weeklySummary.editor.deactivated')}</p>
      )}
      {conflict && (
        <PanelNotice
          text={t('weeklySummary.editor.conflict', { name: conflict.updatedBy?.name ?? '–' })}
        >
          <Button size="sm" onClick={() => (adopt(conflict, true), setConflict(null))}>
            {t('weeklySummary.editor.loadNew')}
          </Button>
        </PanelNotice>
      )}
      {notice === 'refsChanged' && (
        <p
          role="alert"
          className="rounded-lg bg-attention p-3 text-button text-attention-foreground"
        >
          {t('weeklySummary.editor.refsChanged')}
        </p>
      )}
      {notice === 'testSent' && (
        <p role="status" className="text-button">
          {t('weeklySummary.editor.testSent')}
        </p>
      )}
      {notice === 'error' && (
        <p role="alert" className="text-button text-error-ink">
          {t('errors.generic')}
        </p>
      )}

      {base.status !== 'preparing' && (
        <div className="flex flex-col gap-6 rounded-xl bg-card p-6 max-[640px]:p-4">
          <label className="flex flex-col gap-2">
            <span className="text-body font-semibold">{t('weeklySummary.editor.intro')}</span>
            <textarea
              value={draft.content.intro}
              rows={3}
              maxLength={WEEKLY_SUMMARY_LIMITS.intro}
              disabled={!editable}
              className={TEXTAREA}
              onChange={(e) =>
                edit((d) => ({ ...d, content: { ...d.content, intro: e.target.value } }))
              }
            />
          </label>
          {WeeklySummarySections.map((s) => (
            <SectionEditor
              key={s}
              title={sectionTitle(s)}
              items={draft.content[s]}
              refs={base.refs}
              disabled={!editable}
              onChange={(items) => edit((d) => ({ ...d, content: { ...d.content, [s]: items } }))}
            />
          ))}
          <label className="flex flex-col gap-2">
            <span className="text-body font-semibold">{t('weeklySummary.editor.closing')}</span>
            <textarea
              value={draft.content.closing}
              rows={2}
              maxLength={WEEKLY_SUMMARY_LIMITS.closing}
              disabled={!editable}
              className={TEXTAREA}
              onChange={(e) =>
                edit((d) => ({ ...d, content: { ...d.content, closing: e.target.value } }))
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-button font-semibold">{t('weeklySummary.editor.language')}</span>
            <Select
              value={draft.language}
              disabled={!editable}
              containerClassName="self-start"
              onChange={(e) => edit((d) => ({ ...d, language: e.target.value as UserLanguage }))}
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </Select>
            <span className="text-micro text-muted-foreground">
              {t('weeklySummary.editor.languageHint')}
            </span>
          </label>
        </div>
      )}

      <p className="text-button">
        {base.recipients.length === 0
          ? t('weeklySummary.editor.noRecipients')
          : t(
              base.status === 'sent' ? 'weeklySummary.editor.gotIt' : 'weeklySummary.editor.getsIt',
              {
                names: base.recipients.map((r) => `${r.name} (${r.language})`).join(', '),
              },
            )}
      </p>

      <div className="flex flex-wrap gap-2">
        {editable && (
          <Button variant="secondary" disabled={!dirty || locked} onClick={() => void save()}>
            {t('weeklySummary.editor.save')}
          </Button>
        )}
        {base.status !== 'preparing' && (
          <Button
            variant="secondary"
            disabled={locked}
            onClick={() => void act(async () => setLayer('preview'))}
          >
            {t('weeklySummary.editor.preview')}
          </Button>
        )}
        {editable && (
          <>
            <Button
              variant="secondary"
              disabled={locked}
              onClick={() =>
                void act(async (saved) => {
                  await testSummary(saved.id);
                  setNotice('testSent');
                })
              }
            >
              {t('weeklySummary.editor.test')}
            </Button>
            <Button variant="secondary" disabled={locked} onClick={() => setLayer('regenerate')}>
              {t('weeklySummary.editor.regenerate')}
            </Button>
            <Button
              variant="ghost"
              disabled={locked}
              onClick={() =>
                void act(async (saved) => adopt(await skipSummary(saved.id, saved.version), true))
              }
            >
              {t('weeklySummary.editor.skip')}
            </Button>
          </>
        )}
        {base.revisionCount > 0 && (
          <Button variant="ghost" onClick={() => setLayer('revisions')}>
            {t('weeklySummary.editor.revisions', { count: base.revisionCount })}
          </Button>
        )}
        {editable && !base.groupDeactivated && (
          <Button
            className="min-[641px]:ml-auto"
            disabled={locked || base.recipients.length === 0}
            onClick={() => void act(async () => setLayer('send'))}
          >
            {t('weeklySummary.editor.send')}
          </Button>
        )}
      </div>
      {layer === 'regenerate' && (
        <InlineConfirm
          question={t('weeklySummary.editor.regenerateQuestion')}
          confirmLabel={t('weeklySummary.editor.regenerateConfirm')}
          cancelLabel={t('weeklySummary.send.cancel')}
          busy={locked}
          onCancel={() => setLayer(null)}
          onConfirm={() =>
            void act(async (saved) => {
              setLayer(null);
              await regenerateSummary(saved.id, {
                version: saved.version,
                language: draft.language,
              });
              setDirty(false);
              await refetch();
            })
          }
        />
      )}

      {base.managedByMe && <SettingsStrip groupId={base.groupId} />}

      {layer === 'preview' && (
        <PreviewDialog
          summaryId={base.id}
          version={base.version}
          initial={draft.language}
          onClose={() => setLayer(null)}
        />
      )}
      {layer === 'revisions' && (
        <RevisionsDialog
          summaryId={base.id}
          canRestore={editable}
          busy={locked}
          onClose={() => setLayer(null)}
          onRestore={(revision: WeeklySummaryRevision) =>
            void act(async (saved) => {
              adopt(await restoreRevision(saved.id, revision.id, saved.version), true);
              setLayer(null);
            })
          }
        />
      )}
      {layer === 'send' && (
        <SendDialog
          count={base.recipients.length}
          busy={locked}
          onClose={() => setLayer(null)}
          onConfirm={() =>
            void act(async (saved) => {
              setLayer(null);
              await sendSummary(saved.id, saved.version);
              await refetch();
            })
          }
        />
      )}
    </div>
  );
}
