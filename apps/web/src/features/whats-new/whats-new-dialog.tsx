import { useId, useRef, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { Announcement, AnnouncementSectionId } from '@spolu/shared';
import { CloseIcon, Icon, SparkleIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';

type SectionLink = { to: '/settings' | '/bulk-email' | '/finance'; hash?: string };

/** Each section's icon and the screen it opens (none: the board is wherever the person works). */
const SECTIONS: Record<AnnouncementSectionId, { icon: ReactNode; link?: SectionLink }> = {
  taskSplit: { icon: <SparkleIcon /> },
  snippets: {
    // A chat bubble with a slash: typed in the composer.
    icon: (
      <Icon>
        <path d="M4 5h16v11H9l-5 4z" />
        <path d="m13.5 7.5-3 6" />
      </Icon>
    ),
    link: { to: '/settings', hash: 'snippets' },
  },
  bulkEmail: {
    icon: (
      <Icon>
        <path d="M3 6h18v12H3zM3 7l9 6 9-6" />
      </Icon>
    ),
    link: { to: '/bulk-email' },
  },
  finance: {
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="9" />
        <path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.1 0-2-.4-2.5-1.2M12 6.5V8m0 8v1.5" />
      </Icon>
    ),
    link: { to: '/finance' },
  },
};

/**
 * "What's new" (Novinky): the update's sections the server chose for this person, each with
 * its icon, title, one or two sentences and the screen it opens. ×, Escape, Back, "Got it", a
 * click outside and a section's link all close it (`onClose` marks it seen). The texts are in the
 * `whatsNew` namespace under the announcement's id.
 */
export function WhatsNewDialog({
  announcement,
  onClose,
}: {
  announcement: Announcement;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const gotIt = useRef<HTMLButtonElement>(null);
  const key = (rest: string) => `whatsNew.${announcement.id}.${rest}`;
  const sections = announcement.sections.filter((id) => id in SECTIONS);

  return (
    <SheetDialog
      compact
      onEscape={onClose}
      onOutside={onClose}
      labelledBy={titleId}
      initialFocus={gotIt}
      testId="whats-new"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3 px-5 pt-5 min-[641px]:px-6">
          <div className="flex min-w-0 flex-col gap-1">
            <SheetDialogTitle asChild>
              <h2 id={titleId} className="text-medium leading-tight font-semibold">
                {t('whatsNew.title')}
              </h2>
            </SheetDialogTitle>
            <p className="text-button text-muted-foreground">{t(key('intro'))}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('whatsNew.close')}
            onClick={onClose}
            className="-mt-1 -mr-2"
          >
            <CloseIcon />
          </Button>
        </div>

        <ul
          role="list"
          className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5 min-[641px]:px-6"
        >
          {sections.map((id) => {
            const { icon, link } = SECTIONS[id];
            return (
              <li key={id} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground"
                >
                  {icon}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="text-button font-semibold">{t(key(`${id}.title`))}</h3>
                  <p className="text-button text-muted-foreground">{t(key(`${id}.body`))}</p>
                  {link && (
                    <Link
                      to={link.to}
                      hash={link.hash}
                      // The sheet has a history entry of its own: the screen replaces it.
                      replace
                      onClick={onClose}
                      className="self-start text-button font-semibold underline underline-offset-4 hover:text-neutral"
                    >
                      {t(key(`${id}.link`))}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex justify-end border-t border-border px-5 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] min-[641px]:px-6">
          <Button ref={gotIt} type="button" onClick={onClose} className="max-[640px]:w-full">
            {t('whatsNew.gotIt')}
          </Button>
        </div>
      </div>
    </SheetDialog>
  );
}
