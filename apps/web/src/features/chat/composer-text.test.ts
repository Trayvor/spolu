import { describe, expect, it } from 'vitest';
import {
  applyFormat,
  mentionQueryAt,
  toEditable,
  toStored,
  type FormatKind,
} from './composer-text';

describe('applyFormat', () => {
  const wraps: [FormatKind, string][] = [
    ['bold', '**'],
    ['italic', '_'],
    ['strike', '~~'],
    ['code', '`'],
  ];
  it.each(wraps)('%s wraps a selection and inserts empty marks at the caret', (kind, mark) => {
    const wrapped = applyFormat('say hi now', 4, 6, kind);
    expect(wrapped).toEqual({
      value: `say ${mark}hi${mark} now`,
      start: 4 + mark.length,
      end: 6 + mark.length,
    });
    const empty = applyFormat('ab', 1, 1, kind);
    expect(empty).toEqual({
      value: `a${mark}${mark}b`,
      start: 1 + mark.length,
      end: 1 + mark.length,
    });
  });

  it('link wraps the selection and selects the url', () => {
    const r = applyFormat('see docs', 4, 8, 'link');
    expect(r.value).toBe('see [docs](https://)');
    expect(r.value.slice(r.start, r.end)).toBe('https://');
  });

  it('bullet list and quote prefix each selected line, only those lines', () => {
    expect(applyFormat('a\nb\nc', 2, 5, 'bulletList').value).toBe('a\n- b\n- c');
    expect(applyFormat('a\nb', 0, 0, 'quote').value).toBe('> a\nb');
  });

  it('numberedList numbers each selected line', () => {
    expect(applyFormat('x\na\nb\nc', 2, 7, 'numberedList').value).toBe('x\n1. a\n2. b\n3. c');
  });
});

describe('mentionQueryAt', () => {
  it('finds @ja after a space and not inside an email', () => {
    expect(mentionQueryAt('hi @ja', 6)).toEqual({ start: 3, query: 'ja' });
    expect(mentionQueryAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQueryAt('mail me@ja', 10)).toBeNull();
    expect(mentionQueryAt('hi @ja there', 12)).toBeNull();
  });
});

describe('toStored / toEditable', () => {
  const nameOf = (id: string) => ({ a: 'Jana Nováková', b: 'Jana', c: 'Jana Nováková' })[id];
  it('round-trips names and @all', () => {
    const stored = 'hi <@a> and <@b>, <@all>';
    const { text, picked } = toEditable(stored, nameOf, '@all');
    expect(text).toBe('hi @Jana Nováková and @Jana, @all');
    expect(toStored(text, picked, '@all')).toBe(stored);
  });

  it('tells people with the same name apart by pick order', () => {
    const text = '@Jana Nováková and @Jana Nováková';
    const picked = [
      { id: 'a', name: 'Jana Nováková' },
      { id: 'c', name: 'Jana Nováková' },
    ];
    expect(toStored(text, picked, '@all')).toBe('<@a> and <@c>');
  });

  it('leaves unpicked names, code and email addresses alone', () => {
    const picked = [{ id: 'b', name: 'Jana' }];
    expect(toStored('@Jana `@Jana` x@Jana @Janas @Tom', picked, '@all')).toBe(
      '<@b> `@Jana` x@Jana @Janas @Tom',
    );
  });

  it('keeps a token whose person is unknown', () => {
    expect(toEditable('<@gone>', () => undefined, '@all')).toEqual({ text: '<@gone>', picked: [] });
  });
});
