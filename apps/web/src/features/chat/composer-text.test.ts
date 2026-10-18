import { describe, expect, it } from 'vitest';
import source from './composer-text.ts?raw';
import { mentionQueryAt, toStored } from './composer-text';

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
