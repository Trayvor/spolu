import { beforeEach, describe, expect, it } from 'vitest';
import { frequentEmoji, recordEmojiUse } from './emoji-usage';

describe('frequently used emoji', () => {
  beforeEach(() => localStorage.clear());

  it('is empty before the first pick', () => {
    expect(frequentEmoji()).toEqual([]);
  });

  it('lists the most used first, the latest first among equals', () => {
    for (const emoji of ['👍', '🌻', '👍', '🎉', '🌷']) recordEmojiUse(emoji);
    expect(frequentEmoji()).toEqual(['👍', '🌷', '🎉', '🌻']);
  });

  it('shows at most the limit', () => {
    for (const emoji of ['😀', '😃', '😄', '😁']) recordEmojiUse(emoji);
    expect(frequentEmoji(2)).toEqual(['😁', '😄']);
  });

  it('ignores broken storage and anything that is not an emoji', () => {
    localStorage.setItem('spolu.emojiUsage', '{oops');
    expect(frequentEmoji()).toEqual([]);
    localStorage.setItem(
      'spolu.emojiUsage',
      JSON.stringify([
        ['abc', 3],
        ['🌹', 'x'],
        ['🌹', 2],
      ]),
    );
    expect(frequentEmoji()).toEqual(['🌹']);
  });
});
