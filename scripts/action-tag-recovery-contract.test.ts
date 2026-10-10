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
const CONTAINER_WORKFLOW = readFileSync(
  join(ROOT, '.github', 'workflows', 'container-release.yml'),
  'utf8',
);
const UPDATE_SCRIPT = readFileSync(join(ROOT, 'scripts', 'update-action-tag.ts'), 'utf8');
const RELEASING_DOCS = readFileSync(join(ROOT, 'docs', 'RELEASING.md'), 'utf8');

function manualFallbackBlock(): string {
  const sectionStart = RELEASING_DOCS.indexOf('### Manual fallback when GitHub Actions is unavailable');
  const fenceStart = RELEASING_DOCS.indexOf('```sh', sectionStart);
  const fenceEnd = RELEASING_DOCS.indexOf('```', fenceStart + 5);
  expect(sectionStart).toBeGreaterThan(-1);
  expect(fenceStart).toBeGreaterThan(sectionStart);
  expect(fenceEnd).toBeGreaterThan(fenceStart);
  return RELEASING_DOCS.slice(fenceStart + '```sh\n'.length, fenceEnd);
}

function assertManualMarkerSequence(block: string): void {
  const creation = block.indexOf('git -c tag.gpgSign=false tag "$marker" "$moving_commit_sha"');
  const push = block.indexOf('git push origin "refs/tags/$marker:refs/tags/$marker"');
  const recovery = block.indexOf('bun run release:action-tag -- --recover "$target"');
  expect(creation).toBeGreaterThan(-1);
  expect(push).toBeGreaterThan(creation);
  expect(recovery).toBeGreaterThan(push);
  expect(block.slice(creation, recovery)).not.toContain('|| true');
}

describe('major Action tag recovery contract', () => {
  test('serializes recovery with normal release promotion', () => {
    const concurrency = 'group: release-${{ github.repository }}';
    expect(RELEASE_WORKFLOW).toContain(concurrency);
    expect(RECOVERY_WORKFLOW).toContain(concurrency);
    expect(CONTAINER_WORKFLOW).toContain(concurrency);
    expect(RECOVERY_WORKFLOW).toContain('cancel-in-progress: false');
    expect(CONTAINER_WORKFLOW).toContain('cancel-in-progress: false');
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
    expect(RECOVERY_WORKFLOW).toContain(
      '.head_sha == $revision and .head_branch == $tag and .conclusion == "success"',
    );
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
    expect(RELEASE_WORKFLOW).toContain('marker_status=$?');
    expect(RELEASE_WORKFLOW).toContain('2) ;;');
    expect(RELEASE_WORKFLOW).toContain('Unable to check withdrawal marker');
    expect(CONTAINER_WORKFLOW).toContain('Refuse a withdrawn lockstep release');
    expect(CONTAINER_WORKFLOW).toContain('marker_status=$?');
    expect(CONTAINER_WORKFLOW).toContain('2) ;;');
    expect(RECOVERY_WORKFLOW).toContain('head_sha=$revision');
    expect(UPDATE_SCRIPT).toContain('--expected-remote-ref-sha');
    expect(RECOVERY_WORKFLOW).toContain('moving_ref_sha');
    expect(RECOVERY_WORKFLOW).toContain('git -c tag.gpgSign=false tag "$marker"');
    const fallback = manualFallbackBlock();
    expect(fallback).toMatch(/^set -euo pipefail\n/);
    assertManualMarkerSequence(fallback);
    expect(() => assertManualMarkerSequence(
      fallback.replace('git push origin "refs/tags/$marker:refs/tags/$marker"\n', ''),
    )).toThrow();
    expect(() => assertManualMarkerSequence(
      fallback.replace(
        'git push origin "refs/tags/$marker:refs/tags/$marker"',
        'bun run release:action-tag -- --recover "$target"\n' +
          'git push origin "refs/tags/$marker:refs/tags/$marker"',
      ),
    )).toThrow();
    expect(CONTAINER_WORKFLOW).toContain('cat action-tag-update.log');
    expect(CONTAINER_WORKFLOW).toContain('>> "$GITHUB_STEP_SUMMARY"');
  });

  test('publishes a lockstep draft before Marketplace finalization', () => {
    expect(RELEASE_WORKFLOW).toContain(
      'gh release create "$GITHUB_REF_NAME" --draft --verify-tag "${notes[@]}"',
    );
    expect(RELEASE_WORKFLOW).toContain(
      'gh release create "$GITHUB_REF_NAME" --verify-tag "${notes[@]}" "${assets[@]}"',
    );
    // Generated notes start at the previous tag of the same kind, never at the
    // latest release of either kind (release-notes-start-tag.test.ts). The
    // selection reads `git tag --list`, so the checkout must carry every tag.
    expect(RELEASE_WORKFLOW).toContain('notes=(--generate-notes)');
    expect(RELEASE_WORKFLOW).toContain(
      'start_tag="$(bun scripts/release-notes-start-tag.ts "$GITHUB_REF_NAME")"',
    );
    expect(RELEASE_WORKFLOW).toContain('notes+=(--notes-start-tag "$start_tag")');
    expect(RELEASE_WORKFLOW).toContain('fetch-depth: 0');
    expect(RELEASE_WORKFLOW).not.toContain('--verify-tag --generate-notes');
    expect(RELEASE_WORKFLOW).not.toContain('name: Update the major Action tag');
    expect(CONTAINER_WORKFLOW).toContain('release:\n    types: [published]');
    expect(CONTAINER_WORKFLOW).not.toContain('workflow_run:');
    expect(CONTAINER_WORKFLOW).toContain('UPSTREAM_TAG: ${{ github.event.release.tag_name }}');
    expect(CONTAINER_WORKFLOW).toContain('name: Promote the moving major Action tag');
    expect(CONTAINER_WORKFLOW).toContain('bun run release:action-tag -- "$RELEASE_TAG"');
    expect(CONTAINER_WORKFLOW).toContain('needs: finalize');
  });

  test('keeps the contents-write token away from container build actions', () => {
    const finalize = CONTAINER_WORKFLOW.split('  finalize:\n')[1]?.split('\n  publish:\n')[0] ?? '';
    const publish = CONTAINER_WORKFLOW.split('\n  publish:\n')[1] ?? '';
    expect(finalize).toContain('contents: write');
    expect(finalize).toContain('name: Promote the moving major Action tag');
    expect(publish).toContain('contents: read');
    expect(publish).not.toContain('contents: write');
    expect(publish).not.toContain('release:action-tag');
  });

  test('fails manual container recovery outside the trusted main ref', () => {
    expect(CONTAINER_WORKFLOW).toContain('validate-context:');
    expect(CONTAINER_WORKFLOW).toContain('test "$GITHUB_REF" = "refs/heads/main"');
    expect(CONTAINER_WORKFLOW).toContain("github.ref == 'refs/heads/main'");
    expect(CONTAINER_WORKFLOW).toContain('needs: validate-context');
  });

  test('checks the annotated lockstep tag before publishing', () => {
    const gate = RELEASE_WORKFLOW.indexOf('test "$(git cat-file -t "refs/tags/$GITHUB_REF_NAME")" = tag');
    const marketplaceEntry = RELEASE_WORKFLOW.indexOf('git cat-file -e "$GITHUB_SHA:action.yml"');
    const publish = RELEASE_WORKFLOW.indexOf('name: Publish npm packages with provenance');
    expect(gate).toBeGreaterThan(-1);
    expect(marketplaceEntry).toBeGreaterThan(gate);
    expect(marketplaceEntry).toBeLessThan(publish);
    expect(gate).toBeLessThan(publish);
  });

  test('keeps pre-Marketplace releases eligible for nested Action recovery', () => {
    expect(RECOVERY_WORKFLOW).not.toContain('git cat-file -e "$revision:action.yml"');
    expect(RELEASING_DOCS).not.toContain('git cat-file -e "$target_commit:action.yml"');
    expect(RECOVERY_WORKFLOW).toContain('git cat-file -e "$revision:packages/ci/action.yml"');
    expect(RECOVERY_WORKFLOW).toContain('git cat-file -e "$revision:packages/ci/queue/action.yml"');
  });

  // ADR-0054 item 6: the third nested bundle. Required only where the portal Action
  // exists in the target revision, for the reason the root alias above is not required at
  // all: every release before the portal Action has no portal bundle, and an unconditional
  // check would make all of them (v0.18.0 included) unrecoverable, so a bad first portal
  // release could not be rolled back to the last known-good nested target.
  // ADR-0016 clause 2: observed failing before the workflow and RELEASING.md were taught
  // the bundle (`portalGate` was -1), and again with the workflow's check planted
  // unconditional and with the manual-fallback check deleted.
  test('requires the portal bundle wherever the portal Action exists, and keeps earlier releases eligible', () => {
    const cases = [
      { source: RECOVERY_WORKFLOW, revision: '$revision' },
      { source: manualFallbackBlock(), revision: '$target_commit' },
    ];
    for (const { source, revision } of cases) {
      const portalGate = source.indexOf(`if git cat-file -e "${revision}:packages/ci/portal/action.yml"`);
      const bundle = source.indexOf(`git cat-file -e "${revision}:packages/ci/dist/portal-action.js"`);
      const closeMatch = /\n[ \t]*fi\n/.exec(source.slice(bundle));
      const close = closeMatch ? bundle + closeMatch.index : -1;
      expect(portalGate).toBeGreaterThan(-1);
      expect(bundle).toBeGreaterThan(portalGate);
      expect(close).toBeGreaterThan(bundle);
      // Never unconditional: the only mention of the bundle is inside the gate.
      const mention = source.indexOf('packages/ci/dist/portal-action.js');
      expect(source.lastIndexOf('packages/ci/dist/portal-action.js')).toBe(mention);
      expect(mention).toBeGreaterThan(bundle);
      expect(mention).toBeLessThan(close);
    }
  });

  test('documents containment for immutable Marketplace releases', () => {
    expect(RELEASING_DOCS).toContain('### Containing a bad Marketplace release');
    expect(RELEASING_DOCS).toContain('clear **Publish this Action to the GitHub');
    expect(RELEASING_DOCS).toContain('WITHDRAWN FOR ACTION USE');
    expect(RELEASING_DOCS).toContain('Marketplace: published and verified');
    expect(RELEASING_DOCS).toContain('consumers pinned to `mbeacom/adrkit@<bad-tag>`');
  });

  test('does not accept a successful adapter run for a lockstep release', () => {
    const revision = 'a'.repeat(40);
    const runs = [
      { head_sha: revision, head_branch: 'spec-kit-v0.1.3', conclusion: 'success' },
      { head_sha: revision, head_branch: 'v0.11.0', conclusion: 'failure' },
    ];
    const target = 'v0.11.0';
    const successfulLockstepRuns = runs.filter(
      (run) => run.head_sha === revision && run.head_branch === target && run.conclusion === 'success',
    );
    expect(successfulLockstepRuns).toHaveLength(0);
    expect(RECOVERY_WORKFLOW).toContain('.head_branch == $tag');
    expect(RELEASING_DOCS).toContain(
      '.head_branch == $tag and .conclusion == "success"',
    );
    expect(UPDATE_SCRIPT).toContain("rawRemoteRefSha === ''");
  });
});
