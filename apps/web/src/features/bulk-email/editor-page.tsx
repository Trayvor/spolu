import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker, useNavigate, useParams, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BULK_LIMITS, type BulkCampaignDto, type BulkNotReadyProblem } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { previousHref } from '@/lib/back';
import { AudienceBuilder } from './audience-builder';
import { BlockList } from './block-list';
import type { BlocksAction } from './blocks';
import { BuilderWorkspace, type WorkspaceTab } from './builder-workspace';
import { ModeBar } from './mode-bar';
import { applyEdit, returnToDesktop, shownBlocks, type EditMode } from './phone-version';
import { campaignListKey, campaignQuery, deleteCampaign, saveCampaign } from './api';
import { FieldNote, StatusBadge } from './parts';
import { PreviewFrame } from './preview-frame';
import { ReportView } from './report-view';
import { SendStep } from './send-dialog';
import { TestSend } from './test-send';
import { useAutosave, type SaveState } from './use-autosave';
import { useBulkEvents } from './use-bulk-events';
import {
  draftProblems,
  hasProblems,
  validBlocks,
  type EditableDraft,
  type FieldProblem,
} from './validation';

export function CampaignPageRoute() {
  const { campaignId } = useParams({ strict: false });
  return <CampaignPage campaignId={campaignId ?? ''} />;
}

const isList = (href: string) => new URL(href, 'http://app.invalid').pathname === '/bulk-email';

/**
 * "All emails": one step back when the list is the entry before (its scroll and filters come
 * back), else the list in place of this page, so Back never returns to an email just left.
 */
function BackLink() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Link
      to="/bulk-email"
      replace
      onClick={(event) => {
        const previous = previousHref(router);
        if (previous === undefined || !isList(previous)) return;
        event.preventDefault();
        router.history.back();
      }}
      className="inline-flex self-start text-tiny font-semibold hover:underline max-[640px]:min-h-11 max-[640px]:items-center"
    >
      {t('bulkEmail.editor.back')}
    </Link>
  );
}

/**
 * `/bulk-email/$campaignId`: the editor for a draft; for a campaign that is sending, sent or
 * cancelled the report.
 */
function CampaignPage({ campaignId }: { campaignId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const campaign = useQuery(campaignQuery(campaignId));
  // Bumped by "Reload": the editor remounts with the campaign as the server has it now.
  const [loadKey, setLoadKey] = useState(0);
  useBulkEvents();

  const reload = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: campaignQuery(campaignId).queryKey });
    setLoadKey((k) => k + 1);
  }, [queryClient, campaignId]);

  if (campaign.isError) {
    const missing = campaign.error instanceof ApiError && campaign.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <p role="alert" className="text-button">
          {missing ? t('bulkEmail.editor.notFound') : t('errors.generic')}
        </p>
      </div>
    );
  }
  if (!campaign.data) return null;
  if (campaign.data.status !== 'draft') {
    return <ReportView campaign={campaign.data} back={<BackLink />} />;
  }
  return (
    <DraftEditor
      key={`${campaign.data.id}:${loadKey}`}
      campaign={campaign.data}
      onReload={reload}
    />
  );
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const id = `section-${n}`;
  return (
    <Card aria-labelledby={id} role="region" className="gap-5 px-4 py-5 min-[641px]:px-6">
      <h2 id={id} className="flex items-center gap-3 text-body font-semibold">
        <span
          aria-hidden="true"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-tiny text-primary-foreground"
        >
          {n}
        </span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

function SaveStatus({
  state,
  onRetry,
  onReload,
}: {
  state: SaveState;
  onRetry: () => void;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  if (state === 'changed' || state === 'notDraft') {
    return (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-xl border-2 border-destructive bg-card p-4 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between"
      >
        <p className="text-button">{t(`bulkEmail.save.${state}`)}</p>
        <Button type="button" onClick={onReload}>
          {t('bulkEmail.save.reload')}
        </Button>
      </div>
    );
  }
  const text = {
    saved: t('bulkEmail.save.saved'),
    pending: t('bulkEmail.save.saving'),
    saving: t('bulkEmail.save.saving'),
    invalid: t('bulkEmail.save.invalid'),
    error: t('bulkEmail.save.error'),
  }[state];
  const bad = state === 'invalid' || state === 'error';
  return (
    <div className="flex items-center gap-3" data-testid="save-status">
      <p
        role="status"
        className={bad ? 'text-micro text-error-ink' : 'text-micro text-muted-foreground'}
      >
        {text}
      </p>
      {state === 'error' && (
        <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
          {t('bulkEmail.save.retry')}
        </Button>
      )}
    </div>
  );
}

function TextField({
  id,
  label,
  hint,
  value,
  problem,
  max,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  problem?: FieldProblem;
  max: number;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const note = problem ? t(`bulkEmail.problems.${problem}`, { max }) : hint;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={problem ? true : undefined}
        aria-describedby={note ? `${id}-note` : undefined}
      />
      {note && (
        <FieldNote id={`${id}-note`} error={Boolean(problem)}>
          {note}
        </FieldNote>
      )}
    </div>
  );
}

function DraftEditor({
  campaign,
  onReload,
}: {
  campaign: BulkCampaignDto;
  onReload: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<EditableDraft>(() => ({
    name: campaign.name,
    subject: campaign.subject,
    preheader: campaign.preheader,
    blocks: campaign.blocks,
    phoneBlocks: campaign.phoneBlocks,
    audience: campaign.audience,
  }));
  // The Computer / Phone switch: what the preview shows and which version the blocks edit.
  const [mode, setMode] = useState<EditMode>('computer');
  // Below 840 px of workspace one pane shows at a time (Blocks / Preview).
  const [tab, setTab] = useState<WorkspaceTab>('blocks');
  const previewRef = useRef<HTMLElement>(null);
  // Bumped by "Return to the computer version": the text editors start again from desktop.
  const [returned, setReturned] = useState(0);
  const [serverProblems, setServerProblems] = useState<BulkNotReadyProblem[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const problems = useMemo(() => draftProblems(draft), [draft]);

  const save = useCallback(
    async (d: EditableDraft, version: number) => {
      const saved = await saveCampaign(campaign.id, { ...d, version });
      queryClient.setQueryData(campaignQuery(campaign.id).queryKey, saved);
      return saved;
    },
    [campaign.id, queryClient],
  );
  const isValid = useCallback((d: EditableDraft) => !hasProblems(draftProblems(d)), []);
  const autosave = useAutosave({ draft, version: campaign.version, save, isValid });

  // Leaving with changes that cannot be saved (invalid, or the save failed) asks first; closing
  // the tab also while a save waits. A delete leaves without asking.
  const leaving = useRef(false);
  const saveState = useRef(autosave.state);
  useEffect(() => {
    saveState.current = autosave.state;
  });
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      next.pathname !== current.pathname &&
      (saveState.current === 'invalid' || saveState.current === 'error') &&
      !leaving.current,
    enableBeforeUnload: () =>
      !leaving.current && saveState.current !== 'saved' && saveState.current !== 'notDraft',
    withResolver: true,
  });

  // Another admin saved while nothing here waits to be saved: take their version.
  useEffect(() => {
    if (campaign.version > autosave.version && autosave.state === 'saved') void onReload();
  }, [campaign.version, autosave.version, autosave.state, onReload]);

  const dispatch = useCallback(
    (action: BlocksAction) => setDraft((d) => applyEdit(d, mode, action)),
    [mode],
  );
  const showPhone = useCallback(() => {
    setMode('phone');
    setTab('preview');
    previewRef.current?.scrollIntoView?.({ block: 'start' });
  }, []);
  const editingPhone = mode === 'phone' && draft.phoneBlocks !== null;
  const remove = useMutation({
    mutationFn: () => deleteCampaign(campaign.id),
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: campaignListKey });
      leaving.current = true;
      // In place of the deleted draft: Back must not lead to "This email does not exist".
      await navigate({ to: '/bulk-email', replace: true });
    },
  });
  const set = (patch: Partial<EditableDraft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="flex flex-col gap-5">
      <BackLink />
      {blocker.status === 'blocked' && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border-2 border-destructive bg-card p-4 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between"
        >
          <p className="text-button">{t('bulkEmail.editor.unsaved')}</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={blocker.reset}>
              {t('bulkEmail.editor.stay')}
            </Button>
            <Button type="button" variant="destructive" onClick={blocker.proceed}>
              {t('bulkEmail.editor.leave')}
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 text-medium leading-tight font-semibold break-words">
            {draft.name.trim() || campaign.name}
          </h1>
          <StatusBadge status="draft" />
        </div>
        <SaveStatus
          state={autosave.state}
          onRetry={autosave.retry}
          onReload={() => void onReload()}
        />
      </div>

      <Section n={1} title={t('bulkEmail.content.title')}>
        <div className="grid gap-4 min-[641px]:grid-cols-2 min-[1280px]:grid-cols-3">
          <TextField
            id="campaign-name"
            label={t('bulkEmail.content.name')}
            hint={t('bulkEmail.content.nameHint')}
            value={draft.name}
            problem={problems.name}
            max={BULK_LIMITS.name}
            onChange={(name) => set({ name })}
          />
          <TextField
            id="campaign-subject"
            label={t('bulkEmail.content.subject')}
            value={draft.subject}
            problem={problems.subject}
            max={BULK_LIMITS.subject}
            onChange={(subject) => set({ subject })}
          />
          <div className="min-[641px]:col-span-2 min-[1280px]:col-span-1">
            <TextField
              id="campaign-preheader"
              label={t('bulkEmail.content.preheader')}
              hint={t('bulkEmail.content.preheaderHint')}
              value={draft.preheader}
              problem={problems.preheader}
              max={BULK_LIMITS.preheader}
              onChange={(preheader) => set({ preheader })}
            />
          </div>
        </div>
        <div className="flex flex-col gap-5">
          <ModeBar
            mode={mode}
            onMode={setMode}
            separate={draft.phoneBlocks !== null}
            onReturn={() => {
              setDraft((d) => returnToDesktop(d));
              setReturned((n) => n + 1);
            }}
          />
          <BuilderWorkspace
            tab={tab}
            onTab={setTab}
            blocks={
              <BlockList
                // Another version on screen: the text editors start from its content. Not on the
                // first phone edit: the phone copy is what the editors already show.
                key={`${mode}:${returned}`}
                blocks={shownBlocks(draft, mode)}
                problems={editingPhone ? problems.phoneBlocks : problems.blocks}
                serverProblems={serverProblems.filter((p) => Boolean(p.phone) === editingPhone)}
                dispatch={dispatch}
              />
            }
            preview={
              <PreviewFrame
                ref={previewRef}
                className="min-h-0 flex-1"
                campaignId={campaign.id}
                device={mode}
                subject={draft.subject.slice(0, BULK_LIMITS.subject)}
                preheader={draft.preheader.slice(0, BULK_LIMITS.preheader)}
                blocks={validBlocks(draft.blocks)}
                phoneBlocks={draft.phoneBlocks && validBlocks(draft.phoneBlocks)}
              />
            }
          />
        </div>
      </Section>

      {/* The steps after the builder keep a readable width on a wide screen. */}
      <div className="flex w-full max-w-[1104px] flex-col gap-5">
        <Section n={2} title={t('bulkEmail.audience.title')}>
          <AudienceBuilder audience={draft.audience} onChange={(audience) => set({ audience })} />
        </Section>

        <Section n={3} title={t('bulkEmail.test.title')}>
          <TestSend
            campaignId={campaign.id}
            canSend={autosave.state === 'saved'}
            onProblems={setServerProblems}
          />
        </Section>

        <Section n={4} title={t('bulkEmail.send.title')}>
          <SendStep
            campaignId={campaign.id}
            subject={draft.subject}
            audience={draft.audience}
            saveState={autosave.state}
            flush={autosave.flush}
            onProblems={setServerProblems}
            phoneFollows={draft.phoneBlocks === null}
            phoneCheckShown={campaign.phoneCheckShown}
            onShowPhone={showPhone}
          />
        </Section>

        <div className="flex flex-col gap-3 min-[641px]:flex-row min-[641px]:items-center">
          {confirmDelete ? (
            <>
              <p className="text-button">{t('bulkEmail.editor.deleteConfirm')}</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  {t('bulkEmail.editor.deleteYes')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
                  {t('bulkEmail.editor.cancel')}
                </Button>
              </div>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="self-start"
              onClick={() => setConfirmDelete(true)}
            >
              {t('bulkEmail.editor.delete')}
            </Button>
          )}
          {remove.isError && (
            <p role="alert" className="text-micro text-error-ink">
              {t('errors.generic')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
