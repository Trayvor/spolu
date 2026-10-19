import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { WeeklySummarySections, type WeeklySummaryContent } from '@spolu/shared';

/**
 * A report as the client got (or would get) it: the intro, the non-empty sections and the
 * closing, as text. `mark` wraps the matches of a search in `<mark>` (escaped text only).
 */
export function ContentView({
  content,
  mark,
}: {
  content: WeeklySummaryContent;
  mark?: (text: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const show = mark ?? ((text: string) => text);
  return (
    <div className="flex flex-col gap-3 text-button">
      {content.intro.trim() !== '' && <p className="whitespace-pre-line">{show(content.intro)}</p>}
      {WeeklySummarySections.filter((s) => content[s].length > 0).map((s) => (
        <section key={s} className="flex flex-col gap-1">
          <h3 className="font-semibold">{t(`weeklySummary.sections.${s}`)}</h3>
          <ul className="list-disc pl-5">
            {content[s].map((item) => (
              <li key={item.id}>{show(item.text)}</li>
            ))}
          </ul>
        </section>
      ))}
      {content.closing.trim() !== '' && (
        <p className="whitespace-pre-line">{show(content.closing)}</p>
      )}
    </div>
  );
}

/** `text` with every case- and accent-insensitive match of `q` wrapped in `<mark>`. */
export function highlight(text: string, q: string): ReactNode {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const needle = fold(q.trim());
  if (needle.length < 2) return text;
  // Folding keeps one character per character of the precomposed text, so indexes line up.
  const chars = Array.from(text.normalize('NFC'));
  const folded = chars.map((c) => fold(c));
  const out: ReactNode[] = [];
  let i = 0;
  let plain = '';
  while (i < chars.length) {
    let j = i;
    let k = 0;
    let acc = '';
    while (j < chars.length && acc.length < needle.length) {
      acc += folded[j];
      j++;
      k++;
    }
    if (acc === needle) {
      if (plain) out.push(plain);
      plain = '';
      out.push(<mark key={i}>{chars.slice(i, i + k).join('')}</mark>);
      i = j;
    } else {
      plain += chars[i];
      i++;
    }
  }
  if (plain) out.push(plain);
  return out;
}
