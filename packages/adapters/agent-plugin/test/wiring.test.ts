import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENTS,
  COMMANDS,
  SKILLS,
  frontmatterOf,
  marketplacePath,
  packageRoot,
} from './harness.ts';

function backfillPolicyViolations(body: string): string[] {
  const violations: string[] = [];
  const required: Array<readonly [string, RegExp]> = [
    ['read-only boundary', /\bread-only\b/i],
    ['statusless evidence is never accepted automatically', /(?:accepted` automatically|automatically `accepted)/i],
    ['plan artifacts remain draft', /plan[\s\S]{0,120}(?:remains|stays) `draft`/i],
    ['code is evidence, not proof', /code[\s\S]{0,160}evidence[\s\S]{0,120}not proof/i],
    ['coverage ledger', /coverage\s+ledger/i],
    ['untrusted evidence', /untrusted,\s+non-executable data/i],
    ['repository-local CLI trust confirmation', /(?:trust confirmation|confirm[\s\S]{0,80}trusted)/i],
    ['file limit', /2,000 files/i],
    ['total text limit', /16 MiB/i],
    ['per-file limit', /256 KiB/i],
    ['history limit', /500 commits/i],
    ['candidate limit', /25 candidate cards/i],
    ['custom corpus environment', /ADRKIT_DIR/],
    ['explicit corpus flag', /--dir/],
    ['option terminator', /-- <(?:quoted-)?candidate-paths\.\.\.>/],
    ['structured handoff', /backfillHandoff/],
    ['concrete candidate paths', /candidatePaths/],
    ['reconciliation snapshot', /reconciliationSnapshot/],
    ['corpus fingerprint', /corpusFingerprint/],
    ['candidate paths reject globs', /candidatePaths[\s\S]{0,160}never (?:a )?glob/i],
    ['candidate-specific snapshot', /snapshot[\s\S]{0,180}exactly[\s\S]{0,100}candidatePaths/i],
    ['history key is exact', /key is exactly `history`, never\s+`historical`/i],
    ['schema-shaped affects', /affects[\s\S]{0,160}type[\s\S]{0,100}pattern/],
    ['MCP worktree and corpus identity', /ADRKIT_MCP_CWD[\s\S]{0,240}ADRKIT_MCP_DIR[\s\S]{0,240}ADR_DIR/],
    ['scoped MADR preview', /migrate --from madr --dir "\$ADR_DIR" --dry-run/],
    // ADR-0038 as amended. These live in `required` rather than in the bootstrap
    // test alone because this checker runs against the command AND the skill:
    // `/adr-backfill` loads the command, so detection guidance that exists only
    // in the skill is unreachable from the entry point people actually invoke.
    ['bootstrap record offered, not mined', /offer,\s+not\s+a\s+candidate/i],
    [
      'bootstrap detection reads all three buckets',
      /`governing`[\s\S]{0,700}`activeProposals`[\s\S]{0,700}`history`/,
    ],
    ['bootstrap exit code precedes the buckets', /exit code before[\s\S]{0,200}bucket/i],
    [
      'adopting adrkit never supersedes the process decision',
      /never\s+a\s+supersession\s+of\s+the\s+decision\s+to\s+record\s+decisions/i,
    ],
    // Found by a functional run, not by reading: `adr new` scaffolds
    // `affects: []`, so the bootstrap record written through the offer's own
    // prescribed path binds nothing and is invisible to the detection above —
    // every bucket comes back empty and the next audit offers it again. The
    // matcher is what makes the record detectable, so the offer has to say so.
    ['bootstrap record must bind the corpus directory', /scaffolds `affects: \[\]`/],
  ];

  for (const [name, pattern] of required) {
    if (!pattern.test(body)) violations.push(`missing: ${name}`);
  }

  const forbidden: Array<readonly [string, RegExp]> = [
    ['negated read-only boundary', /\bnot read-only\b/i],
    ['automatic proposal', /automatically `proposed`/i],
    ['negated plan status', /plan[\s\S]{0,80}must not remain `draft`/i],
    ['negated code evidence', /code is not evidence/i],
    ['negated coverage ledger', /do not return a coverage ledger/i],
    ['evidence instruction execution', /\b(?:must|may|should|then)\s+follow\b/i],
    ['negated trust confirmation', /do not require trust confirmation/i],
    ['unverified MCP identity', /use MCP without confirming/i],
    ['string affects matcher', /affects:\s*\[[^\]]+\]/i],
    ['bootstrap record admitted as a candidate', /bootstrap record is (?:a |an |admitted as a )?candidate/i],
    ['adopting adrkit supersedes the process decision', /adopting adrkit supersedes/i],
    ['absence concluded from the governing bucket alone', /empty `governing` bucket alone/i],
  ];

  for (const [name, pattern] of forbidden) {
    if (pattern.test(body)) violations.push(`forbidden: ${name}`);
  }

  return violations;
}

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

  test('no command declares `allowed-tools`', () => {
    // Same hazard, one field over. `allowed-tools` was shipped on all four
    // commands carrying Copilot CLI's lowercase vocabulary (`view`, `bash`),
    // which is not Claude Code's registry (`Read`, `Bash`) and is a list where
    // opencode wants a mapping. Unlike the agent `tools:` field it was never
    // measured on those hosts, and the failure it risks is the worst kind: if
    // a host enforces the allowlist against names it does not recognize, the
    // command is granted no shell and cannot run `adr` at all. The commands run
    // without the field on every host verified, and the sibling Spec Kit
    // adapter's commands declare no such field either, so the portable choice
    // is to omit it rather than ship one host's vocabulary to all of them.
    for (const command of COMMANDS) {
      const front = frontmatterOf(
        readFileSync(join(packageRoot, 'commands', `${command}.md`), 'utf8'),
      );
      const declared = /^allowed-tools:\s*(.+)$/m.exec(front)?.[1]?.trim();
      expect({ command, declared }).toEqual({ command, declared: undefined });
    }
  });
});

describe('CLI resolution guidance', () => {
  test('the skills and the agent all name the full resolution order', () => {
    // Measured defect, not a hypothetical. In an isolated consumer repository
    // with @adrkit/cli installed as a dev dependency, the subagent tried a bare
    // `adr`, got "command not found", reported that no CLI was available, and
    // fell back to reading ADR frontmatter by hand. That fallback cannot expand
    // glob matchers, cannot read inbound `@adr` markers, and has no exit code —
    // it produces an answer that looks complete and is not. The middle entry,
    // ./node_modules/.bin/adr, is the one that was missing and the one a normal
    // dev-dependency install actually needs.
    const sources = [
      ...SKILLS.map(
        (skill) =>
          [
            `${skill}/SKILL.md`,
            join(packageRoot, 'skills', skill, 'SKILL.md'),
          ] as const,
      ),
      ['decision-checker.md', join(packageRoot, 'agents', 'decision-checker.md')],
    ];

    for (const [label, path] of sources) {
      const body = readFileSync(path, 'utf8');
      for (const entry of ['$ADRKIT_CLI', './node_modules/.bin/adr', 'PATH']) {
        expect({ label, entry, present: body.includes(entry) }).toEqual({
          label,
          entry,
          present: true,
        });
      }
    }
  });
});

describe('guidance that must not regress', () => {
  test('every command body carries the CLI resolution order', () => {
    // The skill and the agent gained this after a measured failure, but the
    // commands did not — and a slash command is injected deterministically when
    // a user types it, while the skill is only loaded when the model judges it
    // relevant. Under the documented dev-dependency install a bare `adr` is not
    // on PATH, so a command without the resolution order fails and the model is
    // free to fall back to hand-reading frontmatter.
    for (const command of COMMANDS) {
      const body = readFileSync(join(packageRoot, 'commands', `${command}.md`), 'utf8');
      for (const entry of ['$ADRKIT_CLI', './node_modules/.bin/adr', 'PATH']) {
        expect({ command, entry, present: body.includes(entry) }).toEqual({
          command,
          entry,
          present: true,
        });
      }
    }
  });

  test('no component sends the rejected-option check to list_superseded', () => {
    // Verified against packages/mcp/src/tools/list-superseded.ts, which skips
    // every record whose status is not `superseded` — it can never return a
    // `rejected` one. Pointing the "did we already rule this out?" step at it
    // yields a well-formed empty answer and a re-proposed rejected decision,
    // which is one of the three failure modes the skill exists to prevent.
    const bodies: Array<readonly [string, string]> = [
      ...COMMANDS.map((c) => [c, join(packageRoot, 'commands', `${c}.md`)] as const),
      ['SKILL.md', join(packageRoot, 'skills', 'decision-memory', 'SKILL.md')],
      ['decision-checker.md', join(packageRoot, 'agents', 'decision-checker.md')],
    ];

    for (const [label, path] of bodies) {
      const body = readFileSync(path, 'utf8');
      if (!body.includes('list_superseded')) continue;
      // Collapse wrapping and strip markdown emphasis/backticks: the disclaimer
      // legitimately spans lines and bolds the load-bearing words.
      const flat = body.replace(/[*`]/g, '').replace(/\s+/g, ' ');
      expect({ label, disclaims: /only .{0,40}superseded|never .{0,40}rejected/i.test(flat) }).toEqual({
        label,
        disclaims: true,
      });
    }
  });

  test('drafting sets agent provenance rather than inheriting the human default', () => {
    // `adr new` hard-codes `provenance.authoredBy: human` and offers no flag to
    // change it (verified by scaffolding a record with @adrkit/cli 0.8.0). An
    // agent-drafted record therefore claims a human wrote it unless corrected,
    // which also disarms `agent-accepted-requires-ratifier` — that invariant
    // only fires for `agent` / `agent-drafted`.
    for (const [label, path] of [
      ['adr-draft.md', join(packageRoot, 'commands', 'adr-draft.md')],
      ['SKILL.md', join(packageRoot, 'skills', 'decision-memory', 'SKILL.md')],
    ] as const) {
      const body = readFileSync(path, 'utf8');
      expect({ label, sets: body.includes('agent-drafted') }).toEqual({ label, sets: true });
    }
  });

  test('the check flow verifies corpus integrity before reporting nothing governs', () => {
    // `adr check` keeps findings only for the paths it was given, and a record
    // that fails to parse or validate is dropped from the corpus entirely — so
    // a malformed ADR that intends to govern the path yields "No decisions
    // govern the changed files" at exit 0. Without a lint step the guidance's
    // own "is a corpus error polluting this?" safeguard cannot fire.
    for (const [label, path] of [
      ['adr-check.md', join(packageRoot, 'commands', 'adr-check.md')],
      ['decision-checker.md', join(packageRoot, 'agents', 'decision-checker.md')],
    ] as const) {
      const body = readFileSync(path, 'utf8');
      expect({ label, lints: /adr lint/.test(body) }).toEqual({ label, lints: true });
    }
  });

  test('drafting never tells the agent to supersede the record it replaces', () => {
    // Measured against adrkit 0.8.0, not reasoned about. A drafted record is
    // `proposed`, so flipping the predecessor to `status: superseded` in the
    // same edit leaves the affected paths governed by NEITHER record:
    // `adr explain` reports "No accepted decision governs <path>". It is also
    // schema-invalid — `superseded` requires `supersededBy`, so `adr lint`
    // fails with superseded-requires-supersededBy, and the invalid record then
    // drops out of the corpus and dangles the new record's own `supersedes`
    // reference (two errors, not one). Silently un-governing a path is the
    // worst outcome a governance tool can produce, so both surfaces must keep
    // saying to leave the predecessor alone.
    const sources = [
      ['adr-draft.md', join(packageRoot, 'commands', 'adr-draft.md')],
      ['SKILL.md', join(packageRoot, 'skills', 'decision-memory', 'SKILL.md')],
    ] as const;

    for (const [label, path] of sources) {
      const body = readFileSync(path, 'utf8');
      expect({ label, names: body.includes('superseded-requires-supersededBy') }).toEqual({
        label,
        names: true,
      });
      expect({ label, defers: /ratif/i.test(body) }).toEqual({ label, defers: true });
    }
  });

  test('the unscoped check collects untracked files too', () => {
    // `git diff --name-only HEAD` reports only tracked files, so a brand-new
    // source file — the case most likely to introduce something a decision
    // governs — would be invisible, and the command would report a clean result
    // for a change it never looked at.
    const body = readFileSync(join(packageRoot, 'commands', 'adr-check.md'), 'utf8');
    expect(body).toContain('git ls-files --others --exclude-standard');
  });

  test('backfill guidance satisfies the safety policy', () => {
    const sources = [
      [
        'adr-backfill.md',
        readFileSync(join(packageRoot, 'commands', 'adr-backfill.md'), 'utf8'),
      ],
      [
        'decision-backfill/SKILL.md',
        readFileSync(join(packageRoot, 'skills', 'decision-backfill', 'SKILL.md'), 'utf8'),
      ],
    ] as const;

    for (const [label, body] of sources) {
      expect({ label, violations: backfillPolicyViolations(body) }).toEqual({
        label,
        violations: [],
      });
    }

    const command = sources[0][1];
    expect(command).not.toMatch(/\badr new\b/);
  });

  test('retained contradictory backfill guidance is rejected', () => {
    const fixture = readFileSync(
      join(packageRoot, 'test', 'fixtures', 'unsafe-backfill-guidance.md'),
      'utf8',
    );

    expect(backfillPolicyViolations(fixture)).toEqual([
      'missing: statusless evidence is never accepted automatically',
      'missing: plan artifacts remain draft',
      'missing: code is evidence, not proof',
      'missing: concrete candidate paths',
      'missing: reconciliation snapshot',
      'missing: corpus fingerprint',
      'missing: candidate paths reject globs',
      'missing: candidate-specific snapshot',
      'missing: history key is exact',
      'missing: schema-shaped affects',
      'missing: MCP worktree and corpus identity',
      'missing: bootstrap record offered, not mined',
      'missing: bootstrap detection reads all three buckets',
      'missing: bootstrap exit code precedes the buckets',
      'missing: adopting adrkit never supersedes the process decision',
      'missing: bootstrap record must bind the corpus directory',
      'forbidden: negated read-only boundary',
      'forbidden: automatic proposal',
      'forbidden: negated plan status',
      'forbidden: negated code evidence',
      'forbidden: negated coverage ledger',
      'forbidden: evidence instruction execution',
      'forbidden: negated trust confirmation',
      'forbidden: unverified MCP identity',
      'forbidden: string affects matcher',
      'forbidden: bootstrap record admitted as a candidate',
      'forbidden: adopting adrkit supersedes the process decision',
      'forbidden: absence concluded from the governing bucket alone',
    ]);
  });

  test('backfill routes every CLI operation through the resolved corpus', () => {
    for (const [label, body] of [
      [
        'adr-backfill.md',
        readFileSync(join(packageRoot, 'commands', 'adr-backfill.md'), 'utf8'),
      ],
      [
        'decision-backfill/SKILL.md',
        readFileSync(join(packageRoot, 'skills', 'decision-backfill', 'SKILL.md'), 'utf8'),
      ],
    ] as const) {
      for (const command of ['lint', 'graph', 'check', 'queue']) {
        expect({
          label,
          command,
          scoped: new RegExp(`adr ${command}[^\\n]*--dir "\\$ADR_DIR"`).test(body),
        }).toEqual({ label, command, scoped: true });
      }
      expect({ label, migration: /adr migrate --from madr --dir "\$ADR_DIR" --dry-run/.test(body) }).toEqual({
        label,
        migration: true,
      });
      expect({ label, terminator: /adr check[^\\n]*--json -- <(?:quoted-)?candidate-paths\.\.\.>/.test(body) }).toEqual({
        label,
        terminator: true,
      });
    }
  });

  test('backfill offers the bootstrap record outside the candidate handoff', () => {
    // A repository with no corpus is missing two decisions at once: to record
    // decisions at all, and to enforce them with adrkit. Neither is archaeology
    // — no source span proves a human ratified either, so both fail this
    // skill's own admission rule and cannot become evidence-backed candidates.
    // They also cannot travel through a `backfillHandoff`: the governed path is
    // the corpus directory, a glob that may not exist yet, so there are no
    // concrete `candidatePaths` to snapshot. Routing them to plain `/adr-draft`
    // is what keeps the handoff contract intact.
    const body = readFileSync(join(packageRoot, 'skills', 'decision-backfill', 'SKILL.md'), 'utf8');

    // Both surfaces, because `/adr-backfill` loads the COMMAND. The skill can
    // carry perfect guidance the entry point never reaches: an earlier revision
    // of this change edited only the skill, and the offer was unreachable from
    // the command users actually invoke. Trimming the command file must fail
    // here rather than silently drop the feature.
    const command = readFileSync(join(packageRoot, 'commands', 'adr-backfill.md'), 'utf8');
    for (const [label, text] of [['SKILL.md', body], ['adr-backfill.md', command]] as const) {
      expect({ label, offers: /bootstrap record/i.test(text) }).toEqual({ label, offers: true });
      expect({
        label,
        notACandidate: /not\s+a\s+candidate|offer,\s+not\s+a\s+candidate/i.test(text),
      }).toEqual({ label, notACandidate: true });
      expect({
        label,
        neverSupersedes: /never\s+a\s+supersession\s+of\s+the\s+decision\s+to\s+record\s+decisions/i.test(text),
      }).toEqual({ label, neverSupersedes: true });

      // Detection has to come from the CLI: this skill forbids hand-parsing
      // frontmatter, and an invalid record drops out of the parsed corpus, so a
      // grep for a meta tag can be confidently wrong. These ran against the
      // skill only until 0.3.1; the command is the entry point `/adr-backfill`
      // actually loads, so guidance it lacks is guidance nobody executes.
      expect({
        label,
        detects: /adr check --dir "\$ADR_DIR" --json/.test(text),
      }).toEqual({ label, detects: true });
      expect({
        label,
        exitBeforeBucket: /Only\s+on\s+exit\s+`0`/i.test(text),
      }).toEqual({ label, exitBeforeBucket: true });
      expect({ label, madrTrap: /unmigrated\s+MADR\s+corpus/i.test(text) }).toEqual({
        label,
        madrTrap: true,
      });

      // `governing` holds `accepted` alone. A process record that is `proposed`
      // — which is what `/adr-draft` writes, so it is the state the tool's own
      // output lands in — sits in `activeProposals`, and a `rejected` one sits
      // in `history`. Reading `governing` by itself reports both as absent and
      // offers a duplicate: backfill re-offering its own unratified output, and
      // re-proposing a decision the team explicitly abandoned.
      expect({
        label,
        readsAllThreeBuckets:
          /`governing`[\s\S]{0,700}`activeProposals`[\s\S]{0,700}`history`/.test(text),
      }).toEqual({ label, readsAllThreeBuckets: true });
      expect({
        label,
        alreadyProposed: /already\s+proposed/i.test(text),
      }).toEqual({ label, alreadyProposed: true });
      expect({
        label,
        neverRepropose: /never\s+re-propose/i.test(text),
      }).toEqual({ label, neverRepropose: true });
    }

    expect({ offered: /bootstrap record/i.test(body) }).toEqual({ offered: true });
    expect({
      excluded: /out\s+of\s+the\s+candidates\s+table\s+and\s+out\s+of\s+every\s+`backfillHandoff`/i.test(body),
    }).toEqual({ excluded: true });
    expect({ routed: /name\s+plain\s+`\/adr-draft`/i.test(body) }).toEqual({ routed: true });

    // The edge is the part that is easy to get backwards. Adopting the tool
    // depends on the decision to keep records; it can never replace it. The
    // only legitimate supersession target is a *prior tooling* record.
    expect({
      neverSupersedesProcess: /never\s+a\s+supersession\s+of\s+the\s+decision\s+to\s+record\s+decisions/i.test(body),
    }).toEqual({ neverSupersedesProcess: true });
    expect({
      supersedesPriorTooling: /prior tooling record[\s\S]{0,200}`supersedes`/i.test(body),
    }).toEqual({ supersedesPriorTooling: true });

    // A MADR corpus is migrated, not superseded.
    expect({ madrKept: /migrate --from madr[\s\S]{0,200}reverses nothing/i.test(body) }).toEqual({
      madrKept: true,
    });

    // Measured, not reasoned about: against an unmigrated MADR corpus every
    // record fails the frontmatter fence, so NOTHING parses, `governing` comes
    // back empty, and `adr check` exits 1 with `frontmatter-fence` errors — even
    // when one of those unparsed records is the process decision itself. An
    // agent that reads the empty bucket without reading the exit code first
    // offers a duplicate of a record the repository already has, which is the
    // precise failure ADR-0038 names as proof the design is wrong.
    // The corpus-wide signal, not `adr check`'s. `adr check`'s exit code is
    // scoped to the paths it was handed (ADR-0022), so a malformed process
    // record elsewhere in the corpus leaves it at `0` with an empty result.
    // Corpus-wide `adr lint` is what actually catches that.
    expect({
      corpusWideGate: /adr lint[\s\S]{0,400}exit `0`[\s\S]{0,300}before/i.test(body),
    }).toEqual({ corpusWideGate: true });
  });

  test('draft consumes a complete backfill handoff without adding a writer', () => {
    const body = readFileSync(join(packageRoot, 'commands', 'adr-draft.md'), 'utf8');
    for (const field of [
      'candidateKey',
      'title',
      'corpusDir',
      'candidatePaths',
      'sourceArtifact',
      'citations',
      'missingEvidence',
      'affects',
      'alternatives',
      'reconciliation',
      'reconciliationSnapshot',
      'corpusFingerprint',
      'statusTreatment: proposed',
    ]) {
      expect({ field, present: body.includes(field) }).toEqual({ field, present: true });
    }
    expect(body).toContain('adr check --dir "$ADR_DIR" --json -- <literal-candidatePaths...>');
    expect(body).toContain('adr queue --dir "$ADR_DIR" --format json');
    expect(body).toContain('["new", <literal-title>, "--dir", <literal-ADR_DIR>]');
    expect(body).not.toContain('adr new "<title>"');
    expect(body).toMatch(/Any difference means the handoff is stale/);
    expect(body).toMatch(/key must be exactly `history`, not\s+`historical`/);
    expect(body).toMatch(/missing any field, stop without writing/);
  });

  test('draft can write the bootstrap record into a repository with no corpus', () => {
    // The offer's whole audience is a repository with no `docs/adr/`. Routing
    // it to `/adr-draft` is only coherent if `/adr-draft` can write there.
    // Measured: `adr lint --dir docs/adr` exits `2` on a repository with no
    // corpus, and a blanket "exit `2` stops" gate therefore halts before the
    // scaffolding step -- while `adr new` on that same repository exits `0`,
    // creates the directory and allocates `0001`, because `createAdr` calls
    // mkdir recursively. The gate was blocking a capability the CLI has.
    const body = readFileSync(join(packageRoot, 'commands', 'adr-draft.md'), 'utf8');

    expect({
      absentCorpusBranch: /does not exist\s+yet|has no corpus\s+yet/i.test(body),
    }).toEqual({ absentCorpusBranch: true });
    expect({
      namesTheCreatingVerb:
        /`adr new`[\s\S]{0,240}creates?\s+(?:it|the\s+corpus\s+directory)/i.test(body),
    }).toEqual({ namesTheCreatingVerb: true });

    // The narrower gate must stay a gate: a corpus that exists and does not
    // parse is still a hard stop, because absence cannot be distinguished from
    // a parse failure there.
    expect({
      stillStopsOnUnparseableCorpus: /exit `1`[\s\S]{0,200}blocks drafting/i.test(body),
    }).toEqual({ stillStopsOnUnparseableCorpus: true });
  });
});

describe('claims match the artifact', () => {
  test('nothing shipped describes the MCP server as bundled with the plugin', () => {
    // The plugin ships no .mcp.json (see manifest.test.ts). Catalog and skill
    // copy that promises one sells functionality the artifact deliberately
    // omits, and a user would reasonably expect installing the plugin to enable
    // MCP. Both texts said exactly that before review caught it.
    const sources: Array<readonly [string, string]> = [
      ['marketplace.json', marketplacePath],
      ['SKILL.md', join(packageRoot, 'skills', 'decision-memory', 'SKILL.md')],
      ['plugin.json', join(packageRoot, '.claude-plugin', 'plugin.json')],
    ];

    for (const [label, path] of sources) {
      const text = readFileSync(path, 'utf8');
      for (const claim of [/bundled adrkit MCP/i, /and the local adrkit MCP server/i]) {
        expect({ label, claim: String(claim), found: claim.test(text) }).toEqual({
          label,
          claim: String(claim),
          found: false,
        });
      }
    }
  });
});

describe('write boundary', () => {  test('exactly one command writes, and it is adr-draft', () => {
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
