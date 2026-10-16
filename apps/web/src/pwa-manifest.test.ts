import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pwaManifest } from '../pwa-manifest';

describe('pwaManifest', () => {
  it('is standalone, named Help, themed with the page token', () => {
    expect(pwaManifest.short_name).toBe('Help');
    expect(pwaManifest.name).toBe('Help by eGrant');
    expect(pwaManifest.display).toBe('standalone');
    expect(pwaManifest.start_url).toBe('/');
    expect(pwaManifest.scope).toBe('/');
    expect(pwaManifest.theme_color).toBe('#F5F3F1');
    expect(pwaManifest.background_color).toBe('#F5F3F1');
  });

  it('lists the 192, 512 and maskable icons, and the files exist in public/icons', () => {
    const icons = pwaManifest.icons ?? [];
    expect(icons.map((i) => [i.sizes, i.purpose ?? 'any'])).toEqual([
      ['192x192', 'any'],
      ['512x512', 'any'],
      ['512x512', 'maskable'],
    ]);
    for (const icon of icons) {
      const file = resolve(process.cwd(), `public${icon.src}`);
      expect(existsSync(file), icon.src).toBe(true);
    }
  });
});
