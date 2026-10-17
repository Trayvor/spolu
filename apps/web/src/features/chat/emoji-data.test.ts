import { describe, expect, it } from 'vitest';
import { EmojiSchema, QUICK_REACTIONS } from '@spolu/shared';
import { EMOJI_GROUPS } from './emoji-data';

describe('the reaction picker emoji', () => {
  const all = EMOJI_GROUPS.flatMap((g) => g.emoji);

  it('every one is a single emoji the server takes, and none repeats', () => {
    for (const emoji of [...all, ...QUICK_REACTIONS]) {
      expect(EmojiSchema.safeParse(emoji).success, emoji).toBe(true);
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it('holds the quick row too', () => {
    for (const emoji of QUICK_REACTIONS) expect(all).toContain(emoji);
  });
});
