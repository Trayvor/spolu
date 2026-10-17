import { lazyLanguageChunk, lazyLanguageGlobs, lazyLanguages } from './pwa-precache';

describe('service worker precache of the languages', () => {
  it('leaves out every language except the eager sk and en', () => {
    expect(lazyLanguages).toEqual(['cs', 'bg', 'et', 'hr', 'it', 'sl', 'uk']);
    expect(lazyLanguageGlobs).toContain('assets/uk-*.js');
  });

  it('caches the lazy languages chunks at run time, and nothing else', () => {
    expect(lazyLanguageChunk.test('/assets/cs-B_x9-Qa1.js')).toBe(true);
    expect(lazyLanguageChunk.test('https://help.egrant.sk/assets/uk-DfT5ZpLz.js')).toBe(true);
    expect(lazyLanguageChunk.test('/assets/sk-DfT5ZpLz.js')).toBe(false);
    expect(lazyLanguageChunk.test('/assets/en-DfT5ZpLz.js')).toBe(false);
    expect(lazyLanguageChunk.test('/assets/index-DfT5ZpLz.js')).toBe(false);
    expect(lazyLanguageChunk.test('/assets/items-DfT5ZpLz.js')).toBe(false);
  });
});
