import { parseAdrFile, expandRecordInputs, discoverSkippedMarkdownFiles, normalizeDisplayPath } from '../load/corpus.ts';
import type { Adr } from '../schema/adr.schema.ts';
import { FrontmatterError } from '../parse/frontmatter.ts';
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
 * Warn about markdown in the corpus directory that discovery skipped. Without this a
 * corpus whose records are all misnamed lints as `checked 0 records, 0 errors` at exit
 * 0 — a false clean bill of health for a corpus that governs nothing (#41).
 */
function skippedFileFinding(path: string): Finding {
  return {
    rule: 'corpus-file-skipped',
    severity: 'warn',
    message:
      'Markdown file in the corpus directory is not a discoverable ADR record and was skipped; rename it to <id>-<slug>.md (four or more leading digits) for it to be linted and enforced',
    path,
  };
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

  // Only when scanning the corpus directory. Explicit paths are the caller's choice,
  // so nothing there was "skipped".
  if (!options.paths || options.paths.length === 0) {
    for (const skipped of await discoverSkippedMarkdownFiles(dir, cwd)) {
      findings.push(skippedFileFinding(normalizeDisplayPath(skipped, cwd)));
    }
  }

  findings.push(...validateImportIncomplete(records));
  findings.push(...validateCorpusInvariants(records));

  return {
    checked: files.length,
    findings: sortFindings(findings),
    records: [...records].sort((a, b) => a.frontmatter.id.localeCompare(b.frontmatter.id)),
  };
}
