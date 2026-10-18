import { useId, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SNIPPET_LIMITS, type Snippet } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InlineConfirm } from '@/components/ui/inline-confirm';
import { ApiError } from '@/lib/api';
import { createSnippet, deleteSnippet, snippetsQuery, updateSnippet } from './api';

/** `{{name}}` shown literally in texts that i18next would otherwise interpolate. */
const PLACEHOLDER = '{{name}}';

/**
 * "Saved replies" on /settings, admins only (F7): the admin's canned replies and the team's
 * shared ones, a form to add one, and edit or delete on the admin's own. A lazy chunk with its
 * namespace `snippets`; the anchor `#snippets` is where the composer's list links.
 */
export function SnippetsSection() {
  const { t } = useTranslation();
  const { data } = useQuery(snippetsQuery);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <Card id="snippets">
      <CardHeader>
        <CardTitle>
          <h2>{t('snippets.title')}</h2>
        </CardTitle>
        <p className="text-tiny text-muted-foreground">
          {t('snippets.intro', { placeholder: PLACEHOLDER })}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <SnippetForm key="new" />
        {data && data.length === 0 && (
          <p className="text-tiny text-muted-foreground">{t('snippets.empty')}</p>
        )}
        {data && data.length > 0 && (
          <ul role="list" className="flex flex-col divide-y divide-border border-t border-border">
            {data.map((snippet) =>
              editing === snippet.id ? (
                <li key={snippet.id} className="py-4">
                  <SnippetForm snippet={snippet} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <SnippetRow
                  key={snippet.id}
                  snippet={snippet}
                  onEdit={() => setEditing(snippet.id)}
                />
              ),
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SnippetRow({ snippet, onEdit }: { snippet: Snippet; onEdit(): void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [failed, setFailed] = useState(false);

  async function remove() {
    setFailed(false);
    try {
      await deleteSnippet(snippet.id);
      await queryClient.invalidateQueries({ queryKey: snippetsQuery.queryKey });
    } catch {
      setFailed(true);
    }
  }

  return (
    <li className="flex flex-col gap-1.5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{snippet.title}</span>
        {snippet.shared && (
          <span className="rounded-full bg-secondary px-2 text-nano font-semibold text-secondary-foreground">
            {snippet.mine
              ? t('snippets.shared')
              : t('snippets.sharedBy', { name: snippet.authorName })}
          </span>
        )}
      </div>
      <p className="line-clamp-3 text-tiny whitespace-pre-wrap text-muted-foreground">
        {snippet.body}
      </p>
      {snippet.mine && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onEdit}>
            {t('snippets.edit')}
          </Button>
          {confirm ? (
            <InlineConfirm
              question={t('snippets.deleteQuestion', { title: snippet.title })}
              confirmLabel={t('snippets.delete')}
              cancelLabel={t('snippets.cancel')}
              onConfirm={() => void remove()}
              onCancel={() => setConfirm(false)}
            />
          ) : (
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(true)}>
              {t('snippets.delete')}
            </Button>
          )}
        </div>
      )}
      {failed && (
        <p role="alert" className="text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
    </li>
  );
}

/** A new snippet (no `snippet`) or the edit of one of the admin's own. */
function SnippetForm({ snippet, onDone }: { snippet?: Snippet; onDone?(): void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const id = useId();
  const [title, setTitle] = useState(snippet?.title ?? '');
  const [body, setBody] = useState(snippet?.body ?? '');
  const [shared, setShared] = useState(snippet?.shared ?? false);
  const [status, setStatus] = useState<'idle' | 'busy' | 'empty' | 'limit' | 'error'>('idle');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (status === 'busy') return;
    const value = { title: title.trim(), body: body.trim(), shared };
    if (value.title === '' || value.body === '') {
      setStatus('empty');
      return;
    }
    setStatus('busy');
    try {
      if (snippet) await updateSnippet(snippet.id, value);
      else await createSnippet(value);
      await queryClient.invalidateQueries({ queryKey: snippetsQuery.queryKey });
      setStatus('idle');
      if (snippet) onDone?.();
      else {
        setTitle('');
        setBody('');
        setShared(false);
      }
    } catch (error) {
      setStatus(error instanceof ApiError && error.code === 'snippet_limit' ? 'limit' : 'error');
    }
  }

  const message = {
    idle: null,
    busy: null,
    empty: t('snippets.form.required'),
    limit: t('snippets.form.limit', { max: SNIPPET_LIMITS.perUser }),
    error: t('errors.generic'),
  }[status];

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {!snippet && <h3 className="font-semibold">{t('snippets.form.newTitle')}</h3>}
      <div className="flex flex-col gap-2.5">
        <Label htmlFor={`${id}-title`}>{t('snippets.form.title')}</Label>
        <Input
          id={`${id}-title`}
          value={title}
          maxLength={SNIPPET_LIMITS.title}
          placeholder={t('snippets.form.titlePlaceholder')}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={status === 'empty' && title.trim() === '' ? true : undefined}
        />
      </div>
      <div className="flex flex-col gap-2.5">
        <Label htmlFor={`${id}-body`}>{t('snippets.form.body')}</Label>
        <textarea
          id={`${id}-body`}
          value={body}
          rows={4}
          maxLength={SNIPPET_LIMITS.body}
          aria-describedby={`${id}-body-hint`}
          onChange={(e) => setBody(e.target.value)}
          aria-invalid={status === 'empty' && body.trim() === '' ? true : undefined}
          className="min-h-28 w-full rounded-md border-2 border-input bg-card px-[18px] py-[13px] text-button text-foreground focus:border-foreground"
        />
        <p id={`${id}-body-hint`} className="text-micro text-muted-foreground">
          {t('snippets.form.bodyHint', { placeholder: PLACEHOLDER })}
        </p>
      </div>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={shared}
          onChange={(e) => setShared(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-foreground"
        />
        <span className="flex flex-col gap-0.5">
          <span>{t('snippets.form.shared')}</span>
          <span className="text-tiny text-muted-foreground">{t('snippets.form.sharedHint')}</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={status === 'busy'}>
          {snippet ? t('snippets.form.saveChanges') : t('snippets.form.save')}
        </Button>
        {snippet && (
          <Button type="button" variant="ghost" onClick={onDone}>
            {t('snippets.cancel')}
          </Button>
        )}
      </div>
      {message && (
        <p role="alert" className="text-micro text-error-ink">
          {message}
        </p>
      )}
    </form>
  );
}
