/**
 * Classes of the formatted message parts, shared by the message renderer (`render.tsx`) and the
 * composer's editor (`editor/schema.ts`), so a draft looks like the message it becomes.
 */
export const pillClass = 'rounded-sm bg-secondary px-1 font-semibold text-secondary-foreground';
export const codeClass = 'rounded-sm bg-muted px-1 font-mono text-[0.875em]';
export const linkClass = 'underline decoration-1 underline-offset-2';
export const codeBlockClass =
  'overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-[0.875em] leading-snug [overflow-wrap:normal]';
export const quoteClass = 'flex flex-col gap-1.5 border-l-2 border-surface-3 pl-3';
export const bulletListClass = 'list-disc pl-5';
export const orderedListClass = 'list-decimal pl-6';
export const headingClass = {
  1: 'text-[1.125rem] font-semibold leading-snug',
  2: 'text-body font-semibold leading-snug',
  3: 'text-body font-semibold leading-snug text-muted-foreground',
} as const;
