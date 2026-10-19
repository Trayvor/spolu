/** Help shows every time in Bratislava (spec §4.2). */
export const ZONE = 'Europe/Bratislava';

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(lang: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(lang, { timeZone: ZONE, ...options });
    cache.set(key, f);
  }
  return f;
}

/** The day heading: "19. októbra 2026" in the viewer's language. */
export const dayHeading = (iso: string, lang: string) =>
  fmt(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

/** `YYYY-MM-DD` of the instant in Bratislava: the grouping key. */
export const dayKey = (iso: string) => fmt('sv-SE', {}).format(new Date(iso));

export const timeOf = (iso: string, lang: string) =>
  fmt(lang, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export const exactTime = (iso: string, lang: string) =>
  fmt(lang, { dateStyle: 'long', timeStyle: 'medium' }).format(new Date(iso));

/** A stored value as text: a day, an instant, or the value itself. */
export function formatScalar(value: string, lang: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${value}T00:00:00Z`),
    );
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value))) {
    return fmt(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }
  return value;
}
