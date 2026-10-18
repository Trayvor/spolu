import { EmojiSchema } from '@spolu/shared';

/**
 * The picker's "Frequently used" row (owner request 2026-10-18): how often each emoji was picked,
 * kept per browser in `localStorage` as `[emoji, count]` pairs, the latest pick first. Only the
 * 40 latest emoji are kept. Blocked or broken storage degrades silently: no row.
 */
const KEY = 'spolu.emojiUsage';
const KEPT = 40;
export const FREQUENT_SHOWN = 16;

type Usage = [emoji: string, count: number][];

function readUsage(): Usage {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is [string, number] =>
        Array.isArray(entry) &&
        EmojiSchema.safeParse(entry[0]).success &&
        typeof entry[1] === 'number' &&
        entry[1] > 0,
    );
  } catch {
    return [];
  }
}

/** The most used emoji first; among equals the latest pick first. */
export function frequentEmoji(limit = FREQUENT_SHOWN): string[] {
  return readUsage()
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([emoji]) => emoji);
}

export function recordEmojiUse(emoji: string): void {
  const usage = readUsage();
  const count = usage.find(([e]) => e === emoji)?.[1] ?? 0;
  const next: Usage = [[emoji, count + 1], ...usage.filter(([e]) => e !== emoji)];
  try {
    localStorage.setItem(KEY, JSON.stringify(next.slice(0, KEPT)));
  } catch {
    // Not remembering is fine.
  }
}
