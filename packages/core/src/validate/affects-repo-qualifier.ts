import { AFFECTS_REPO_NOT_APPLICABLE } from '../affects/index.ts';
import { compareCodeUnits } from '../ordering/index.ts';
import type { Adr } from '../schema/adr.schema.ts';
import type { Finding } from './findings.ts';

/**
 * `adr lint`'s half of #300: one advisory per record whose `affects` carries a
 * `repo`-qualified matcher.
 *
 * `adr lint` always reads a single-repository corpus, where such a matcher can never
 * apply (ADR-0059 clause 11). `adr check` and `adr explain` already report each skipped
 * matcher where they resolve a path; this finding lets a corpus-wide run surface the
 * same fact without one. It is per record rather than per matcher, carries no
 * `pattern`, and is `info`, so it never changes an exit code (ADR-0022).
 *
 * The rule id is shared with the resolver's per-matcher finding. The two can meet only
 * in `adr check` on a change to the record itself, and `pattern` tells them apart.
 */
export function validateAffectsRepoQualifiers(records: readonly Adr[]): Finding[] {
  const findings: Finding[] = [];

  for (const record of records) {
    const qualified = (record.frontmatter.affects ?? []).filter((matcher) => Boolean(matcher.repo));
    if (qualified.length === 0) continue;

    const repos = [...new Set(qualified.map((matcher) => matcher.repo as string))].sort(compareCodeUnits);
    const count = qualified.length;
    const noun = count === 1 ? 'affects matcher is' : 'affects matchers are';
    findings.push({
      rule: AFFECTS_REPO_NOT_APPLICABLE,
      severity: 'info',
      message:
        `${count} ${noun} qualified with another repository (repo ${repos.map((repo) => `"${repo}"`).join(', ')}) ` +
        'and cannot apply in a single-repository corpus; adr check and adr explain skip them, ' +
        'and they are kept for a federation that includes that repository.',
      path: record.path,
      id: record.frontmatter.id,
      field: 'affects',
    });
  }

  return findings;
}
