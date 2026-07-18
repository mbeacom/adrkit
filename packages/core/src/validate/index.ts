import { parseAdrFile, expandRecordInputs, normalizeDisplayPath } from '../load/corpus.ts';
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

export async function lintCorpus(options: LintCorpusOptions = {}): Promise<LintCorpusResult> {
  const cwd = options.cwd ?? process.cwd();
  const files = await expandRecordInputs(options.paths, options.dir ?? 'docs/adr', cwd);
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

  findings.push(...validateImportIncomplete(records));
  findings.push(...validateCorpusInvariants(records));

  return {
    checked: files.length,
    findings: sortFindings(findings),
    records: [...records].sort((a, b) => a.frontmatter.id.localeCompare(b.frontmatter.id)),
  };
}
