import { describe, expect, it } from 'vitest';
import { isSavedViewUrl } from './saved-views.js';
import { fillSnippet } from './snippets.js';

describe('fillSnippet (F7)', () => {
  it('puts the name in every {{name}}, spaces inside the braces allowed', () => {
    expect(fillSnippet('Ahoj {{name}}, {{ name }}!', 'Jana')).toBe('Ahoj Jana, Jana!');
  });
  it('keeps the placeholder without a name', () => {
    expect(fillSnippet('Ahoj {{name}}', null)).toBe('Ahoj {{name}}');
    expect(fillSnippet('Ahoj {{name}}', '  ')).toBe('Ahoj {{name}}');
  });
});

describe('isSavedViewUrl (F5)', () => {
  it.each([
    ['/tasks?mine=1', true],
    ['/tasks?clients=a%2Cb&q=%22x%22', true],
    ['/tasks', false],
    ['/tasks?', false],
    ['/tasks/1?x=1', false],
    ['/taskss?x=1', false],
    ['https://x.example/tasks?x=1', false],
    ['/tasks?x=1#frag', false],
    ['/tasks?x=1 2', false],
  ])('%s -> %s', (url, expected) => {
    expect(isSavedViewUrl('board', url)).toBe(expected);
  });
});
