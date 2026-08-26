/**
 * Contract checks on `.github/workflows/trusted-gates.yml` (#137, ADR-0035).
 *
 * The two gates this repository trusts live in YAML, so the properties that make
 * them trustworthy cannot be asserted by the unit tests beside them. They are
 * asserted here instead, against the parsed file.
 *
 * Every case below exists because getting it wrong is silent. A missing activity
 * type does not fail; it just means the gate never runs. A `${{ }}` inside a
 * `run:` body does not fail; it means a pull request title can execute shell in a
 * privileged job. None of that shows up as a red build, which is the same shape
 * as the defects ADR-0016 is about.
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const WORKFLOW_PATH = join(import.meta.dir, '..', '.github', 'workflows', 'trusted-gates.yml');
const SOURCE = readFileSync(WORKFLOW_PATH, 'utf8');
const WORKFLOW = Bun.YAML.parse(SOURCE) as {
  on?: Record<string, { types?: string[] }>;
  true?: Record<string, { types?: string[] }>;
  permissions?: Record<string, string>;
  jobs: Record<
    string,
    {
      permissions?: Record<string, string>;
      steps: Array<{
        name?: string;
        if?: string;
        uses?: string;
        with?: Record<string, unknown>;
        env?: Record<string, string>;
        run?: string;
      }>;
    }
  >;
};

// YAML 1.1 reads a bare `on` key as the boolean true, which Bun's parser honors.
const TRIGGERS = WORKFLOW.on ?? WORKFLOW.true ?? {};
const JOBS = WORKFLOW.jobs;
const ALL_STEPS = Object.values(JOBS).flatMap((job) => job.steps);

function stepNamed(fragment: string) {
  const found = ALL_STEPS.find((step) => step.name?.includes(fragment));
  if (!found) throw new Error(`no step whose name contains "${fragment}"`);
  return found;
}

describe('the trigger', () => {
  test('is pull_request_target, which runs from the default branch', () => {
    expect(Object.keys(TRIGGERS)).toEqual(['pull_request_target']);
  });

  test('includes edited, without which a retarget is invisible', () => {
    // Retargeting a pull request to a different base fires `edited` with
    // `changes.base` — **not** `synchronize`. The head SHA does not move, so the
    // check runs computed against the old base stay the latest results for that
    // SHA and keep the required contexts green over a range nothing examined.
    // This assertion is the whole defence against that, and its absence would
    // look exactly like a passing build.
    expect(TRIGGERS.pull_request_target?.types).toContain('edited');
  });

  test('includes every activity type the gates depend on', () => {
    expect([...(TRIGGERS.pull_request_target?.types ?? [])].sort()).toEqual([
      'edited',
      'labeled',
      'opened',
      'reopened',
      'synchronize',
      'unlabeled',
    ]);
  });
});

describe('the acknowledgment is bound to what it acknowledged', () => {
  const dismissal = () => stepNamed('Dismiss the acknowledgment');

  test('dismissal runs on both a push and an edit', () => {
    const condition = dismissal().if ?? '';
    expect(condition).toContain("github.event.action == 'synchronize'");
    expect(condition).toContain("github.event.action == 'edited'");
  });

  test('an edit that left the base alone does not dismiss', () => {
    // Title and body edits move nothing the acknowledgment was given for, and a
    // control that fires on noise is one that gets waved through on signal.
    const run = dismissal().run ?? '';
    expect(run).toContain('"$ACTION" = "edited"');
    expect(run).toContain('"$BASE_CHANGE" = "null"');
    expect(dismissal().env?.BASE_CHANGE).toBe('${{ toJSON(github.event.changes.base) }}');
  });

  test('the label listing is paginated before it is trusted', () => {
    // An unpaginated page caps at 30 labels, and this check's pass condition is
    // "the label is not in this list".
    const run = dismissal().run ?? '';
    expect(run).toContain('--paginate --slurp');
    expect(run).toContain('index("gate-change-acknowledged")');
  });

  test('dismissal failure is not swallowed', () => {
    expect(dismissal().run ?? '').toContain('exit 1');
  });
});

describe('no pull-request code can execute here', () => {
  test('every checkout takes the default branch, never a ref', () => {
    const checkouts = ALL_STEPS.filter((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const checkout of checkouts) {
      // A `ref:` is how `pull_request_target` becomes a pwn request.
      expect(checkout.with?.ref).toBeUndefined();
      expect(checkout.with?.repository).toBeUndefined();
      expect(checkout.with?.['persist-credentials']).toBe(false);
    }
  });

  test('every action is pinned to a full 40-character SHA', () => {
    for (const step of ALL_STEPS) {
      if (!step.uses) continue;
      expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  test('no run body interpolates an expression', () => {
    // Untrusted values reach a step through `env:`; a `${{ }}` inside `run:` is
    // substituted before the shell sees it, so a pull request title containing a
    // quote becomes shell.
    const offenders = ALL_STEPS.filter((step) => step.run?.includes('${{'));
    expect(offenders.map((step) => step.name)).toEqual([]);
  });

  test('nothing installs dependencies', () => {
    // Both checks import Node builtins only, so a hostile lockfile has nothing to
    // hook — and there is no install step for it to hook into.
    const offenders = ALL_STEPS.filter((step) => /\bbun\s+(install|add)\b/.test(step.run ?? ''));
    expect(offenders.map((step) => step.name)).toEqual([]);
  });

  test('the gates are invoked by script path, not through the manifest', () => {
    // `bun run <name>` would route through package.json, which is deliberately
    // not a protected path — see DOCUMENTED_UNPROTECTED_ROUTES. Invoking the path
    // directly is what keeps a manifest edit from redirecting a trusted gate.
    const invocations = ALL_STEPS.map((step) => step.run ?? '').filter((run) =>
      run.includes('scripts/check-'),
    );
    expect(invocations.length).toBe(2);
    for (const run of invocations) {
      expect(run).toMatch(/bun scripts\/check-(dco|gate-integrity)\.ts/);
      expect(run).not.toContain('bun run check:');
    }
  });
});

describe('privilege stays minimal', () => {
  test('the workflow default is read-only', () => {
    expect(WORKFLOW.permissions).toEqual({ contents: 'read' });
  });

  test('only gate-integrity writes, and only to pull requests', () => {
    expect(JOBS['trusted-dco']?.permissions).toEqual({ contents: 'read' });
    expect(JOBS['gate-integrity']?.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'write',
    });
  });

  test('untrusted output is printed inside stopped workflow commands', () => {
    // Commit subjects and changed paths are attacker-chosen, and the runner trims
    // leading whitespace before testing for the `::` prefix — so indentation is
    // not protection.
    const printing = ALL_STEPS.filter((step) => /scripts\/check-/.test(step.run ?? ''));
    expect(printing.length).toBe(2);
    for (const step of printing) {
      expect(step.run).toContain('::stop-commands::');
      expect(step.run).toContain('trap');
    }
  });
});

describe('the file says what it does not close', () => {
  test('it carries no unqualified completeness claim about advisory gates', () => {
    // The claim "every route to neutering an advisory gate runs through
    // .github/workflows/ or scripts/" was in this file and was false: ci.yml
    // reaches most checks through `bun run <name>`, so the root manifest
    // redirects them. Pinned so it cannot come back.
    expect(SOURCE).not.toContain('every route to neutering an advisory gate');
    expect(SOURCE).toContain('DOCUMENTED_UNPROTECTED_ROUTES');
  });
});
