import * as React from 'react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

/*
 * shadcn/ui dropdown menu (Radix), trimmed to the egrant language dropdown
 * (docs/design/tokens.md): `bg-popover` panel with `shadow-lift`, `rounded-xl`, 8px padding;
 * `rounded-lg` items with an `accent` hover; no open/close animation. Sub-menus and shortcuts are
 * left out until a screen needs them.
 */

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const itemClasses =
  'relative flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2.5 text-button font-medium outline-hidden select-none transition-colors duration-(--duration-fast) focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

function DropdownMenuContent({
  className,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 flex max-h-(--radix-dropdown-menu-content-available-height) min-w-[190px] flex-col gap-0.5 overflow-y-auto rounded-xl bg-popover p-2 text-popover-foreground shadow-lift',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  variant?: 'default' | 'destructive';
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      // Destructive items use the error text color; `destructive` is for fills only.
      className={cn(itemClasses, 'data-[variant=destructive]:text-error-ink', className)}
      {...props}
    />
  );
}

/** A radio item in the egrant style: label first, a check mark on the right when chosen. */
function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(itemClasses, 'data-[state=checked]:font-semibold', className)}
      {...props}
    >
      <span className="flex-1">{children}</span>
      <DropdownMenuPrimitive.ItemIndicator className="shrink-0">
        <CheckIcon />
      </DropdownMenuPrimitive.ItemIndicator>
    </DropdownMenuPrimitive.RadioItem>
  );
}

/**
 * A checkbox item, drawn like the radio item (label, then the check mark when ticked). It keeps
 * the menu open, so several can be ticked in a row.
 */
function DropdownMenuCheckboxItem({
  className,
  children,
  onSelect,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(itemClasses, 'data-[state=checked]:font-semibold', className)}
      onSelect={(event) => {
        event.preventDefault();
        onSelect?.(event);
      }}
      {...props}
    >
      <span className="flex-1">{children}</span>
      <DropdownMenuPrimitive.ItemIndicator className="shrink-0">
        <CheckIcon />
      </DropdownMenuPrimitive.ItemIndicator>
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn('px-3 py-2 text-micro font-semibold text-muted-foreground', className)}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-2 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

// The 16px check mark from the egrant.sk language dropdown.
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.33 8.53 6.1 11.33l6.57-6.66" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
};
