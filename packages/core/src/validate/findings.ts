export type FindingSeverity = 'error' | 'warn' | 'info';

export interface Finding {
  rule: string;
  severity: FindingSeverity;
  message: string;
  path?: string;
  id?: string;
  field?: string;
}

function compareOptional(a: string | undefined, b: string | undefined): number {
  return (a ?? '').localeCompare(b ?? '');
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      compareOptional(a.id, b.id) ||
      a.rule.localeCompare(b.rule) ||
      compareOptional(a.path, b.path) ||
      compareOptional(a.field, b.field) ||
      a.message.localeCompare(b.message),
  );
}

export function countFindings(findings: readonly Finding[]): { errors: number; warnings: number; infos: number } {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const finding of findings) {
    if (finding.severity === 'error') errors += 1;
    if (finding.severity === 'warn') warnings += 1;
    if (finding.severity === 'info') infos += 1;
  }
  return { errors, warnings, infos };
}

export function exitCodeForFindings(findings: readonly Finding[]): 0 | 1 {
  return findings.some((finding) => finding.severity === 'error') ? 1 : 0;
}
