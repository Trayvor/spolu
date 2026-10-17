import { describe, expect, it } from 'vitest';
import type { BulkTextNode } from '@spolu/shared';
import { nodesToText, textToNodes } from './rich-text-ai';

const nodes: BulkTextNode[] = [
  { type: 'h2', content: [{ text: 'News' }] },
  {
    type: 'paragraph',
    content: [
      { text: 'Read ' },
      { text: 'this', marks: ['bold'] },
      { text: ' on ' },
      { text: 'our site', href: 'https://egrant.sk' },
    ],
  },
  { type: 'bullet', content: [{ text: 'one' }] },
  { type: 'bullet', content: [{ text: 'two' }] },
  { type: 'ordered', content: [{ text: 'first' }] },
  { type: 'ordered', content: [{ text: 'second' }] },
];
const text = [
  '## News',
  '',
  'Read **this** on [our site](https://egrant.sk)',
  '',
  '- one',
  '- two',
  '',
  '1. first',
  '2. second',
].join('\n');

describe('bulk email text and AI text', () => {
  it('writes headings, bold, links and lists as Markdown-like lines', () => {
    expect(nodesToText(nodes)).toBe(text);
  });

  it('reads them back into the same tree', () => {
    expect(textToNodes(text)).toEqual(nodes);
  });

  it('keeps a link the email may not hold as plain text', () => {
    expect(textToNodes('[x](javascript:alert(1))')).toEqual([
      { type: 'paragraph', content: [{ text: '[x](javascript:alert(1))' }] },
    ]);
  });

  it('ignores blank lines and understands "* " and "1)" markers', () => {
    expect(textToNodes('\n* a\n\n1) b\n')).toEqual([
      { type: 'bullet', content: [{ text: 'a' }] },
      { type: 'ordered', content: [{ text: 'b' }] },
    ]);
  });
});
