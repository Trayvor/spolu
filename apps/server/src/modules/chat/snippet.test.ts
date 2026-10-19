import { describe, expect, it } from 'vitest';
import { messageSnippet, plainMessageText } from './snippet.js';

const none = () => undefined;

describe('plainMessageText', () => {
  it('mentions as names, @all, unknown as @?', () => {
    expect(
      plainMessageText('Ahoj <@u1>, <@all> a <@u2>', (id) => (id === 'u1' ? 'Peter' : undefined)),
    ).toBe('Ahoj @Peter, @all a @?');
  });

  it('drops emphasis, heading and quote markers; keeps words with underscores', () => {
    expect(
      plainMessageText(
        '# Nadpis\n> citát\n__tučné__ ~~preč~~ `kód` *kurzíva* _iné_ budget_2026_final',
        none,
      ),
    ).toBe('Nadpis citát tučné preč kód kurzíva iné budget_2026_final');
  });
});

describe('messageSnippet', () => {
  it('plain text: mentions as names, markdown markers out, links kept', () => {
    const s = messageSnippet('**Ahoj** <@u1>, pozri [výzvu](https://x.sk/v)', () => 'Peter', [
      'vyzvu',
    ]);
    expect(s.snippet).toBe('Ahoj @Peter, pozri výzvu (https://x.sk/v)');
    expect(s.highlights).toEqual([[19, 24]]);
  });

  it('windows around the first match with ellipses', () => {
    const body = `${'slovo '.repeat(60)}zmluva ${'koniec '.repeat(60)}`;
    const s = messageSnippet(body, none, ['zmluva']);
    expect(s.snippet.startsWith('…')).toBe(true);
    expect(s.snippet.endsWith('…')).toBe(true);
    expect(s.snippet.length).toBeLessThanOrEqual(162);
    // The window starts at a word.
    expect(s.snippet.slice(1, 7)).toBe('slovo ');
    const [[a, b]] = s.highlights as [[number, number]];
    expect(s.snippet.slice(a, b)).toBe('zmluva');
  });

  it('a match near the end keeps the window full', () => {
    const body = `${'slovo '.repeat(60)}zmluva`;
    const s = messageSnippet(body, none, ['zmluva']);
    expect(s.snippet.startsWith('…')).toBe(true);
    expect(s.snippet.endsWith('zmluva')).toBe(true);
    expect(s.snippet.length).toBeGreaterThan(140);
    const [[a, b]] = s.highlights as [[number, number]];
    expect(s.snippet.slice(a, b)).toBe('zmluva');
  });

  it('clips highlights to the window', () => {
    const body = `zmluva ${'slovo '.repeat(60)}zmluva`;
    const s = messageSnippet(body, none, ['zmluva']);
    expect(s.snippet.startsWith('zmluva')).toBe(true);
    expect(s.highlights).toEqual([[0, 6]]);
  });

  it('no match in the text (it came from a URL cut away or a mention): the start, no highlights', () => {
    expect(messageSnippet('Krátka správa', none, ['xyz'])).toEqual({
      snippet: 'Krátka správa',
      highlights: [],
    });
  });

  it('highlights a folded match in the original characters', () => {
    const s = messageSnippet('Obec Lúky posiela ŽIADOSŤ', none, ['luky', 'ziadost']);
    expect(s.highlights.map(([a, b]) => s.snippet.slice(a, b))).toEqual(['Lúky', 'ŽIADOSŤ']);
  });
});
