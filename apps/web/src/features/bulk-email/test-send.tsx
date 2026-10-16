import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorCodes, type BulkNotReadyProblem } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/use-session';
import { ApiError } from '@/lib/api';
import { sendTest } from './api';

/** The `400 not_ready` reasons in an error body, if any. */
export function notReadyProblems(error: unknown): BulkNotReadyProblem[] | null {
  if (!(error instanceof ApiError) || error.code !== ErrorCodes.notReady) return null;
  const body = error.body as { problems?: unknown };
  return Array.isArray(body.problems) ? (body.problems as BulkNotReadyProblem[]) : [];
}

/**
 * "Send a test to me": the campaign as saved now, to the signed-in admin's own address only.
 * The route comes with part 23.5: until then the server answers its generic 404 (not our
 * `not_found`), and the button gives way to a short note. `canSend` is false while edits are
 * not saved yet, so the test is never older than the screen.
 */
export function TestSend({
  campaignId,
  canSend,
  onProblems,
}: {
  campaignId: string;
  canSend: boolean;
  onProblems: (problems: BulkNotReadyProblem[]) => void;
}) {
  const { t } = useTranslation();
  const me = useSession();
  const [unavailable, setUnavailable] = useState(false);
  const [problems, setProblems] = useState<BulkNotReadyProblem[]>([]);

  const send = useMutation({
    mutationFn: () => sendTest(campaignId),
    onMutate: () => {
      setProblems([]);
      onProblems([]);
    },
    onError: (error) => {
      const found = notReadyProblems(error);
      if (found) {
        setProblems(found);
        onProblems(found);
      } else if (
        error instanceof ApiError &&
        error.status === 404 &&
        error.code !== ErrorCodes.notFound
      ) {
        setUnavailable(true);
      }
    },
  });

  if (unavailable) {
    return <p className="text-button text-muted-foreground">{t('bulkEmail.test.unavailable')}</p>;
  }

  const error = send.error;
  const message = send.isSuccess
    ? t('bulkEmail.test.sent', { email: me?.email ?? '' })
    : error instanceof ApiError && error.status === 429
      ? t('bulkEmail.test.rateLimited')
      : notReadyProblems(error)
        ? t('bulkEmail.test.notReady')
        : error
          ? t('errors.generic')
          : null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-button text-muted-foreground">
        {t('bulkEmail.test.intro', { email: me?.email ?? '' })}
      </p>
      <Button
        type="button"
        className="w-full min-[641px]:w-auto min-[641px]:self-start"
        disabled={!canSend || send.isPending}
        onClick={() => send.mutate()}
      >
        {send.isPending ? t('bulkEmail.test.sending') : t('bulkEmail.test.send')}
      </Button>
      {!canSend && (
        <p className="text-micro text-muted-foreground">{t('bulkEmail.test.unsaved')}</p>
      )}
      <p
        role="status"
        className={error ? 'text-micro text-error-ink empty:hidden' : 'text-micro empty:hidden'}
      >
        {message}
      </p>
      {problems
        .filter((p) => !p.blockId)
        .map((p) => (
          <p key={p.problem} className="text-micro text-error-ink">
            {t(`bulkEmail.notReady.${p.problem}`)}
          </p>
        ))}
    </div>
  );
}
