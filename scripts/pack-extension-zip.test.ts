import { describe, expect, test } from 'bun:test';
import { EXCLUDED_FROM_ASSET, assetNameFor } from './pack-extension-zip.ts';

describe('catalog release asset', () => {
  test('names the asset after the extension id, not the package name', () => {
    // The catalog keys on `extension.id`. `@adrkit/spec-kit` is the npm name;
    // `adrkit` is what a Spec Kit user types.
    expect(assetNameFor('adrkit')).toBe('adrkit.zip');
  });

  test('rejects an id that is not catalog-safe', () => {
    for (const bad of ['@adrkit/spec-kit', 'adrKit', 'adr kit', '../escape', '']) {
      expect({ bad, threw: (() => { try { assetNameFor(bad); return false; } catch { return true; } })() })
        .toEqual({ bad, threw: true });
    }
  });

  test('excludes workspace metadata from what a catalog consumer receives', () => {
    // npm always ships package.json; a Spec Kit consumer has no use for it, and
    // the `--dev` install path already drops it via .extensionignore. The two
    // install paths should hand over the same files.
    expect(EXCLUDED_FROM_ASSET).toContain('package.json');
    expect(EXCLUDED_FROM_ASSET.length).toBeGreaterThan(0);

    // Guard the guard: the runtime files must never be excluded.
    for (const shipped of ['extension.yml', 'commands', 'scripts', 'README.md']) {
      expect({ shipped, excluded: EXCLUDED_FROM_ASSET.includes(shipped) }).toEqual({
        shipped,
        excluded: false,
      });
    }
  });
});
