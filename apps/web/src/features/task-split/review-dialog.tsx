import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ErrorCodes,
  plainExcerpt,
  type MessageDto,
  type TaskDetailDto,
  type TaskProposals,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { useGroupPeople } from '@/features/groups/use-group-people';
import { todayInBratislava } from '@/features/tasks/dates';
import { TaskForm, validateTaskDraft, type TaskFormErrors } from '@/features/tasks/task-form';
import { ApiError } from '@/lib/api';
import { useMediaQuery } from '@/lib/use-media-query';
import { aiStatusQuery } from './api';
import { createTasksFromMessage, proposeTasks } from './split-api';
import { DecisionButtons, ReviewCardView } from './review-card';
import {
  canSubmit,
  cardByHand,
  cardsFromProposals,
  isTouched,
  toRequest,
  type ReviewCard,
} from './review-model';

const QUOTE_EXCERPT = 280;
const OUTLINES = [0, 1, 2];

type Problem = 'failed' | 'noTasks' | 'unavailable' | 'gone';

const PROBLEM_KEYS: Record<Problem, string> = {
  failed: 'taskSplit.failed',
  noTasks: 'taskSplit.noTasks',
  unavailable: 'taskSplit.unavailable',
  gone: 'taskSplit.messageGone',
};

function proposalProblem(error: unknown): Problem {
  if (error instanceof ApiError) {
    if (error.code === ErrorCodes.aiNoTasks) return 'noTasks';
    if (error.code === ErrorCodes.aiUnavailable) return 'unavailable';
    if (error.status === 404) return 'gone';
  }
  return 'failed';
}

function createProblemKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'taskSplit.messageGone';
    if (error.code === ErrorCodes.invalidAttachment) return 'taskSplit.filesChanged';
  }
  return 'taskSplit.createFailed';
}

/**
 * "Turn into tasks": the AI's proposed cards for one message, reviewed before anything exists.
 * A `SheetDialog`: a centred 720 px dialog from 641 px, a full-screen sheet below with the footer
 * always in view.
 * Every card shows as a compact summary; opening one shows its `TaskForm` (in place on desktop,
 * one at a time; a full-screen layer with Done on phones). "Create N tasks" sends the approved
 * cards once every card is approved or rejected. The backdrop does nothing; Escape and Cancel
 * ask before throwing away decisions or edits. Lazy-loaded by `useMessageTaskTools`.
 */
export function ReviewDialog({
  groupId,
  message,
  onClose,
  onCreated,
}: {
  groupId: string;
  message: MessageDto;
  onClose: () => void;
  onCreated: (tasks: TaskDetailDto[]) => void;
}) {
  const { t } = useTranslation();
  const desktop = useMediaQuery('(min-width: 641px)');
  const people = useGroupPeople(groupId).data;
  const [today] = useState(todayInBratislava);
  const messageFileIds = useMemo(
    () => new Set(message.attachments.map((f) => f.id)),
    [message.attachments],
  );

  // One request per message; gcTime 0 drops it on close, so reopening asks the AI afresh.
  const proposals = useQuery({
    queryKey: ['ai', 'split', message.id],
    queryFn: () => proposeTasks(message.id),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const [cards, setCards] = useState<ReviewCard[] | null>(null);
  const [initial, setInitial] = useState<ReviewCard[]>([]);
  const [seeded, setSeeded] = useState<TaskProposals | undefined>();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, TaskFormErrors>>({});
  const [focus, setFocus] = useState<{ key: string; n: number }>({ key: '', n: 0 });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [createError, setCreateError] = useState<{ text: string; n: number } | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  // Set by "Try again": once the new cards arrive, the focus goes to the first one.
  const [refocus, setRefocus] = useState(false);
  const [focusCreate, setFocusCreate] = useState(0);

  // The proposals become cards once, when they arrive.
  if (proposals.data && proposals.data !== seeded) {
    setSeeded(proposals.data);
    const next = cardsFromProposals(proposals.data.tasks, message.attachments);
    setCards(next);
    setInitial(next);
    if (refocus) {
      setRefocus(false);
      if (next[0]) setFocus((f) => ({ key: next[0]!.key, n: f.n + 1 }));
    }
  }

  const loading = cards === null && (proposals.isPending || proposals.isFetching);
  const problem = cards === null && !loading ? proposalProblem(proposals.error) : null;
  // The server turned the AI off since the status was read: hide the action from now on.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (problem === 'unavailable')
      queryClient.setQueryData(aiStatusQuery.queryKey, { taskSplit: false });
  }, [problem, queryClient]);
  const touched = cards !== null && isTouched(cards, initial);
  const approvedCount = cards?.filter((c) => c.decision === 'approved').length ?? 0;
  const anyPending = cards?.some((c) => c.decision === 'pending') ?? false;
  const openCard = cards?.find((c) => c.key === openKey);
  const layer = !desktop && openCard !== undefined;
  const openTitle = openCard ? openCard.draft.title.trim() || t('taskSplit.untitled') : '';

  // One live region, mounted empty: its text is set after mount (cleared, then filled a tick
  // later), so every state is announced, a repeated create error too.
  const liveText = createError
    ? createError.text
    : loading
      ? t('taskSplit.loading')
      : problem
        ? t(PROBLEM_KEYS[problem])
        : seeded && cards
          ? t('taskSplit.proposed', { count: seeded.tasks.length })
          : '';
  const liveKey = `${liveText}#${createError?.n ?? 0}`;
  const [live, setLive] = useState('');
  useEffect(() => {
    setLive('');
    const fill = setTimeout(() => setLive(liveText), 0);
    return () => clearTimeout(fill);
    // liveKey also changes when the same create error comes back.
  }, [liveKey, liveText]);

  useEffect(() => {
    if (focusCreate) createRef.current?.focus();
  }, [focusCreate]);

  const nameOf = (id: string) =>
    people?.find((p) => p.id === id)?.name ??
    (id === message.author.id ? message.author.name : undefined);

  const focusCard = (key: string) => setFocus((f) => ({ key, n: f.n + 1 }));

  const update = (key: string, patch: Partial<ReviewCard>) => {
    setCards((list) => list?.map((c) => (c.key === key ? { ...c, ...patch } : c)) ?? list);
    if (patch.draft && errors[key] && Object.keys(errors[key]).length > 0) {
      const found = validateTaskDraft(patch.draft);
      setErrors((all) => ({ ...all, [key]: found }));
    }
  };

  const decide = (key: string, decision: ReviewCard['decision']) => update(key, { decision });

  /** Valid cards are approved; the first invalid one opens with its errors. */
  const approve = (keys: string[]) => {
    if (!cards) return false;
    const found: Record<string, TaskFormErrors> = {};
    const ok = new Set<string>();
    for (const key of keys) {
      const card = cards.find((c) => c.key === key);
      if (!card) continue;
      const result = validateTaskDraft(card.draft);
      if (Object.keys(result).length > 0) found[key] = result;
      else ok.add(key);
    }
    setCards(
      (list) => list?.map((c) => (ok.has(c.key) ? { ...c, decision: 'approved' } : c)) ?? list,
    );
    setErrors((all) => {
      const next = { ...all, ...found };
      for (const key of ok) delete next[key];
      return next;
    });
    const firstBad = keys.find((key) => found[key]);
    if (firstBad) setOpenKey(firstBad);
    return firstBad === undefined;
  };

  /** "Approve all" disappears once nothing is pending: the focus moves on to Create. */
  const approveAll = () => {
    if (!cards) return;
    const pending = cards.filter((c) => c.decision === 'pending').map((c) => c.key);
    // An invalid card opens with its title focused instead.
    if (approve(pending)) setFocusCreate((n) => n + 1);
  };

  /** "Try again" disappears while loading: the title holds the focus until the cards come. */
  const retry = () => {
    titleRef.current?.focus();
    setRefocus(true);
    void proposals.refetch();
  };

  const toggleApprove = (card: ReviewCard) => {
    if (card.decision === 'approved') decide(card.key, 'pending');
    else approve([card.key]);
  };

  const reject = (key: string) => {
    decide(key, 'rejected');
    if (openKey === key) setOpenKey(null);
    focusCard(key);
  };

  const undo = (key: string) => {
    decide(key, 'pending');
    focusCard(key);
  };

  const collapse = () => {
    if (openKey) focusCard(openKey);
    setOpenKey(null);
  };

  const byHand = () => {
    const card = cardByHand(message);
    setCards([card]);
    setInitial([card]);
    setOpenKey(card.key);
  };

  const requestClose = () => {
    if (busy) return;
    if (touched) setConfirming(true);
    else onClose();
  };

  const submit = async () => {
    if (sending.current || !cards || !canSubmit(cards)) return;
    const invalid = cards.find(
      (c) => c.decision === 'approved' && Object.keys(validateTaskDraft(c.draft)).length > 0,
    );
    if (invalid) {
      approve([invalid.key]);
      return;
    }
    sending.current = true;
    setBusy(true);
    try {
      const tasks = await createTasksFromMessage(
        groupId,
        toRequest(message.id, cards, messageFileIds),
      );
      onCreated(tasks);
    } catch (error) {
      setCreateError((e) => ({ text: t(createProblemKey(error)), n: (e?.n ?? 0) + 1 }));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const onEscape = (event: KeyboardEvent) => {
    event.preventDefault();
    // An open list inside the form (the assignee picker) closes first.
    const target = event.target;
    if (target instanceof Element && target.closest('[aria-expanded="true"]')) return;
    if (confirming) setConfirming(false);
    else if (layer) collapse();
    else requestClose();
  };

  const form = (card: ReviewCard) => (
    <TaskForm
      value={card.draft}
      onChange={(draft) => update(card.key, { draft })}
      groupId={groupId}
      errors={errors[card.key]}
      files={card.files}
      onFilesChange={(files) => update(card.key, { files })}
      autoFocusTitle
    />
  );

  return (
    // The dialog opens loading, with nothing to act on yet: the focus starts on its title.
    <SheetDialog onEscape={onEscape} initialFocus={titleRef} testId="review">
      <p role="status" data-testid="review-live" className="sr-only">
        {live}
      </p>
      <header className="flex items-center gap-3 px-4 pt-4 pb-3 min-[641px]:px-6 min-[641px]:pt-6">
        <SheetDialogTitle
          ref={titleRef}
          tabIndex={-1}
          className="text-medium font-semibold outline-none"
        >
          {t('taskSplit.title')}
        </SheetDialogTitle>
      </header>

      {/* Hidden, not unmounted, under the phone layer: the list keeps its scroll position. */}
      <div hidden={layer} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 min-[641px]:px-6">
        <figure className="rounded-lg bg-muted px-4 py-3">
          <figcaption className="text-tiny font-semibold">{message.author.name}</figcaption>
          <blockquote className="mt-1 line-clamp-3 break-words text-button text-muted-foreground">
            {plainExcerpt(message.body, nameOf, QUOTE_EXCERPT, t('chat.mention.all'))}
          </blockquote>
        </figure>

        {loading && (
          <div className="mt-4">
            <p className="text-button text-muted-foreground">{t('taskSplit.loading')}</p>
            <div aria-hidden="true" className="mt-3 flex flex-col gap-2 motion-safe:animate-pulse">
              {OUTLINES.map((i) => (
                <div
                  key={i}
                  data-testid="card-outline"
                  className="flex flex-col gap-2.5 rounded-lg border-2 border-dashed border-surface-3 p-4"
                >
                  <span className="h-3 w-3/5 rounded-full bg-secondary" />
                  <span className="h-2.5 w-full rounded-full bg-secondary" />
                  <span className="h-2.5 w-2/5 rounded-full bg-secondary" />
                </div>
              ))}
            </div>
          </div>
        )}

        {problem && (
          <div className="mt-4 flex flex-col items-start gap-3 rounded-lg bg-card p-4">
            <p className="text-body">{t(PROBLEM_KEYS[problem])}</p>
            {problem === 'failed' && (
              <Button variant="outline" size="lg" onClick={retry}>
                {t('taskSplit.retry')}
              </Button>
            )}
            {problem === 'noTasks' && (
              <Button variant="outline" size="lg" onClick={byHand}>
                {t('taskSplit.byHand')}
              </Button>
            )}
          </div>
        )}

        {cards && (
          <>
            <p className="mt-4 text-tiny text-muted-foreground">{t('taskSplit.intro')}</p>
            <div className="mt-3 flex flex-col gap-2">
              {cards.map((card) => (
                <ReviewCardView
                  key={card.key}
                  card={card}
                  people={people}
                  today={today}
                  expanded={desktop && card.key === openKey ? form(card) : undefined}
                  focusSignal={focus.key === card.key ? focus.n : 0}
                  onOpen={() => setOpenKey(card.key)}
                  onCollapse={collapse}
                  onApprove={() => toggleApprove(card)}
                  onReject={() => reject(card.key)}
                  onUndo={() => undo(card.key)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {layer && openCard && (
        <section aria-label={openTitle} className="absolute inset-0 z-10 flex flex-col bg-popover">
          <div className="flex items-center gap-3 border-b-2 border-border px-4 py-2">
            <h3 className="min-w-0 flex-1 truncate text-body font-semibold">
              {t('taskSplit.editCard')}
            </h3>
            <Button size="lg" className="px-5" onClick={collapse}>
              {t('taskSplit.done')}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{form(openCard)}</div>
          <div className="flex justify-end border-t-2 border-border px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))]">
            <DecisionButtons
              card={openCard}
              onApprove={() => {
                // A valid approval goes back to the list; an invalid one stays with its errors.
                const valid = Object.keys(validateTaskDraft(openCard.draft)).length === 0;
                toggleApprove(openCard);
                if (openCard.decision !== 'approved' && valid) collapse();
              }}
              onReject={() => reject(openCard.key)}
            />
          </div>
        </section>
      )}

      <footer
        hidden={layer}
        className="flex flex-col gap-2 border-t-2 border-border px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] min-[641px]:px-6 min-[641px]:pb-4"
      >
        {confirming ? (
          <div role="alert" className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-button font-semibold">{t('taskSplit.discardConfirm')}</p>
            <Button variant="outline" size="lg" onClick={() => setConfirming(false)}>
              {t('taskSplit.keep')}
            </Button>
            <Button variant="destructive" size="lg" onClick={onClose}>
              {t('taskSplit.discard')}
            </Button>
          </div>
        ) : (
          <>
            {createError && <p className="text-button text-error-ink">{createError.text}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {cards && anyPending && (
                <Button variant="secondary" size="lg" className="px-5" onClick={approveAll}>
                  {t('taskSplit.approveAll')}
                </Button>
              )}
              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="lg" className="px-5" onClick={requestClose}>
                  {t('taskSplit.cancel')}
                </Button>
                {cards && (
                  <Button
                    ref={createRef}
                    size="lg"
                    // Not `disabled`: a disabled button drops the focus when the request
                    // starts. `submit` ignores clicks until it may send.
                    aria-disabled={busy || !canSubmit(cards)}
                    className="px-5 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                    // The second click of a double click never sends again, even when the
                    // first request has already failed and re-enabled the button.
                    onClick={(event) => {
                      if (event.detail > 1) return;
                      void submit();
                    }}
                  >
                    {t('taskSplit.create', { count: approvedCount })}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </footer>
    </SheetDialog>
  );
}

export default ReviewDialog;
