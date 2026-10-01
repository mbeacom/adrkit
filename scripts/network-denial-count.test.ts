/**
 * The network-denial step count is checked, not generated (ADR-0040, action item 7).
 *
 * `clean-clone-builds` runs every post-install step but one through
 * `scripts/run-network-denied.ts`, and four documents in `specs/010-catalog-backstage/`
 * say how many. That count drifted twice, both times because a step was added to the
 * job and nobody re-counted. The sentences are hand-written requirement and evidence
 * prose, so they are not generated. A count that disagrees with the workflow fails here
 * instead.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Step {
  name?: string;
  run?: string;
}

const ROOT = join(import.meta.dir, '..');
const WORKFLOW = Bun.YAML.parse(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')) as {
  jobs: Record<string, { steps: Step[] }>;
};

const STEPS = WORKFLOW.jobs['clean-clone-builds']!.steps;
const INSTALL = STEPS.findIndex((step) => /bun install --frozen-lockfile/.test(step.run ?? ''));
const POST_INSTALL = STEPS.slice(INSTALL + 1);
const isWrapped = (step: Step) => /run-network-denied\.ts/.test(step.run ?? '');
const ACTUAL = {
  total: POST_INSTALL.length,
  wrapped: POST_INSTALL.filter(isWrapped).length,
};

/** Every document that states the count. Adding a restatement means adding it here. */
const STATEMENTS = [
  'specs/010-catalog-backstage/evidence/observed-failing-register.md',
  'specs/010-catalog-backstage/evidence/negative-cases/clean-clone-offline/README.md',
  'specs/010-catalog-backstage/spec.md',
  'specs/010-catalog-backstage/tasks.md',
];

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
  'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five'];

function numeral(token: string): number {
  const lower = token.toLowerCase();
  if (/^\d+$/.test(lower)) return Number(lower);
  const index = WORDS.indexOf(lower);
  if (index === -1) throw new Error(`"${token}" is not a count this check can read; extend WORDS`);
  return index;
}

interface Claim {
  text: string;
  total: number;
  wrapped: number;
}

/** Bold markers and line breaks are presentation; strip them before reading claims. */
function claims(source: string): Claim[] {
  const prose = source.replace(/\*\*/g, '').replace(/\s+/g, ' ');
  const found: Claim[] = [];
  const N = '([A-Za-z-]+|\\d+)';
  // "sixteen of the seventeen post-install steps", "16 of the 17 post-install steps",
  // "sixteen of its seventeen post-install steps"
  for (const m of prose.matchAll(new RegExp(`\\b${N} of (?:the|its) ${N} post-install steps`, 'gi'))) {
    found.push({ text: m[0], wrapped: numeral(m[1]!), total: numeral(m[2]!) });
  }
  // "has seventeen post-install steps. Sixteen run through"
  for (const m of prose.matchAll(new RegExp(`\\bhas ${N} post-install steps\\. ${N} run through`, 'gi'))) {
    found.push({ text: m[0], total: numeral(m[1]!), wrapped: numeral(m[2]!) });
  }
  // "One post-install step of seventeen is not network-denied"
  for (const m of prose.matchAll(new RegExp(`\\b${N} post-install step of ${N} is not network-denied`, 'gi'))) {
    const total = numeral(m[2]!);
    found.push({ text: m[0], total, wrapped: total - numeral(m[1]!) });
  }
  return found;
}

describe('the network-denial step count', () => {
  test('the workflow has exactly one unwrapped post-install step, and it is bun test', () => {
    expect(INSTALL).toBeGreaterThanOrEqual(0);
    const unwrapped = POST_INSTALL.filter((step) => !isWrapped(step));
    expect(unwrapped.map((step) => step.run?.trim())).toEqual(['bun test']);
  });

  for (const path of STATEMENTS) {
    test(`${path} states the count the workflow has (${ACTUAL.wrapped} of ${ACTUAL.total})`, () => {
      const found = claims(readFileSync(join(ROOT, path), 'utf8'));
      // A reworded sentence must not turn this into a check of nothing.
      expect(found.length).toBeGreaterThan(0);
      for (const claim of found) {
        expect({ claim: claim.text, total: claim.total, wrapped: claim.wrapped }).toEqual({
          claim: claim.text,
          ...ACTUAL,
        });
      }
    });
  }
});
