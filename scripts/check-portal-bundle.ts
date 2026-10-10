/**
 * Fail when the decision portal that `site.yml` builds for adrkit.dev is not the
 * bundle it claims to be
 * ([ADR-0054](../docs/adr/0054-publish-a-static-decision-portal-for-github-pages-built-outside-the-cli-from-the.md)
 * action item 8, the rung-2 dogfood).
 *
 * The portal Action exiting 0 says it wrote something into `out`. It does not say
 * the page files are there, that the data file is the version-1 contract, that it
 * carries this repository's records, or that the page still loads from a subpath.
 * This checks those four things against the built directory, before upload:
 *
 * 1. `index.html`, `app.css`, `page/app.mjs`, and `portal-data.json` exist.
 * 2. `portal-data.json` parses and its `version` is exactly `"1"`.
 * 3. Its `records` count equals the record count `adr lint --json` reported for
 *    the same corpus in the same job (`checked`). The CLI is the oracle rather
 *    than a filename glob here, because a glob would restate core's record
 *    grammar, which is the drift `check:site-grammar` exists to stop. When the
 *    data file carries an error-severity issue, a mismatch is a warning: an
 *    exit-1 corpus still publishes (clause 9), and a record that does not parse
 *    can be counted by lint and absent from the portal.
 * 4. No `src` or `href` in `index.html` is root-absolute (`/…`), scheme-relative
 *    (`//…`), or absolute (`https:…`). Such a reference loads at a domain root
 *    and breaks at `/decisions/` (clause 8); relative paths and hash routes
 *    (`#/…`) work at any path.
 *
 * Imports only Node builtins.
 *
 *   bun run scripts/check-portal-bundle.ts --bundle site/dist/decisions --lint site/public/lint.json
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Files the page needs to load; a bundle missing any of them renders nothing. */
// page/app.mjs imports the two vendor modules statically (packages/portal/src/page/app.mjs);
// if either is missing the browser aborts the page module and the portal renders nothing.
export const REQUIRED_FILES = [
  'index.html',
  'app.css',
  'page/app.mjs',
  'vendor/board-layout.mjs',
  'vendor/board-view.mjs',
  'portal-data.json',
] as const;

export interface BundleReport {
  readonly problems: string[];
  readonly warnings: string[];
  /** One line for the log when there are no problems. */
  readonly summary: string;
}

/** `read(rel)` returns the file's text, or `null` when it does not exist. */
export type ReadFile = (relativePath: string) => string | null;

const ATTRIBUTE = /\b(?:src|href)\s*=\s*"([^"]*)"/gi;
/** `https:`, `data:`, `javascript:`…: anything that names a scheme is not a relative reference. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Pure: the problems and warnings for one bundle, given the CLI's record count. */
export function inspectBundle(read: ReadFile, expectedRecords: number | null): BundleReport {
  const problems: string[] = [];
  const warnings: string[] = [];

  const contents = new Map<string, string>();
  for (const file of REQUIRED_FILES) {
    const text = read(file);
    if (text === null) problems.push(`${file} is missing from the bundle`);
    else contents.set(file, text);
  }

  const html = contents.get('index.html');
  if (html !== undefined) {
    for (const match of html.matchAll(ATTRIBUTE)) {
      const value = match[1] as string;
      if (value.startsWith('/') || SCHEME.test(value)) {
        problems.push(`index.html references "${value}", which is not relative or a hash route; it breaks at a subpath`);
      }
    }
  }

  let summary = '';
  const raw = contents.get('portal-data.json');
  if (raw !== undefined) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      problems.push('portal-data.json does not parse as JSON');
    }
    if (data !== undefined) {
      const record = (data ?? {}) as { version?: unknown; records?: unknown; issues?: unknown; commit?: unknown };
      if (record.version !== '1') {
        problems.push(`portal-data.json has version ${JSON.stringify(record.version)}, expected "1"`);
      }
      if (!Array.isArray(record.records)) {
        problems.push('portal-data.json has no records array');
      } else if (expectedRecords === null) {
        problems.push('no record count from adr lint to compare against; the corpus report was not published');
      } else if (record.records.length !== expectedRecords) {
        const hasErrors =
          Array.isArray(record.issues) &&
          record.issues.some((issue) => (issue as { severity?: unknown } | null)?.severity === 'error');
        const message = `portal-data.json has ${record.records.length} record(s); adr lint checked ${expectedRecords}`;
        if (hasErrors) warnings.push(`${message} (the corpus has error findings, so a record can be absent)`);
        else problems.push(message);
      }
      if (Array.isArray(record.records)) {
        const commit = typeof record.commit === 'string' ? record.commit : 'no commit';
        summary = `version ${JSON.stringify(record.version)}, ${record.records.length} record(s), ${commit}`;
      }
    }
  }

  return { problems, warnings, summary };
}

/** The integer `checked` of an `adr lint --json` report, or `null`. */
export function lintRecordCount(text: string | null): number | null {
  if (text === null) return null;
  try {
    const checked = (JSON.parse(text) as { checked?: unknown } | null)?.checked;
    return typeof checked === 'number' && Number.isSafeInteger(checked) && checked >= 0 ? checked : null;
  } catch {
    return null;
  }
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`check-portal-bundle: ${name} <path> is required`);
    process.exit(2);
  }
  return value;
}

if (import.meta.main) {
  const bundle = argument('--bundle');
  const lint = argument('--lint');
  const report = inspectBundle((rel) => readOrNull(join(bundle, rel)), lintRecordCount(readOrNull(lint)));
  for (const warning of report.warnings) console.log(`::warning::check-portal-bundle: ${warning}`);
  if (report.problems.length > 0) {
    for (const problem of report.problems) console.error(`check-portal-bundle: ${problem}`);
    process.exit(1);
  }
  console.log(`check-portal-bundle: ok — ${bundle}: ${report.summary}`);
}
