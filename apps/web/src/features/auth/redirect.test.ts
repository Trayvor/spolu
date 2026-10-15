import { describe, expect, it } from 'vitest';
import { safeRedirect } from './redirect';

describe('safeRedirect', () => {
  it('keeps a same-site path with its query', () => {
    expect(safeRedirect('/admins?x=1')).toBe('/admins?x=1');
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'admins',
    '',
    undefined,
    42,
    null,
  ])('returns / for %j', (value) => {
    expect(safeRedirect(value)).toBe('/');
  });
});
