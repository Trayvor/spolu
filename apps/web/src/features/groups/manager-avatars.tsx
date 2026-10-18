import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'radix-ui';
import type { GroupManager } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { cn } from '@/lib/utils';

const MAX_AVATARS = 3;
/** Phones (under 641px) have room for one avatar less on the row's second line. */
const MAX_AVATARS_PHONE = 2;

/**
 * Up to 3 overlapping 24px avatars of a group's managers (2 on phones), then "+N", on a button
 * that shows every manager's name in a small tooltip: on hover and keyboard focus, toggled by a
 * click or a tap (touch has no hover), closed by Escape or a tap elsewhere. The avatars and the
 * bubble are decorative; screen readers get the names in a visually hidden list and as the
 * button's description. Nothing when empty.
 */
export function ManagerAvatars({
  managers,
  groupName,
}: {
  managers: GroupManager[];
  groupName: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  /** A pointer press is under way: its focus must not open the bubble before the click toggles it. */
  const pressing = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (managers.length === 0) return null;
  const shown = managers.slice(0, MAX_AVATARS);
  const extra = managers.length - shown.length;
  const extraPhone = Math.max(managers.length - MAX_AVATARS_PHONE, 0);
  const label = t('groups.managers.listLabel', { name: groupName });

  return (
    <>
      <Tooltip.Provider delayDuration={0} skipDelayDuration={0} disableHoverableContent>
        <Tooltip.Root open={open} onOpenChange={setOpen}>
          <Tooltip.Trigger asChild>
            <button
              ref={trigger}
              type="button"
              data-manager-avatars=""
              aria-label={label}
              className="relative flex shrink-0 items-center rounded-full before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-['']"
              // Radix closes the bubble on press and on click; here a press does nothing and the
              // click toggles, so a tap opens it and a second tap closes it.
              onPointerDown={(event) => {
                pressing.current = true;
                event.preventDefault();
              }}
              onFocus={(event) => {
                if (pressing.current) event.preventDefault();
              }}
              onBlur={() => {
                pressing.current = false;
              }}
              onClick={(event) => {
                pressing.current = false;
                event.preventDefault();
                setOpen((was) => !was);
              }}
              // A finger "leaves" as soon as it lifts: keep the bubble a tap opened.
              onPointerLeave={(event) => {
                if (event.pointerType === 'touch') event.preventDefault();
              }}
            >
              <span aria-hidden="true" className="flex items-center">
                {shown.map((manager, index) => (
                  <Avatar
                    key={manager.id}
                    userId={manager.id}
                    name={manager.name}
                    size={24}
                    className={cn(
                      '-ml-1.5 border-2 border-card first:ml-0',
                      index >= MAX_AVATARS_PHONE && 'max-[640px]:hidden',
                    )}
                  />
                ))}
              </span>
              {extraPhone > 0 && (
                <span
                  aria-hidden="true"
                  className="ml-1 text-micro font-semibold text-muted-foreground min-[641px]:hidden"
                >
                  {t('groups.managers.more', { count: extraPhone })}
                </span>
              )}
              {extra > 0 && (
                <span
                  aria-hidden="true"
                  className="ml-1 text-micro font-semibold text-muted-foreground max-[640px]:hidden"
                >
                  {t('groups.managers.more', { count: extra })}
                </span>
              )}
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="top"
              sideOffset={6}
              collisionPadding={8}
              // A press on the trigger is its own toggle, not a press outside.
              onPointerDownOutside={(event) => {
                if (trigger.current?.contains(event.target as Node)) event.preventDefault();
              }}
              // Radix's hidden description copy: the names as one sentence, not a second list.
              aria-label={managers.map((m) => m.name).join(', ')}
              className="z-50 max-w-[240px] origin-(--radix-tooltip-content-transform-origin) animate-fade-in rounded-lg bg-primary px-3 py-2 text-micro text-primary-foreground shadow-lift"
            >
              <ul role="list" data-manager-tooltip="" aria-hidden="true">
                {managers.map((manager) => (
                  <li key={manager.id} className="truncate">
                    {manager.name}
                  </li>
                ))}
              </ul>
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
      <ul role="list" aria-label={label} className="sr-only">
        {managers.map((manager) => (
          <li key={manager.id}>{manager.name}</li>
        ))}
      </ul>
    </>
  );
}
