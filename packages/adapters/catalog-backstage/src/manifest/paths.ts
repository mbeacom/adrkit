/**
 * T044 — **two-stage** source-path validation: a lexical rejection stage, then a
 * confined realpath stage.
 *
 * `input-manifest.md` §4.1 opens with the reason this exists: *naming a source
 * `path` "repo-relative POSIX" is not itself a validation.* Without an explicit
 * check a manifest could name `/etc/passwd`, `../../secret`, `C:\...`,
 * `\\host\share`, or a lexically-clean path that resolves through a symlink to a
 * target outside the checkout — and a naive generator would read outside the
 * boundary it promised.
 *
 * The two stages are genuinely different checks and must both exist:
 *
 * - **Stage 1 is purely lexical** and runs *before the filesystem is touched*. It
 *   cannot see symlinks, and it does not try to.
 * - **Stage 2 resolves symlinks** and requires the resolved real path to still lie
 *   beneath the verified checkout root. It cannot be replaced by a stricter
 *   stage 1, because a lexically-clean relative path can still symlink outside the
 *   root. That is stated in §4.1 in those terms.
 *
 * **Trigger-class attribution.** §4.1 names stage 2's failure explicitly: it "is an
 * 'incomplete required source' rejection, and the file is never opened". It does
 * **not** name a trigger class for stage 1, saying only "reject the manifest,
 * non-zero". Stage 1 is a defect in the manifest's own content rather than in the
 * checkout's, so it is attributed to `invalid-manifest-shape` here. That
 * attribution is an inference from the contract's silence, not a quotation from
 * it, and it is reported as a gap rather than presented as settled.
 *
 * @see `specs/009-catalog-binding-viability/contracts/input-manifest.md` §4.1
 * @see `specs/010-catalog-backstage/spec.md` FR-012
 */

import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { type Validated, accepted, rejected } from '../diagnostics.ts';

/**
 * Stage 1 reasons — one per bullet in `input-manifest.md` §4.1's numbered list.
 *
 * They are separate rather than a single `lexically-invalid` because ADR-0016
 * records the emitted string, and six negative cases that all emit the same string
 * demonstrate one check six times rather than six checks once.
 */
export type LexicalPathReason =
  | 'path-empty'
  | 'path-dot-or-dotdot'
  | 'path-absolute'
  | 'path-drive-prefix'
  | 'path-backslash'
  | 'path-traversal-segment'
  | 'path-control-character';

/** Stage 2 reason. Maps to `incomplete-required-source`, per §4.1. */
export type ConfinedPathReason = 'path-escapes-checkout-root';

/** Either stage's reason. */
export type SourcePathReason = LexicalPathReason | ConfinedPathReason;

/**
 * **Stage 1 — lexical rejection.** Pure; touches no filesystem.
 *
 * The order below is the order §4.1 lists the conditions in, so a path violating
 * several always reports the same one.
 */
export function validatePathLexically(path: string): Validated<string, LexicalPathReason> {
  if (path === '') {
    return rejected('path-empty', 'invalid-manifest-shape', 'a source path is the empty string');
  }

  if (path === '.' || path === '..') {
    return rejected(
      'path-dot-or-dotdot',
      'invalid-manifest-shape',
      `a source path is exactly ${JSON.stringify(path)}`,
    );
  }

  // A leading `/` is checked directly rather than via `isAbsolute`, because
  // `isAbsolute` is platform-dependent and this rule is not: the contract states
  // "is absolute or begins with `/`".
  if (path.startsWith('/') || isAbsolute(path)) {
    return rejected(
      'path-absolute',
      'invalid-manifest-shape',
      `source path ${JSON.stringify(path)} is absolute`,
    );
  }

  if (/^[A-Za-z]:/u.test(path)) {
    return rejected(
      'path-drive-prefix',
      'invalid-manifest-shape',
      `source path ${JSON.stringify(path)} begins with a Windows drive prefix`,
    );
  }

  // Covers both the UNC form (`\\host\share`) and any interior backslash: §4.1
  // groups them, because a UNC path is a special case of "contains a backslash".
  if (path.includes('\\')) {
    return rejected(
      'path-backslash',
      'invalid-manifest-shape',
      `source path ${JSON.stringify(path)} contains a backslash`,
    );
  }

  for (const segment of path.split('/')) {
    if (segment === '.' || segment === '..') {
      return rejected(
        'path-traversal-segment',
        'invalid-manifest-shape',
        `source path ${JSON.stringify(path)} contains a ${JSON.stringify(segment)} segment`,
      );
    }
  }

  for (const character of path) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return rejected(
        'path-control-character',
        'invalid-manifest-shape',
        `source path ${JSON.stringify(path)} contains control character U+${code.toString(16).toUpperCase().padStart(4, '0')}`,
      );
    }
  }

  return accepted(path);
}

/**
 * True when `candidate` lies strictly beneath `root`.
 *
 * Pure, and separated from {@link validatePathConfined} so the containment rule is
 * testable without staging symlinks. The separator suffix is what stops
 * `/repo-evil` from counting as beneath `/repo`; equality with the root is not
 * "beneath" either, since the root is not a source file.
 */
export function isBeneath(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate.startsWith(
    normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`,
  );
}

/** The absolute, symlink-resolved path a source resolved to. */
export interface ConfinedPath {
  readonly declared: string;
  readonly resolved: string;
}

/**
 * Resolve `absolute` as far as the filesystem allows, then re-append the part that
 * does not exist yet.
 *
 * A plain `realpath` throws for a path whose final component is absent, and falling
 * back to the *unresolved* path in that case would silently skip symlink
 * resolution for every ancestor — which is precisely the escape route stage 2
 * exists to close. Worse, on a platform where the checkout root itself resolves
 * elsewhere (macOS `/var` → `/private/var`), the unresolved fallback compares two
 * differently-rooted strings and reports every absent file as an escape: a check
 * that appears to work while testing nothing.
 *
 * Walking up to the deepest existing ancestor resolves every symlink that actually
 * exists on the path, and treats the not-yet-existing tail as the literal names it
 * is. Absence is then left to `manifest/digests.ts` to report under its own reason.
 */
async function realpathOfDeepestExistingAncestor(absolute: string): Promise<string> {
  const trailing: string[] = [];
  let current = absolute;

  for (;;) {
    try {
      const resolved = await realpath(current);
      return trailing.length === 0 ? resolved : join(resolved, ...trailing.reverse());
    } catch {
      const parent = dirname(current);
      // `dirname('/') === '/'`: nothing above the filesystem root exists to try.
      if (parent === current) return absolute;
      trailing.push(basename(current));
      current = parent;
    }
  }
}

/**
 * **Stage 2 — confined realpath.** Only for a path that survived stage 1.
 *
 * Resolves the relative path against the **verified checkout root** (the same root
 * whose `git remote`/`HEAD` `repository/identity.ts` checked), fully resolving
 * symlinks. A resolved target that escapes that root — including one reached only
 * through an intermediate symlink — fails closed, and the file is never opened.
 *
 * A path that does not exist is **not** an escape and is not this stage's concern:
 * absence is `manifest/digests.ts`'s `source-missing`. Conflating the two would
 * report a missing file as a boundary violation.
 */
export async function validatePathConfined(
  checkoutRoot: string,
  path: string,
): Promise<Validated<ConfinedPath, ConfinedPathReason>> {
  const joined = resolve(checkoutRoot, path);

  // The root itself is resolved too. On macOS a checkout under `/var/...` really
  // lives at `/private/var/...`; comparing a resolved candidate against an
  // unresolved root would report every path as an escape, which would look like a
  // working boundary check while actually checking nothing.
  let resolvedRoot: string;
  try {
    resolvedRoot = await realpath(checkoutRoot);
  } catch {
    resolvedRoot = resolve(checkoutRoot);
  }

  const resolved = await realpathOfDeepestExistingAncestor(joined);

  if (!isBeneath(resolvedRoot, resolved)) {
    return rejected(
      'path-escapes-checkout-root',
      'incomplete-required-source',
      `source path ${JSON.stringify(path)} resolves to ${JSON.stringify(resolved)}, which is not beneath the verified checkout root ${JSON.stringify(resolvedRoot)}`,
    );
  }

  return accepted({ declared: path, resolved });
}

/**
 * Both stages, in order, stopping at the first failure.
 *
 * The ordering is not a convenience: stage 2 touches the filesystem, and §4.1
 * requires the lexical rejection happen "before touching the filesystem". A path
 * that fails stage 1 is never passed to `realpath`.
 */
export async function validateSourcePath(
  checkoutRoot: string,
  path: string,
): Promise<Validated<ConfinedPath, SourcePathReason>> {
  const lexical = validatePathLexically(path);
  if (!lexical.ok) return lexical;
  return validatePathConfined(checkoutRoot, lexical.value);
}
