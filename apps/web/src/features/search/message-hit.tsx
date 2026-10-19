import type { ReactNode } from 'react';

/**
 * A message hit's snippet with its matched fragments marked (2026-10-19): text nodes and
 * `<mark>` elements only, never HTML from the server (the enforced CSP, ADR 0044). The mark is
 * the secondary pill colour with semibold text; on the selected row (itself `bg-secondary`) it
 * turns to the card colour so it stays visible.
 */
export function Highlighted({
  text,
  highlights,
}: {
  text: string;
  highlights: readonly (readonly [number, number])[];
}) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of highlights) {
    if (start < at || end <= start || end > text.length) continue;
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark
        key={start}
        className="rounded-sm bg-secondary font-semibold text-inherit group-aria-selected:bg-card"
      >
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
