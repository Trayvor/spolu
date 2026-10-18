/**
 * The one look of every floating panel (docs/design/tokens.md, "Popover"): dropdown menus,
 * listboxes (mention picker, people select), the client filter, toasts and error bubbles. The
 * egrant.sk language dropdown: the base colour, a 16px radius and the lift shadow, no border.
 * A plain string, not `cn`, so eager callers do not pull tailwind-merge.
 */
export const POPOVER = 'rounded-xl bg-popover text-popover-foreground shadow-lift';
