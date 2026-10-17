import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { TICKET_LIMITS, type LinkedKnowledge } from '@spolu/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ADMIN_AI_TARGET } from '@/features/chat/ai-tools/api';
import { DescriptionField } from '@/features/editor/description-field';
import { PlainTextField } from '@/features/editor/plain-text-field';

/** The ticket's content as the forms edit it: every field a string, '' for "not given". */
export type ContentDraft = {
  subject: string;
  area: string;
  programme: string;
  body: string;
  dueDate: string;
  url: string;
  /** Knowledge attached to the text (Phase 33 part P5); absent: none. */
  linked?: LinkedKnowledge;
};

export const EMPTY_CONTENT: ContentDraft = {
  subject: '',
  area: '',
  programme: '',
  body: '',
  dueDate: '',
  url: '',
};

const isHttp = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

/** What is wrong with the draft, field by field (the server checks again). */
export function contentErrors(draft: ContentDraft): Partial<Record<keyof ContentDraft, string>> {
  const errors: Partial<Record<keyof ContentDraft, string>> = {};
  if (!draft.subject.trim() && !draft.body.trim() && !draft.area.trim()) {
    errors.subject = 'tickets.form.errors.content';
  }
  if (draft.url.trim() && !isHttp(draft.url.trim())) errors.url = 'tickets.form.errors.url';
  return errors;
}

/**
 * The content fields of a ticket, one per row with the label above (the task form's rhythm):
 * subject, area, grant programme, text, due date, URL. Used by the new-ticket dialog and by an
 * admin's edit of the ticket page. With a client (`groupId`), the text is the description editor
 * with AI, voice and attached knowledge (Phase 33 part P5); without one, a plain textarea.
 */
export function ContentFields({
  draft,
  onChange,
  errors,
  subjectRef,
  groupId,
}: {
  /** The ticket's client; null or '' while there is none. */
  groupId: string | null;
  draft: ContentDraft;
  onChange: (next: ContentDraft) => void;
  errors: Partial<Record<keyof ContentDraft, string>>;
  subjectRef?: React.Ref<HTMLInputElement>;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const set = (key: keyof ContentDraft) => (value: string) => onChange({ ...draft, [key]: value });
  const error = (key: keyof ContentDraft) =>
    errors[key] && (
      <p id={id(`${key}-error`)} role="alert" className="text-tiny text-error-ink">
        {t(errors[key])}
      </p>
    );
  const described = (key: keyof ContentDraft) =>
    errors[key] ? { 'aria-invalid': true, 'aria-describedby': id(`${key}-error`) } : {};

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <Label htmlFor={id('subject')}>{t('tickets.fields.subject')}</Label>
        <Input
          id={id('subject')}
          ref={subjectRef}
          value={draft.subject}
          maxLength={TICKET_LIMITS.subject}
          onChange={(e) => set('subject')(e.target.value)}
          {...described('subject')}
        />
        {error('subject')}
      </div>
      <div className="grid gap-4 min-[641px]:grid-cols-2">
        <div className="flex flex-col gap-2.5">
          <Label htmlFor={id('area')}>{t('tickets.fields.area')}</Label>
          <Input
            id={id('area')}
            value={draft.area}
            maxLength={TICKET_LIMITS.area}
            onChange={(e) => set('area')(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2.5">
          <Label htmlFor={id('programme')}>{t('tickets.fields.programme')}</Label>
          <Input
            id={id('programme')}
            value={draft.programme}
            maxLength={TICKET_LIMITS.programme}
            onChange={(e) => set('programme')(e.target.value)}
          />
        </div>
      </div>
      {groupId ? (
        <DescriptionField
          id={id('body')}
          groupId={groupId}
          value={draft.body}
          onChange={set('body')}
          label={t('tickets.fields.body')}
          editLabel={t('tickets.form.editBody')}
          knowledge={{
            items: draft.linked ?? [],
            onChange: (linked) => onChange({ ...draft, linked }),
          }}
        />
      ) : (
        <PlainTextField
          id={id('body')}
          target={ADMIN_AI_TARGET}
          label={t('tickets.fields.body')}
          rows={6}
          value={draft.body}
          maxLength={TICKET_LIMITS.body}
          onChange={set('body')}
        />
      )}
      <div className="grid gap-4 min-[641px]:grid-cols-[auto_1fr]">
        <div className="flex flex-col gap-2.5">
          <Label htmlFor={id('due')}>{t('tickets.fields.dueDate')}</Label>
          <Input
            id={id('due')}
            type="date"
            value={draft.dueDate}
            onChange={(e) => set('dueDate')(e.target.value)}
            className="min-[641px]:w-auto"
          />
        </div>
        <div className="flex flex-col gap-2.5">
          <Label htmlFor={id('url')}>{t('tickets.fields.url')}</Label>
          <Input
            id={id('url')}
            type="url"
            placeholder="https://…"
            value={draft.url}
            maxLength={2048}
            onChange={(e) => set('url')(e.target.value)}
            {...described('url')}
          />
          {error('url')}
        </div>
      </div>
    </>
  );
}
