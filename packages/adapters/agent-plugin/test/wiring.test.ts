import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENTS, COMMANDS, SKILLS, frontmatterOf, packageRoot } from './harness.ts';

/**
 * Discovery wiring. Every host decides whether to surface a component from two
 * frontmatter fields — `name` and `description` — and silently ignores a file
 * that gets them wrong. "Silently" is the problem: a broken component does not
 * fail an install, it just never appears, so these are asserted here rather
 * than discovered in someone's session.
 */
describe('component discovery', () => {
  test('every command file exists where both hosts look for it', () => {
    for (const command of COMMANDS) {
      const path = join(packageRoot, 'commands', `${command}.md`);
      expect({ command, present: existsSync(path) }).toEqual({ command, present: true });
    }
  });

  test('every agent and skill file exists where both hosts look for it', () => {
    for (const agent of AGENTS) {
      const path = join(packageRoot, 'agents', `${agent}.md`);
      expect({ agent, present: existsSync(path) }).toEqual({ agent, present: true });
    }
    for (const skill of SKILLS) {
      const path = join(packageRoot, 'skills', skill, 'SKILL.md');
      expect({ skill, present: existsSync(path) }).toEqual({ skill, present: true });
    }
  });

  test('skill and agent names match their own directory or filename', () => {
    for (const skill of SKILLS) {
      const front = frontmatterOf(readFileSync(join(packageRoot, 'skills', skill, 'SKILL.md'), 'utf8'));
      expect({ skill, declared: /^name:\s*(.+)$/m.exec(front)?.[1]?.trim() }).toEqual({
        skill,
        declared: skill,
      });
    }
    for (const agent of AGENTS) {
      const front = frontmatterOf(readFileSync(join(packageRoot, 'agents', `${agent}.md`), 'utf8'));
      expect({ agent, declared: /^name:\s*(.+)$/m.exec(front)?.[1]?.trim() }).toEqual({
        agent,
        declared: agent,
      });
    }
  });

  test('every component leads with a trigger description', () => {
    // Hosts route on `description`. One that describes the component instead of
    // naming when to reach for it produces a component that loads and is never
    // chosen.
    const files = [
      ...SKILLS.map((s) => join(packageRoot, 'skills', s, 'SKILL.md')),
      ...AGENTS.map((a) => join(packageRoot, 'agents', `${a}.md`)),
    ];

    for (const path of files) {
      const front = frontmatterOf(readFileSync(path, 'utf8'));
      const description = /^description:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? '';
      expect({ path, empty: description.length === 0 }).toEqual({ path, empty: false });
      expect({ path, trigger: /^"?Use (when|to) /.test(description) }).toEqual({
        path,
        trigger: true,
      });
    }
  });
});

describe('frontmatter types the hosts will not coerce', () => {
  test('command frontmatter values that YAML would resolve to non-strings are quoted', () => {
    // A command field of the wrong YAML type is a hard load failure, not a
    // degraded one: unquoted `argument-hint: [paths...]` parses as a flow
    // sequence and the host rejects the command with "argument-hint must be a
    // string".
    for (const command of COMMANDS) {
      const front = frontmatterOf(readFileSync(join(packageRoot, 'commands', `${command}.md`), 'utf8'));
      const hint = /^argument-hint:\s*(.+)$/m.exec(front)?.[1]?.trim();

      expect({ command, hint: hint === undefined }).toEqual({ command, hint: false });
      expect({ command, quoted: /^".*"$/.test(hint ?? '') }).toEqual({ command, quoted: true });
    }
  });

  test('no component declares a `tools` list', () => {
    // The three targets disagree on both type and vocabulary: Claude Code takes
    // a comma-separated string of capitalized names, Copilot CLI an array of
    // lowercase ones, and opencode requires a name-to-boolean mapping and
    // *rejects the agent at load time* when handed a list — which is how this
    // was found, via `apm install --target opencode`. There is no portable
    // value, so the read-only contract is stated in the agent body instead.
    for (const agent of AGENTS) {
      const front = frontmatterOf(readFileSync(join(packageRoot, 'agents', `${agent}.md`), 'utf8'));
      const declared = /^tools:\s*(.+)$/m.exec(front)?.[1]?.trim();
      expect({ agent, declared }).toEqual({ agent, declared: undefined });
    }
  });
});

describe('write boundary', () => {
  test('exactly one command writes, and it is adr-draft', () => {
    // The same rule the Spec Kit adapter enforces: a governance tool that
    // writes as a side effect of being consulted is a governance tool people
    // uninstall. `adr new` is the only CLI verb here that creates a record, so
    // its presence is the marker for "this command writes."
    const writers = COMMANDS.filter((command) =>
      /\badr new\b/.test(readFileSync(join(packageRoot, 'commands', `${command}.md`), 'utf8')),
    );
    expect(writers).toEqual(['adr-draft']);
  });

  test('the read-only agent states its own boundary', () => {
    // With no portable `tools` list to enforce it, the contract lives in the
    // body. If that text is ever dropped, the agent silently loses the only
    // statement of its scope that any host can read.
    const body = readFileSync(join(packageRoot, 'agents', 'decision-checker.md'), 'utf8');
    expect(body).toContain('Read-only');
    expect(body).toMatch(/may \*\*not\*\* run `adr new`/);
  });
});
