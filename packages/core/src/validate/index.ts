import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import {
  parseAdrFile,
  expandRecordInputs,
  compareByDisplayPath,
  discoverSkippedMarkdownFiles,
  normalizeDisplayPath,
  type SkippedMarkdownFile,
} from '../load/corpus.ts';
import type { Adr } from '../schema/adr.schema.ts';
import { FrontmatterError } from '../parse/frontmatter.ts';
import { compareCodeUnits } from '../ordering/index.ts';
import { validateParsedAdr } from './contract.ts';
import { validateCorpusInvariants } from './corpus-invariants.ts';
import { validateImportIncomplete } from './import-incomplete.ts';
import { sortFindings, type Finding } from './findings.ts';

export interface LintCorpusOptions {
  dir?: string;
  paths?: string[];
  cwd?: string;
}

export interface LintCorpusResult {
  checked: number;
  findings: Finding[];
  records: Adr[];
}

function parseErrorFinding(error: unknown, path: string): Finding {
  if (error instanceof FrontmatterError) {
    return {
      rule: error.code === 'invalid-yaml' ? 'frontmatter-parse' : 'frontmatter-fence',
      severity: 'error',
      message: error.message,
      path,
      field: 'frontmatter',
    };
  }

  return {
    rule: 'file-read',
    severity: 'error',
    message: error instanceof Error ? error.message : String(error),
    path,
  };
}

/**
 * Warn about markdown under a scanned corpus directory that discovery skipped. Without
 * this a corpus whose records are all misnamed — or all tucked into a subdirectory —
 * lints as `checked 0 records, 0 errors` at exit 0: a false clean bill of health for a
 * corpus that governs nothing (#41).
 */
function skippedFileFinding(skipped: SkippedMarkdownFile, cwd: string): Finding {
  const message =
    skipped.reason === 'nested'
      ? 'Markdown file is in a subdirectory of the corpus, and discovery reads only the top level of the corpus directory; move it to the corpus root as <id>-<slug>.md for it to be linted and enforced'
      : 'Markdown file in the corpus directory is not a discoverable ADR record and was skipped; rename it to <id>-<slug>.md (four or more leading digits) for it to be linted and enforced';
  return {
    rule: 'corpus-file-skipped',
    severity: 'warn',
    message,
    path: normalizeDisplayPath(skipped.path, cwd),
  };
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );
}

/**
 * The directories a run actually scans: the corpus `dir` when no paths were given, and
 * otherwise every positional that is a directory. `expandRecordInputs` expands those
 * through `discoverAdrFiles`, which drops misnamed children — so `adr lint docs/adr`
 * needs the same skipped-file reporting a bare `adr lint` gets. Explicit *file*
 * positionals are the caller's own choice and are never reported as skipped.
 */
async function scannedDirectories(
  paths: string[] | undefined,
  dir: string,
  cwd: string,
): Promise<string[]> {
  if (!paths || paths.length === 0) return [dir];

  const directories = new Set<string>();
  for (const path of paths) {
    const absolutePath = isAbsolute(path) ? path : resolve(cwd, path);
    if (await isDirectory(absolutePath)) directories.add(absolutePath);
  }
  return [...directories].sort((a, b) => compareByDisplayPath(a, b, cwd));
}

export async function lintCorpus(options: LintCorpusOptions = {}): Promise<LintCorpusResult> {
  const cwd = options.cwd ?? process.cwd();
  const dir = options.dir ?? 'docs/adr';
  const files = await expandRecordInputs(options.paths, dir, cwd);
  const records: Adr[] = [];
  const findings: Finding[] = [];

  for (const file of files) {
    const displayPath = normalizeDisplayPath(file, cwd);
    try {
      const parsed = await parseAdrFile(file, cwd);
      const result = validateParsedAdr(parsed);
      findings.push(...result.findings);
      if (result.record) {
        records.push(result.record);
      }
    } catch (error) {
      findings.push(parseErrorFinding(error, displayPath));
    }
  }

  // Every directory this run scans, so an explicit directory positional gets the same
  // reporting a bare corpus scan does.
  const checkedPaths = new Set(files);
  for (const scanned of await scannedDirectories(options.paths, dir, cwd)) {
    for (const skipped of await discoverSkippedMarkdownFiles(scanned, cwd)) {
      if (!checkedPaths.has(skipped.path)) findings.push(skippedFileFinding(skipped, cwd));
    }
  }

  findings.push(...validateImportIncomplete(records));
  findings.push(...validateCorpusInvariants(records));

  return {
    checked: files.length,
    findings: sortFindings(findings),
    // `records` is a public surface of `LintCorpusResult` and the input `checkChanges`
    // reads, so its order is locale-independent too. For equal ids this comparison is a
    // no-op and the stable sort preserves `discoverAdrFiles`' order, which is what makes
    // the duplicate-id decision in `toGoverningDecisions` deterministic (#115).
    records: [...records].sort((a, b) => compareCodeUnits(a.frontmatter.id, b.frontmatter.id)),
  };
}
