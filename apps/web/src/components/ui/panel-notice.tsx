import type { ReactNode } from 'react';

/** An inline bar above the form: a question or a warning with its actions. */
export function PanelNotice({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary p-3">
      <p className="mr-auto text-button font-semibold">{text}</p>
      {children}
    </div>
  );
}
