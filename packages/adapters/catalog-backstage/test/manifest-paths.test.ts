/**
 * T044 — FR-012: **two-stage** source-path validation, each stage observed failing
 * independently with its own reason.
 *
 * The two stages are separate checks and the test is deliberately built so that
 * neither could stand in for the other:
 *
 * - The lexical cases are all rejected **without touching the filesystem** — they
 *   are run against a checkout root that does not exist, so any implementation that
 *   reached for `realpath` first would throw rather than reject.
 * - The confinement case uses a **symlink whose lexical form is clean**
 *   (`link/secret.yaml`, no `..`, no leading slash) but whose resolved target is
 *   outside the root. `input-manifest.md` §4.1 states this in exactly those terms:
 *   "a lexically-clean relative path can still symlink outside the root."
 *
 * ADR-0016 evidence:
 * `specs/010-catalog-backstage/evidence/negative-cases/path-validation/`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isBeneath,
  validatePathConfined,
  validatePathLexically,
  validateSourcePath,
} from '../src/manifest/paths.ts';

/** A root that does not exist, so stage 1 provably runs before the filesystem. */
const NONEXISTENT_ROOT = join(tmpdir(), 'adrkit-this-root-does-not-exist-9d1f');

let outsideRoot = '';
let checkoutRoot = '';

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'adrkit-path-fixture-'));
  outsideRoot = join(base, 'outside');
  checkoutRoot = join(base, 'checkout');
  await mkdir(outsideRoot, { recursive: true });
  await mkdir(join(checkoutRoot, 'nested'), { recursive: true });
  await writeFile(join(outsideRoot, 'secret.yaml'), 'kind: Component\n', 'utf8');
  await writeFile(join(checkoutRoot, 'catalog-info.yaml'), 'kind: Component\n', 'utf8');
  // A directory symlink out of the checkout. `escape/secret.yaml` is lexically
  // clean and resolves outside the root only through this link.
  await symlink(outsideRoot, join(checkoutRoot, 'escape'), 'dir');
});

afterAll(async () => {
  if (checkoutRoot) await rm(join(checkoutRoot, '..'), { recursive: true, force: true });
});

describe('T044 stage 1 — lexical rejection, before the filesystem is touched', () => {
  test('a clean repo-relative path passes stage 1', () => {
    expect(validatePathLexically('packages/payments/catalog-info.yaml').ok).toBe(true);
  });

  test.each([
    ['', 'path-empty'],
    ['.', 'path-dot-or-dotdot'],
    ['..', 'path-dot-or-dotdot'],
    ['/etc/passwd', 'path-absolute'],
    ['C:\\Windows\\system32', 'path-drive-prefix'],
    ['packages\\payments\\catalog-info.yaml', 'path-backslash'],
    ['\\\\host\\share\\file.yaml', 'path-backslash'],
    ['../../secret.yaml', 'path-traversal-segment'],
    ['packages/./catalog-info.yaml', 'path-traversal-segment'],
    ['packages/../../etc/passwd', 'path-traversal-segment'],
    ['packages/\u0000/catalog-info.yaml', 'path-control-character'],
    ['packages/\u007f/catalog-info.yaml', 'path-control-character'],
    ['packages/\ncatalog-info.yaml', 'path-control-character'],
  ] as const)('%j is rejected as %s', (path, expected) => {
    const result = validatePathLexically(path);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe(expected);
    expect(result.rejection.triggerClass).toBe('invalid-manifest-shape');
  });

  test('the drive prefix rule fires before the backslash rule', () => {
    // `C:\Windows` violates both. `input-manifest.md` §4.1 lists the drive prefix
    // ahead of the backslash rule, so the reported reason must be the drive one
    // regardless of implementation order.
    const result = validatePathLexically('C:\\Windows');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('path-drive-prefix');
  });

  test('stage 1 rejects without any filesystem access', async () => {
    // The root does not exist. A stage-1 failure must still be a rejection rather
    // than a thrown ENOENT, which is only possible if stage 1 really did run first.
    const result = await validateSourcePath(NONEXISTENT_ROOT, '../../secret.yaml');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('path-traversal-segment');
  });
});

describe('T044 stage 2 — confined realpath', () => {
  test('containment is strict — a sibling sharing a name prefix is not beneath', () => {
    expect(isBeneath('/repo', '/repo/src/a.ts')).toBe(true);
    expect(isBeneath('/repo', '/repo-evil/a.ts')).toBe(false);
    expect(isBeneath('/repo', '/repo')).toBe(false);
    expect(isBeneath('/repo', '/elsewhere/a.ts')).toBe(false);
  });

  test('a real file beneath the root is accepted', async () => {
    const result = await validatePathConfined(checkoutRoot, 'catalog-info.yaml');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.declared).toBe('catalog-info.yaml');
  });

  test('a lexically-clean path escaping through a symlink fails closed', async () => {
    // This is the case stage 1 cannot see: no `..`, no leading slash, nothing a
    // string check could catch.
    expect(validatePathLexically('escape/secret.yaml').ok).toBe(true);

    const result = await validatePathConfined(checkoutRoot, 'escape/secret.yaml');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('path-escapes-checkout-root');
    expect(result.rejection.triggerClass).toBe('incomplete-required-source');
    expect(result.rejection.detail).toContain('not beneath the verified checkout root');
  });

  test('the same escape is rejected through the combined two-stage entry point', async () => {
    const result = await validateSourcePath(checkoutRoot, 'escape/secret.yaml');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('path-escapes-checkout-root');
  });

  test('a nonexistent path beneath the root is not an escape', async () => {
    // Absence is `manifest/digests.ts`'s `source-missing`. Reporting it here would
    // characterise a missing file as a boundary violation.
    const result = await validatePathConfined(checkoutRoot, 'nested/not-created.yaml');
    expect(result.ok).toBe(true);
  });

  test('the two stages emit different reasons for their own failures', async () => {
    const stageOne = await validateSourcePath(checkoutRoot, '../secret.yaml');
    const stageTwo = await validateSourcePath(checkoutRoot, 'escape/secret.yaml');
    expect(stageOne.ok).toBe(false);
    expect(stageTwo.ok).toBe(false);
    if (stageOne.ok || stageTwo.ok) return;
    expect(stageOne.rejection.reason).not.toBe(stageTwo.rejection.reason);
    expect(stageOne.rejection.triggerClass).not.toBe(stageTwo.rejection.triggerClass);
  });
});
