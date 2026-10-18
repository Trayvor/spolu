import { forwardRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import type { FileInfo, KnowledgeItemDto } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { MessageBody } from '@/features/chat/format/render';
import { DescriptionView } from '@/features/editor/description-field';
import { FileChip } from '@/features/files/file-chip';
import { ImagePreview } from '@/features/files/image-preview';
import { useSession } from '@/features/auth/use-session';
import { ReminderPanel } from '@/features/reminders/reminder-panel';
import { withNamespaces } from '@/i18n/namespaces';
import { Button } from '@/components/ui/button';
import { ChatSourceLabel, chatSourceLocation } from './chat-source';
import { AdminGroupBadge } from './admin-group-badge';
import { ArrowOutIcon, LockIcon, SmallFolderIcon } from './icons';
import { MeetingWhen, RecordingSection, SummarySection, TranscriptSection } from './meeting-view';

type NameOf = (id: string) => string | undefined;

// Teams T1: the admins' Teams block, in its own chunk with its texts.
const TeamsSection = lazy(
  withNamespaces(['teams'], () =>
    import('@/features/teams/teams-section').then((m) => ({ default: m.TeamsSection })),
  ),
);

function Attachments({ files }: { files: FileInfo[] }) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap items-start gap-2">
      {files.map((file) =>
        file.mime.startsWith('image/') ? (
          <ImagePreview
            key={file.id}
            file={file}
            maxWidth={
              file.width && file.height ? Math.min(320, (240 * file.width) / file.height) : 320
            }
          />
        ) : (
          <FileChip key={file.id} file={file} />
        ),
      )}
    </div>
  );
}

function Body({ body, nameOf }: { body: string; nameOf: NameOf }) {
  if (!body.trim()) return null;
  return (
    <div className="break-words text-body">
      <MessageBody body={body} nameOf={nameOf} />
    </div>
  );
}

/**
 * The read-only detail of an item: the type, the title (the sheet's accessible name), the author
 * line with the visibility, a rule, then the content of its type. `onChanged` refetches the item
 * after the viewer's reminder subscription changes.
 */
export const KnowledgeView = forwardRef<
  HTMLHeadingElement,
  { item: KnowledgeItemDto; nameOf: NameOf; onChanged: () => void }
>(function KnowledgeView({ item, nameOf, onChanged }, titleRef) {
  const role = useSession()?.role;
  const isAdmin = role === 'admin' || role === 'superadmin';
  const { t, i18n } = useTranslation();
  const date = new Date(item.createdAt).toLocaleDateString(
    /^en\b/.test(i18n.language) ? 'en-GB' : i18n.language,
    { day: 'numeric', month: 'short', year: 'numeric' },
  );
  return (
    <article className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-muted-foreground">
          <p>{t(`knowledge.types.${item.type}`)}</p>
          {item.folderPath.length > 0 && (
            <p className="flex min-w-0 items-center gap-1" aria-label={t('knowledge.folders.path')}>
              <SmallFolderIcon />
              <span className="truncate">{item.folderPath.map((f) => f.name).join(' / ')}</span>
            </p>
          )}
        </div>
        <SheetDialogTitle
          ref={titleRef}
          tabIndex={-1}
          className="break-words text-medium font-semibold outline-none"
        >
          {item.title}
        </SheetDialogTitle>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-tiny text-muted-foreground">
          <span className="flex items-center gap-2">
            <Avatar userId={item.createdBy.id} name={item.createdBy.name} size={24} />
            {t('knowledge.detail.byline', { name: item.createdBy.name, date })}
          </span>
          {item.source === 'admin_group' && (
            <AdminGroupBadge label={t('knowledge.adminGroup.badge')} />
          )}
          <span className="flex items-center gap-1">
            {item.visibility === 'admins' && <LockIcon />}
            {item.source === 'admin_group' && item.visibility === 'public'
              ? t('knowledge.adminGroup.shareable')
              : t(`knowledge.visibility.${item.visibility}`)}
          </span>
        </div>
      </div>
      <hr className="border-t-2 border-border" />

      {item.type === 'note' && (
        <>
          <Body body={item.body} nameOf={nameOf} />
          <Attachments files={item.files} />
        </>
      )}

      {item.type === 'file' && (
        <>
          {(item.file ?? item.files[0]) && (
            <FileChip file={(item.file ?? item.files[0])!} className="w-full py-3" />
          )}
          <Body body={item.body} nameOf={nameOf} />
        </>
      )}

      {(item.linkedKnowledge?.length ?? 0) > 0 && (
        <DescriptionView
          body=""
          groupId={item.groupId}
          linked={item.linkedKnowledge!}
          subject={{ kind: 'knowledge', id: item.id }}
          nameOf={nameOf}
        />
      )}

      {item.type === 'chat_file' && (
        <>
          <Attachments files={item.files} />
          {item.chat && (
            <div className="flex flex-col items-start gap-3">
              <p className="flex text-tiny text-muted-foreground">
                <ChatSourceLabel chat={item.chat} />
              </p>
              <Button asChild variant="outline">
                <Link {...chatSourceLocation(item.groupId, item.chat)}>
                  {t('knowledge.chat.show')}
                </Link>
              </Button>
            </div>
          )}
        </>
      )}

      {item.type === 'link' && (
        <>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-1.5 break-all text-body font-semibold underline underline-offset-4"
            >
              <span className="sr-only">{t('knowledge.detail.openLink')}: </span>
              {item.url}
              <span className="mt-1.5">
                <ArrowOutIcon />
              </span>
            </a>
          )}
          <Body body={item.body} nameOf={nameOf} />
        </>
      )}

      {item.type === 'meeting' && item.meetingDetail && (
        <>
          <MeetingWhen meeting={item.meetingDetail} />
          <Body body={item.body} nameOf={nameOf} />
          {isAdmin && (
            <Suspense fallback={null}>
              <TeamsSection item={item} onChanged={onChanged} />
            </Suspense>
          )}
          <RecordingSection item={item} onChanged={onChanged} />
          <SummarySection item={item} onChanged={onChanged} />
          <TranscriptSection item={item} onChanged={onChanged} />
          {item.reminder && item.reminder.times.length > 0 && (
            <div className="border-t-2 border-border pt-4">
              <ReminderPanel
                prefix="/knowledge"
                subjectId={item.id}
                set={item.reminder}
                authorId={item.createdBy.id}
                onChanged={onChanged}
              />
            </div>
          )}
        </>
      )}

      {item.type === 'reminder' && (
        <>
          <Body body={item.body} nameOf={nameOf} />
          {item.reminder && (
            <div className="border-t-2 border-border pt-4">
              <ReminderPanel
                prefix="/knowledge"
                subjectId={item.id}
                set={item.reminder}
                authorId={item.createdBy.id}
                onChanged={onChanged}
              />
            </div>
          )}
        </>
      )}
    </article>
  );
});
