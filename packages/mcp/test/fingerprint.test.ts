import { afterEach, describe, expect, test } from 'bun:test';
import { createRepo, writeRecords, toolConfig, type TempRepo } from './helpers.ts';
import { loadCorpusProjection } from '../src/corpus/projection.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function fingerprintOf(repo: TempRepo): Promise<string> {
  const projection = await loadCorpusProjection(await toolConfig(repo.root, repo.dir));
  return projection.fingerprint;
}

async function repoWith(name: string, content: string): Promise<TempRepo> {
  const repo = await createRepo();
  cleanups.push(repo.cleanup);
  await writeRecords(repo, { [name]: content });
  return repo;
}

const ORDERED = `---
schemaVersion: 0.1.0
id: "0001"
title: Same decision
status: accepted
date: 2026-01-01
deciders:
  - "@maintainer"
tags:
  - alpha
  - beta
---

# Same decision

Body text stays byte-for-byte.
`;

// Different YAML byte layout (key order, quoting, flow vs block) — SAME parsed frontmatter.
const RESERIALIZED = `---
date: 2026-01-01
status: accepted
title: "Same decision"
id: "0001"
schemaVersion: "0.1.0"
deciders: ["@maintainer"]
tags: [alpha, beta]
---

# Same decision

Body text stays byte-for-byte.
`;

describe('corpus fingerprint (research §R6)', () => {
  test('is byte-identical across two loads of an unchanged corpus', async () => {
    const repo = await repoWith('0001-same-decision.md', ORDERED);
    expect(await fingerprintOf(repo)).toBe(await fingerprintOf(repo));
  });

  test('is stable across a YAML-only reserialization that parses identically', async () => {
    const a = await repoWith('0001-same-decision.md', ORDERED);
    const b = await repoWith('0001-same-decision.md', RESERIALIZED);
    expect(await fingerprintOf(a)).toBe(await fingerprintOf(b));
  });

  test('changes when the body changes', async () => {
    const a = await repoWith('0001-same-decision.md', ORDERED);
    const b = await repoWith('0001-same-decision.md', ORDERED.replace('byte-for-byte', 'DIFFERENT'));
    expect(await fingerprintOf(a)).not.toBe(await fingerprintOf(b));
  });

  test('changes when the source path changes', async () => {
    const a = await repoWith('0001-same-decision.md', ORDERED);
    const b = await repoWith('0001-renamed-decision.md', ORDERED);
    expect(await fingerprintOf(a)).not.toBe(await fingerprintOf(b));
  });

  test('changes when a parsed frontmatter field changes (tag order)', async () => {
    const a = await repoWith('0001-same-decision.md', ORDERED);
    const b = await repoWith('0001-same-decision.md', ORDERED.replace('  - alpha\n  - beta', '  - beta\n  - alpha'));
    expect(await fingerprintOf(a)).not.toBe(await fingerprintOf(b));
  });

  test('changes when a corpus finding is added (a duplicate id)', async () => {
    const a = await repoWith('0001-same-decision.md', ORDERED);
    const b = await createRepo();
    cleanups.push(b.cleanup);
    await writeRecords(b, {
      '0001-same-decision.md': ORDERED,
      '0001-duplicate.md': ORDERED.replace('title: Same decision', 'title: Duplicate holder'),
    });
    expect(await fingerprintOf(a)).not.toBe(await fingerprintOf(b));
  });
});
