import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Status, SCHEMA_VERSION, AdrFrontmatter } from '../schema/adr.schema.ts';
import { discoverAdrFiles, loadAdrFile, normalizeDisplayPath } from '../load/corpus.ts';

export interface NewAdrOptions {
  title: string;
  status?: string;
  dir?: string;
  cwd?: string;
  date?: string;
  write?: boolean;
}

export interface NewAdrResult {
  id: string;
  path: string;
  content: string;
}

export class ScaffoldError extends Error {
  readonly code: 'usage' | 'exists';

  constructor(code: 'usage' | 'exists', message: string) {
    super(message);
    this.name = 'ScaffoldError';
    this.code = code;
  }
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function slugifyTitle(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (!slug) {
    throw new ScaffoldError('usage', 'Title must contain at least one ASCII letter or digit');
  }

  return slug.slice(0, 80).replace(/-+$/g, '');
}

function statusForInput(input: string | undefined): string {
  const status = input ?? 'draft';
  const parsed = Status.safeParse(status);
  if (!parsed.success) {
    throw new ScaffoldError('usage', `Invalid status "${status}"`);
  }
  if (status === 'accepted' || status === 'superseded') {
    throw new ScaffoldError(
      'usage',
      `adr new cannot scaffold status "${status}" without additional required fields`,
    );
  }
  return status;
}

async function nextSequentialId(dir: string, cwd: string): Promise<string> {
  const files = await discoverAdrFiles(dir, cwd).catch(() => []);
  let max = 0;
  for (const file of files) {
    try {
      const record = await loadAdrFile(file, cwd);
      if (/^[0-9]+$/.test(record.frontmatter.id)) {
        max = Math.max(max, Number(record.frontmatter.id));
      }
    } catch {
      const match = /(^|\/)([0-9]{4,})-/.exec(file);
      if (match?.[2]) {
        max = Math.max(max, Number(match[2]));
      }
    }
  }
  return String(max + 1).padStart(4, '0');
}

export function renderAdrRecord(options: {
  id: string;
  title: string;
  status: string;
  date: string;
}): string {
  const frontmatter = {
    schemaVersion: SCHEMA_VERSION,
    id: options.id,
    title: options.title,
    status: options.status,
    date: options.date,
    deciders: [],
    tags: [],
    scope: 'component',
    reversibility: 'unknown',
    blastRadius: 'component',
    relatesTo: [],
    affects: [],
    provenance: {
      authoredBy: 'human',
    },
  };

  const validation = AdrFrontmatter.safeParse(frontmatter);
  if (!validation.success) {
    throw new ScaffoldError('usage', validation.error.issues.map((issue) => issue.message).join('; '));
  }

  return `---
schemaVersion: ${frontmatter.schemaVersion}
id: "${frontmatter.id}"
title: ${JSON.stringify(frontmatter.title)}
status: ${frontmatter.status}
date: ${frontmatter.date}
deciders: []
tags: []
scope: ${frontmatter.scope}
reversibility: ${frontmatter.reversibility}
blastRadius: ${frontmatter.blastRadius}
relatesTo: []
affects: []
provenance:
  authoredBy: human
---

# ADR-${frontmatter.id}: ${frontmatter.title}

## Context

What forces are at play? What makes this a decision rather than a preference?
Why now — what changed?

State the problem, not the solution. If this section is a restatement of the
option you already picked, the record scores 2 at best on D1.

## Decision

What we are doing, in the active voice. "We will…"

## Options considered

At least two genuine alternatives, including doing nothing. An option no
competent engineer would choose is a straw man and scores zero.

### Option A: <chosen>

| Dimension | Assessment |
|---|---|
| | |

### Option B: <alternative>

**Pros:**
**Cons:**

### Option C: Do nothing

## Trade-offs

What the chosen option costs. State the downsides as plainly as the benefits —
a decision whose chosen option has no listed downsides is not a decision.

## Consequences

- Easier:
- Harder:
- **How we would know this was wrong:** a metric, a threshold, an exit
  condition, or a review date. This is the field that most separates records
  that stay alive from records that rot.
- Revisit if:

## Action items

1. [ ]
`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function createAdr(options: NewAdrOptions): Promise<NewAdrResult> {
  const cwd = options.cwd ?? process.cwd();
  const dir = options.dir ?? 'docs/adr';
  const title = options.title.trim();
  const status = statusForInput(options.status);

  if (title.length < 3 || title.length > 120) {
    throw new ScaffoldError('usage', 'Title must be between 3 and 120 characters');
  }
  if (/[\r\n]/.test(title)) {
    throw new ScaffoldError('usage', 'Title must fit on a single line');
  }

  const id = await nextSequentialId(dir, cwd);
  const fileName = `${id}-${slugifyTitle(title)}.md`;
  const path = resolve(cwd, dir, fileName);
  const displayPath = normalizeDisplayPath(path, cwd);
  const content = renderAdrRecord({ id, title, status, date: options.date ?? todayIsoDate() });

  if (await pathExists(path)) {
    throw new ScaffoldError('exists', `Refusing to overwrite existing ADR file ${displayPath}`);
  }

  if (options.write !== false) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }

  return { id, path: displayPath, content };
}
