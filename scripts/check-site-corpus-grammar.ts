/**
 * Fail when `site/scripts/gen-adr-pages.ts`'s copy of the corpus grammar drifts
 * from `packages/core/src/load/corpus.ts`.
 *
 * `site/` is deliberately not a workspace member (ADR-0011), so the generator
 * cannot import the loader and restates two of its constants instead. A comment
 * asking the next person to "keep them in step" is not a mechanism: when core's
 * pattern or skip-list changes, nothing fails, and the site silently becomes a
 * second opinion about what a record is — publishing a page for a file core
 * skips, or refusing to build over a filename core accepts, which also blocks
 * the deploy that republishes the canonical schema.
 *
 * This is the same shape of guard, in the same place, as
 * `scripts/check-doc-cli-versions.ts`: a root-side script that reaches into
 * `site/` to compare a derived copy against its source of truth, so the site
 * stays standalone while the copy stays honest. ADR-0011's decision bullets 2-3
 * establish the convention for the schema; this applies it to the grammar.
 *
 *   bun run scripts/check-site-corpus-grammar.ts
 *
 * The one intentional divergence is asserted rather than ignored: the site
 * renders `0000-template.md` as a page, so its
 * `isConventionalNonRecordFileName` must NOT treat the template as a non-record,
 * while core's must. If that ever converges, this fails and says so.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  RECORD_FILE_PATTERN,
  TEMPLATE_FILE_NAME,
  isConventionalNonRecordFileName as coreIsConventionalNonRecordFileName,
} from '../packages/core/src/load/corpus.ts';

const SITE_SCRIPT = join(import.meta.dir, '..', 'site', 'scripts', 'gen-adr-pages.ts');

interface Problem {
  what: string;
  detail: string;
}

/**
 * Extract the literals the site restates. Parsing the source rather than
 * importing it keeps this guard honest about what a reader of that file sees —
 * importing would resolve whatever the module evaluates to and could pass while
 * the visible literal says something else.
 */
export function readSiteGrammar(source: string): {
  pattern?: string;
  nonRecordNames?: string[];
  templateClause: boolean;
} {
  const pattern = /^const RECORD_FILE_PATTERN = (\/.*\/);$/m.exec(source)?.[1];
  const namesRaw = /^const NON_RECORD_FILE_NAMES = new Set\(\[([^\]]*)\]\);$/m.exec(source)?.[1];
  const nonRecordNames = namesRaw
    ?.split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter((entry) => entry.length > 0);
  // Does the site's copy of the predicate carry core's template clause?
  const fn = /function isConventionalNonRecordFileName\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(source)?.[1] ?? '';
  return { pattern, nonRecordNames, templateClause: fn.includes('TEMPLATE_FILE_NAME') };
}

function main(): void {
  const source = readFileSync(SITE_SCRIPT, 'utf8');
  const site = readSiteGrammar(source);
  const problems: Problem[] = [];

  if (site.pattern === undefined) {
    problems.push({
      what: 'RECORD_FILE_PATTERN not found',
      detail: 'expected a top-level `const RECORD_FILE_PATTERN = /…/;` in the site script',
    });
  } else if (site.pattern !== RECORD_FILE_PATTERN.toString()) {
    problems.push({
      what: 'RECORD_FILE_PATTERN differs',
      detail: `core ${RECORD_FILE_PATTERN.toString()} vs site ${site.pattern}`,
    });
  }

  // Core's skip-list is not exported, so compare through its predicate: every
  // name the site skips, core must also skip.
  if (site.nonRecordNames === undefined) {
    problems.push({
      what: 'NON_RECORD_FILE_NAMES not found',
      detail: 'expected a top-level `const NON_RECORD_FILE_NAMES = new Set([…]);` in the site script',
    });
  } else {
    for (const name of site.nonRecordNames) {
      if (!coreIsConventionalNonRecordFileName(name)) {
        problems.push({
          what: `site skips '${name}' but core does not`,
          detail: 'the site would omit a file core treats as a record',
        });
      }
    }
    for (const name of ['readme.md', 'index.md', 'contributing.md', 'template.md']) {
      if (coreIsConventionalNonRecordFileName(name) && !site.nonRecordNames.includes(name)) {
        problems.push({
          what: `core skips '${name}' but the site does not`,
          detail: 'the site would publish a page for conventional corpus documentation',
        });
      }
    }
  }

  // The intentional divergence, asserted in both directions.
  if (!coreIsConventionalNonRecordFileName(TEMPLATE_FILE_NAME)) {
    problems.push({
      what: 'core no longer treats the template as a non-record',
      detail: `core's isConventionalNonRecordFileName('${TEMPLATE_FILE_NAME}') is now false; the documented divergence in the site script is stale`,
    });
  }
  if (site.templateClause) {
    problems.push({
      what: 'the site now skips the template',
      detail:
        'gen-adr-pages.ts renders 0000-template.md as a page; adding core\'s template clause removes that page',
    });
  }

  if (problems.length > 0) {
    console.error(
      `check-site-corpus-grammar: ${problems.length} divergence(s) between\n` +
        '  packages/core/src/load/corpus.ts (source of truth)\n' +
        '  site/scripts/gen-adr-pages.ts (copy)\n',
    );
    for (const p of problems) console.error(`  ✗ ${p.what}\n      ${p.detail}`);
    console.error('\nUpdate the copy, or update this guard if the divergence is intended.');
    process.exit(1);
  }

  console.log(
    `check-site-corpus-grammar: ok — pattern ${RECORD_FILE_PATTERN.toString()} and ` +
      `${site.nonRecordNames?.length ?? 0} skipped name(s) match core, ` +
      'and the template divergence is intact.',
  );
}

if (import.meta.main) {
  main();
}
