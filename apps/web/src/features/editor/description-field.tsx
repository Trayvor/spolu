import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GroupPerson, LinkedKnowledge } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { KnowledgeVia } from '@/features/chat/api';
import { MessageBody } from '@/features/chat/format/render';
import { groupPeopleQuery } from '@/features/groups/api';
import { withNamespaces } from '@/i18n/namespaces';
import { cn } from '@/lib/utils';

// The editor (ProseMirror, the toolbar, AI, voice and the knowledge picker) and the cards are
// lazy chunks with the `chat` texts they render: a form gains only this shell (spec §10.2).
const DescriptionEditor = lazy(withNamespaces(['chat'], () => import('./description-editor')));
const LinkedCards = lazy(withNamespaces(['chat'], () => import('./linked-cards')));

/** Knowledge attached under a description (Phase 33 part P5); absent: the field attaches none. */
export interface DescriptionKnowledge {
  items: LinkedKnowledge;
  onChange(next: LinkedKnowledge): void;
  /**
   * The saved description's owner (absent while creating): a client opens an admin-group item
   * read-only through it (Phase 34).
   */
  subject?: KnowledgeVia | null;
}

export interface DescriptionFieldProps {
  id: string;
  /** The group the AI tools, the people and the knowledge come from. */
  groupId: string;
  value: string;
  onChange(next: string): void;
  label: string;
  /** The button that switches a filled, rendered text to editing ("Edit description"). */
  editLabel: string;
  error?: string;
  errorId?: string;
  /** The people mentions are named from; without it, the group's people are fetched. */
  people?: GroupPerson[];
  knowledge?: DescriptionKnowledge;
  /** The AI button and the microphone (default on; the server still decides what shows). */
  aiTools?: boolean;
}

/** The empty editor's height while its chunk loads: the toolbar plus six lines. */
const PLACEHOLDER = 'h-[13.25rem] rounded-md border-2 border-input bg-card';

/**
 * Phase 33 part P5: every long description (task, ticket text, project, event, knowledge body,
 * meeting summary, finance item) in one field. A filled text is shown rendered like a chat
 * message with "Edit"; an empty one opens the editor at once. The editor is the chat's
 * ProseMirror editor in document mode (Enter makes a new line) with its toolbar, the AI button,
 * the microphone and, with `knowledge`, "Attach from the knowledge base". Value in and out is
 * Markdown. A value changed from outside (a form reset) restarts the editor with it.
 */
export function DescriptionField(props: DescriptionFieldProps) {
  const { id, groupId, value, label, editLabel, knowledge, people: givenPeople } = props;
  const fetched = useQuery({ ...groupPeopleQuery(groupId), enabled: givenPeople === undefined });
  const people = givenPeople ?? fetched.data;
  const nameOf = (userId: string) => people?.find((p) => p.id === userId)?.name;
  const [editing, setEditing] = useState(value.trim() === '');
  const [autoFocus, setAutoFocus] = useState(false);
  // The last value the editor reported; any other one comes from outside and restarts it.
  const [emitted, setEmitted] = useState(value);
  const [generation, setGeneration] = useState(0);
  if (value !== emitted) {
    setEmitted(value);
    setGeneration((g) => g + 1);
    setAutoFocus(false);
    setEditing(value.trim() === '');
  }

  function edit() {
    setAutoFocus(true);
    setEditing(true);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <Label id={`${id}-label`}>{label}</Label>
        {!editing && (
          <Button type="button" variant="ghost" size="sm" onClick={edit} className="h-6 px-2">
            {editLabel}
          </Button>
        )}
      </div>
      {editing ? (
        <Suspense fallback={<div aria-hidden="true" className={PLACEHOLDER} />}>
          <DescriptionEditor
            key={generation}
            {...props}
            nameOf={nameOf}
            autoFocus={autoFocus}
            onChange={(next) => {
              setEmitted(next);
              props.onChange(next);
            }}
          />
        </Suspense>
      ) : (
        <>
          <div
            role="group"
            aria-labelledby={`${id}-label`}
            className="rounded-md bg-card px-[18px] py-[13px] text-button"
          >
            <MessageBody body={value} nameOf={nameOf} />
          </div>
          {knowledge && knowledge.items.length > 0 && (
            <Suspense fallback={null}>
              <LinkedCards
                items={knowledge.items}
                groupId={groupId}
                via={null}
                subject={knowledge.subject ?? null}
              />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A saved description, read-only: rendered Markdown and the attached knowledge's cards (the
 * ticket page's text). `via`: the reader reaches the items only through it (a žiadateľ).
 */
export function DescriptionView({
  body,
  groupId,
  linked,
  nameOf,
  via = null,
  subject = null,
  className,
}: {
  body: string;
  groupId: string | null;
  linked: LinkedKnowledge;
  nameOf: (id: string) => string | undefined;
  via?: KnowledgeVia | null;
  /** The description's owner: a client opens an admin-group item through it (Phase 34). */
  subject?: KnowledgeVia | null;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {body.trim() !== '' && <MessageBody body={body} nameOf={nameOf} />}
      {groupId !== null && linked.length > 0 && (
        <Suspense fallback={null}>
          <LinkedCards items={linked} groupId={groupId} via={via} subject={subject} />
        </Suspense>
      )}
    </div>
  );
}
