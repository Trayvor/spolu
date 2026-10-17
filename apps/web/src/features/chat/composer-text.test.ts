import { describe, expect, it } from 'vitest';
import source from './composer-text.ts?raw';
import { applyFormat, mentionQueryAt, toStored, type FormatKind } from './composer-text';

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

  it('list and quote leave a caret, not a selection', () => {
    expect(applyFormat('', 0, 0, 'bulletList')).toEqual({ value: '- ', start: 2, end: 2 });
    expect(applyFormat('buy milk', 4, 4, 'quote')).toEqual({
      value: '> buy milk',
      start: 6,
      end: 6,
    });
    const multi = applyFormat('a\nb', 0, 3, 'bulletList');
    expect(multi).toEqual({ value: '- a\n- b', start: 7, end: 7 });
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

describe('toStored (typed mentions on send)', () => {
  const picked = [{ id: 'b', name: 'Jana' }];

  it('turns a typed @all into the token, at the start, after a newline and before punctuation', () => {
    expect(toStored('@all hotovo', [], '@all')).toBe('<@all> hotovo');
    expect(toStored('hi\n@all, ok', [], '@all')).toBe('hi\n<@all>, ok');
  });

  it('leaves @all inside a word, an email, code spans and fences alone', () => {
    expect(toStored('x@all @allow `@all`\n```\n@all\n```', [], '@all')).toBe(
      'x@all @allow `@all`\n```\n@all\n```',
    );
  });

  it('turns a typed @Name of a person picked in the draft into their token, others stay text', () => {
    expect(toStored('<@b> and again @Jana, not @Tom', picked, '@all')).toBe(
      '<@b> and again <@b>, not @Tom',
    );
  });

  it('prefers the longest name and keeps existing tokens as they are', () => {
    const two = [
      { id: 'b', name: 'Jana' },
      { id: 'a', name: 'Jana Nováková' },
    ];
    expect(toStored('@Jana Nováková @Jana <@all> <@a>', two, '@all')).toBe('<@a> <@b> <@all> <@a>');
  });

  it('tells people with the same name apart by pick order', () => {
    const same = [
      { id: 'a', name: 'Jana Nováková' },
      { id: 'c', name: 'Jana Nováková' },
    ];
    expect(toStored('@Jana Nováková and @Jana Nováková', same, '@all')).toBe('<@a> and <@c>');
  });

  it('uses the label of the language', () => {
    expect(toStored('@všetci ok', [], '@všetci')).toBe('<@all> ok');
  });
});

describe('composer-text', () => {
  it('uses no regex lookbehind (Safari before 16.4 throws a SyntaxError on it)', () => {
    expect(source).not.toContain('(?<');
  });
});
