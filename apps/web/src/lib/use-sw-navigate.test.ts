import { expect, it } from 'vitest';
import { sameOriginPath } from './use-sw-navigate';

it('sameOriginPath keeps same-origin paths and rejects everything else', () => {
  expect(sameOriginPath('/groups/g1?x=1#y')).toBe('/groups/g1?x=1#y');
  for (const bad of [
    '//evil.test',
    '/\t/evil.test',
    'https://evil.test',
    'javascript:alert(1)',
    42,
  ]) {
    expect(sameOriginPath(bad), String(bad)).toBeNull();
  }
});
