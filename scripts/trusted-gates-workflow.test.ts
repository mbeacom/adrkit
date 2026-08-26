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
  concurrency?: Record<string, unknown>;
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

/**
 * Minimal evaluator for the two condition shapes this workflow has used: an
 * exclusion list (`x != 'a' && x != 'b'`) and the enumeration it replaced
 * (`x == 'a' || x == 'b'`).
 *
 * Worth the ten lines because a substring assertion cannot tell them apart in
 * the direction that matters. "The condition does not mention `reopened`" is
 * true of the exclusion list *and* of the enumeration that omitted it — which is
 * exactly the bypass, and exactly the assertion that would have missed it.
 */
function dismissesOn(condition: string, action: string): boolean {
  const included = [...condition.matchAll(/==\s*'([^']+)'/g)].map((match) => match[1]);
  if (included.length > 0) return included.includes(action);
  const excluded = [...condition.matchAll(/!=\s*'([^']+)'/g)].map((match) => match[1]);
  return !excluded.includes(action);
}

function hasTopLevelConcurrencyBlock(source: string): boolean {
  return /^\s*concurrency\s*:/m.test(source);
}

type ModeledRun = 'occupying-run' | 'synchronize-dismissal' | 'title-edit-noop';

interface ModeledConcurrencyGroup {
  running?: ModeledRun;
  pending?: ModeledRun;
  cancelled: ModeledRun[];
}

/**
 * GitHub permits at most one running and one pending run in a concurrency
 * group. A newly queued run always replaces an existing pending run;
 * `cancel-in-progress` controls only whether the running run is also cancelled.
 */
function enqueueInConcurrencyGroup(
  group: ModeledConcurrencyGroup,
  incoming: ModeledRun,
  cancelInProgress: boolean,
): ModeledConcurrencyGroup {
  const cancelled = [...group.cancelled];
  if (group.pending) cancelled.push(group.pending);
  if (cancelInProgress && group.running) {
    cancelled.push(group.running);
    return { running: incoming, cancelled };
  }
  return { running: group.running, pending: incoming, cancelled };
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
  // The only two activity types that cannot change the commit range.
  const CANNOT_MOVE_THE_DIFF = ['labeled', 'unlabeled'];

  test('dismissal is an exclusion list, not an enumeration', () => {
    // Enumerating the actions that dismiss produced two separate holes. `edited`
    // was missing, so a retarget carried the acknowledgment onto a different
    // base. `reopened` was missing, which is worse: a pull request can be closed
    // by its own author, pushed to while closed — GitHub delivers no event for
    // that — and reopened, arriving with a new head SHA and the old label intact.
    // An exclusion list makes any future activity type dismiss by default.
    const condition = dismissal().if ?? '';
    expect(condition).not.toContain('==');
    for (const action of CANNOT_MOVE_THE_DIFF) {
      expect(condition).toContain(`!= '${action}'`);
    }
  });

  test('every activity type that can move the diff dismisses', () => {
    const condition = dismissal().if ?? '';
    const types = TRIGGERS.pull_request_target?.types ?? [];
    // Derived from the trigger list rather than hard-coded, so adding a type
    // without considering dismissal fails here instead of shipping a bypass.
    const notDismissed = types.filter((type) => condition.includes(`!= '${type}'`));
    expect(notDismissed.sort()).toEqual([...CANNOT_MOVE_THE_DIFF].sort());
  });

  test('reopened dismisses, closing the close-push-reopen route', () => {
    // Evaluated, not pattern-matched. The earlier version of this assertion
    // passed against the very inclusion list that left the route open, because
    // an enumeration that omits `reopened` also contains no `!= 'reopened'`.
    expect(dismissesOn(dismissal().if ?? '', 'reopened')).toBe(true);
    expect(TRIGGERS.pull_request_target?.types).toContain('reopened');
  });

  test('labeled does not dismiss, or applying the acknowledgment would undo it', () => {
    expect(dismissesOn(dismissal().if ?? '', 'labeled')).toBe(false);
    expect(dismissesOn(dismissal().if ?? '', 'unlabeled')).toBe(false);
  });

  test('every other declared activity type dismisses', () => {
    const condition = dismissal().if ?? '';
    for (const type of TRIGGERS.pull_request_target?.types ?? []) {
      if (CANNOT_MOVE_THE_DIFF.includes(type)) continue;
      expect({ type, dismisses: dismissesOn(condition, type) }).toEqual({
        type,
        dismisses: true,
      });
    }
  });

  test('an edit that left the base alone does not dismiss', () => {
    // Title and body edits move nothing the acknowledgment was given for, and a
    // control that fires on noise is one that gets waved through on signal.
    const run = dismissal().run ?? '';
    expect(run).toContain('"$ACTION" = "edited"');
    expect(run).toContain('"$BASE_CHANGE" = "null"');
    expect(dismissal().env?.BASE_CHANGE).toBe('${{ toJSON(github.event.changes.base) }}');
  });

  test('cancel-in-progress false still lets a title edit replace a pending dismissal', () => {
    // The dismissal step intentionally no-ops on `edited` without `changes.base`.
    // If another run occupies the group, a synchronize run is pending. GitHub
    // replaces that pending run when the title-edit run arrives regardless of
    // `cancel-in-progress`, so the setting cannot make the safety run uncancellable.
    const condition = dismissal().if ?? '';
    expect(dismissesOn(condition, 'edited')).toBe(true);
    expect(dismissal().run ?? '').toContain('"$BASE_CHANGE" = "null"');

    const afterPush = enqueueInConcurrencyGroup(
      { running: 'occupying-run', cancelled: [] },
      'synchronize-dismissal',
      false,
    );
    const afterTitleEdit = enqueueInConcurrencyGroup(afterPush, 'title-edit-noop', false);

    expect(afterTitleEdit.running).toBe('occupying-run');
    expect(afterTitleEdit.pending).toBe('title-edit-noop');
    expect(afterTitleEdit.cancelled).toContain('synchronize-dismissal');
  });

  test('the workflow has no concurrency group that can replace a safety run', () => {
    expect(hasTopLevelConcurrencyBlock(SOURCE)).toBe(false);
    expect((WORKFLOW as { concurrency?: Record<string, unknown> }).concurrency).toBeUndefined();
  });

  test('the label listing is paginated before it is trusted', () => {
    // An unpaginated page caps at 30 labels, and this check's pass condition is
    // "the label is not in this list".
    const run = dismissal().run ?? '';
    expect(run).toContain('--paginate --slurp');
    expect(run).toContain('index("gate-change-acknowledged")');
  });

  test('the verification folds case, like the gate script it backs', () => {
    // classifyGateChanges matches the label case-insensitively. A verification
    // that did not would report "absent" for a label named
    // `Gate-Change-Acknowledged` while the gate still honoured it — two halves of
    // one control disagreeing about what the control is.
    expect(dismissal().run ?? '').toContain('ascii_downcase');
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
