import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'radix-ui';
import type { UnseenMark } from '@spolu/shared';
import { todayInBratislava } from '@/features/tasks/dates';
import { cn } from '@/lib/utils';
import { unseenSummaryQuery, type UnseenTarget } from './api';
import { unseenSummaryTexts } from './lines';

/** A finger held this long on the marker opens its tooltip (touch has no hover). */
export const LONG_PRESS_MS = 450;

/**
 * The picture of a mark (2026-10-18): a plain yellow dot for a change, a yellow ring with a dot
 * inside for a message in the item's chat. Both carry a faint ink edge, so the yellow stays
 * visible on white.
 */
export function UnseenGlyph({ mark, className }: { mark: UnseenMark; className?: string }) {
  if (mark === 'message') {
    return (
      <span
        aria-hidden="true"
        data-testid="unseen-ring"
        className={cn(
          'grid size-3.5 shrink-0 place-items-center rounded-full border-2 border-attention ring-1 ring-attention-foreground/15',
          className,
        )}
      >
        <span className="size-1.5 rounded-full bg-attention" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      data-testid="unseen-dot"
      className={cn(
        'size-2.5 shrink-0 rounded-full bg-attention ring-1 ring-attention-foreground/15',
        className,
      )}
    />
  );
}

/**
 * The mark of a task or ticket with a change the viewer has not seen yet (2026-10-18): a
 * focusable 24 px button (a sibling of the row's link, never inside it) with the glyph, named
 * "Nová zmena" or "Nová správa". Hover, keyboard focus, a click or tap, or a long press shows a
 * tooltip with what changed since the viewer last opened it, fetched on first open
 * (`GET /api/tasks/:id/unseen-summary`) and given to the button as its description. Escape or
 * a tap elsewhere closes it. Nothing when `mark` is null. Needs the `unseen` namespace.
 */
export function UnseenMarker({
  mark,
  ...rest
}: {
  mark: UnseenMark | null;
  target: UnseenTarget;
  className?: string;
}) {
  return mark ? <Marker mark={mark} {...rest} /> : null;
}

function Marker({
  mark,
  target,
  className,
}: {
  mark: UnseenMark;
  target: UnseenTarget;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  /** A pointer press is under way: its focus must not open the bubble before the click toggles it. */
  const pressing = useRef(false);
  const longPress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** A long press opened the bubble: the click that ends it must not close it again. */
  const heldOpen = useRef(false);
  const summary = useQuery({ ...unseenSummaryQuery(target), enabled: open });
  useEffect(() => () => clearTimeout(longPress.current), []);

  const texts = summary.data
    ? unseenSummaryTexts(t, summary.data, i18n.language, todayInBratislava())
    : null;

  return (
    <Tooltip.Provider delayDuration={150} skipDelayDuration={0} disableHoverableContent>
      <Tooltip.Root open={open} onOpenChange={setOpen}>
        <Tooltip.Trigger asChild>
          <button
            ref={trigger}
            type="button"
            data-unseen-marker={mark}
            aria-label={t(`unseen.mark.${mark}`)}
            className={cn(
              'grid size-6 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
              className,
            )}
            // Radix closes the bubble on press and on click; here a press does nothing and the
            // click toggles, so a tap opens it and a second tap closes it.
            onPointerDown={(event) => {
              pressing.current = true;
              event.preventDefault();
              if (event.pointerType === 'touch') {
                clearTimeout(longPress.current);
                longPress.current = setTimeout(() => {
                  heldOpen.current = true;
                  setOpen(true);
                }, LONG_PRESS_MS);
              }
            }}
            onPointerUp={() => clearTimeout(longPress.current)}
            onPointerCancel={() => clearTimeout(longPress.current)}
            onFocus={(event) => {
              if (pressing.current) event.preventDefault();
            }}
            onBlur={() => {
              pressing.current = false;
            }}
            onClick={(event) => {
              pressing.current = false;
              event.preventDefault();
              if (heldOpen.current) {
                heldOpen.current = false;
                return;
              }
              setOpen((was) => !was);
            }}
            // A long press must not open the browser's menu.
            onContextMenu={(event) => event.preventDefault()}
            // A finger "leaves" as soon as it lifts: keep the bubble a tap opened.
            onPointerLeave={(event) => {
              if (event.pointerType === 'touch') event.preventDefault();
            }}
          >
            <UnseenGlyph mark={mark} />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            align="start"
            sideOffset={4}
            collisionPadding={8}
            // A press on the trigger is its own toggle, not a press outside.
            onPointerDownOutside={(event) => {
              if (trigger.current?.contains(event.target as Node)) event.preventDefault();
            }}
            data-unseen-tooltip=""
            className="z-50 max-w-[280px] origin-(--radix-tooltip-content-transform-origin) animate-fade-in rounded-lg bg-primary px-3 py-2 text-micro text-primary-foreground shadow-lift"
          >
            <p className="font-semibold">{t('unseen.heading')}</p>
            {summary.isError ? (
              <p>{t('unseen.error')}</p>
            ) : !texts ? (
              <p>{t('unseen.loading')}</p>
            ) : texts.length === 0 ? (
              <p>{t('unseen.empty')}</p>
            ) : (
              <ul role="list">
                {texts.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            )}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
