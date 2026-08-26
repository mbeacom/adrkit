import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const RECOVERY_WORKFLOW = readFileSync(
  join(ROOT, '.github', 'workflows', 'action-tag-recovery.yml'),
  'utf8',
);
const RELEASE_WORKFLOW = readFileSync(
  join(ROOT, '.github', 'workflows', 'release.yml'),
  'utf8',
);
const UPDATE_SCRIPT = readFileSync(join(ROOT, 'scripts', 'update-action-tag.ts'), 'utf8');

describe('major Action tag recovery contract', () => {
  test('serializes recovery with normal release promotion', () => {
    const concurrency = 'group: release-${{ github.repository }}';
    expect(RELEASE_WORKFLOW).toContain(concurrency);
    expect(RECOVERY_WORKFLOW).toContain(concurrency);
    expect(RECOVERY_WORKFLOW).toContain('cancel-in-progress: false');
  });

  test('runs only from main with the minimum repository permissions', () => {
    expect(RECOVERY_WORKFLOW).toContain('validate-context:');
    expect(RECOVERY_WORKFLOW).toContain('test "$GITHUB_REF" = "refs/heads/main"');
    expect(RECOVERY_WORKFLOW).toContain("github.ref == 'refs/heads/main'");
    expect(RECOVERY_WORKFLOW).toContain('actions: read');
    expect(RECOVERY_WORKFLOW).toContain('contents: write');
    expect(RECOVERY_WORKFLOW).not.toContain('id-token: write');
    expect(RECOVERY_WORKFLOW).not.toContain('packages: write');
    expect(RECOVERY_WORKFLOW).not.toContain('attestations: write');
    expect(RECOVERY_WORKFLOW).toContain('persist-credentials: false');
  });

  test('accepts only a successful stable annotated release and resolves its commit', () => {
    expect(RECOVERY_WORKFLOW).toContain(
      '^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$',
    );
    expect(RECOVERY_WORKFLOW).toContain('git cat-file -t "refs/tags/$RELEASE_TAG"');
    expect(RECOVERY_WORKFLOW).toContain('git rev-parse "$RELEASE_TAG^{commit}"');
    expect(RECOVERY_WORKFLOW).toContain('--json isDraft,isPrerelease');
    expect(RECOVERY_WORKFLOW).toContain('.head_sha == $revision and .conclusion == "success"');
    expect(RECOVERY_WORKFLOW).toContain('git merge-base --is-ancestor "$revision" origin/main');
  });

  test('uses the explicit recovery path and a race-safe tag update', () => {
    expect(RECOVERY_WORKFLOW).toContain(
      'bun run release:action-tag -- --recover "$RELEASE_TAG"',
    );
    expect(UPDATE_SCRIPT).toContain(
      '`--force-with-lease=refs/tags/${majorTag}:${leaseRefSha ?? \'\'}',
    );
    expect(UPDATE_SCRIPT).not.toContain("['git', 'push', '--force'");
    expect(RECOVERY_WORKFLOW).toContain('action-recovery-block/');
    expect(RELEASE_WORKFLOW).toContain('Refuse a withdrawn lockstep release');
    expect(RELEASE_WORKFLOW).toContain('action-recovery-block/$GITHUB_SHA');
    expect(RECOVERY_WORKFLOW).toContain('head_sha=$revision');
    expect(UPDATE_SCRIPT).toContain('--expected-remote-ref-sha');
    expect(RECOVERY_WORKFLOW).toContain('moving_ref_sha');
    expect(RELEASE_WORKFLOW).toContain('cat action-tag-update.log');
    expect(RELEASE_WORKFLOW).toContain('>> "$GITHUB_STEP_SUMMARY"');
  });

  test('checks the annotated lockstep tag before publishing', () => {
    const gate = RELEASE_WORKFLOW.indexOf('test "$(git cat-file -t "refs/tags/$GITHUB_REF_NAME")" = tag');
    const publish = RELEASE_WORKFLOW.indexOf('name: Publish npm packages with provenance');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(publish);
  });
});
