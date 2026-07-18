import type { AdrFrontmatter } from '../schema/adr.schema.ts';
import type { Finding } from '../validate/findings.ts';

export const MADR_RECOGNIZED_STATUSES = [
  'draft',
  'proposed',
  'accepted',
  'rejected',
  'superseded',
  'deprecated',
] as const satisfies readonly AdrFrontmatter['status'][];

const STATUS_SET = new Set<string>(MADR_RECOGNIZED_STATUSES);

export interface MadrStatusMapping {
  status: AdrFrontmatter['status'];
  findings: Finding[];
}

function rawStatusText(status: unknown): string | undefined {
  if (typeof status !== 'string') return undefined;
  const trimmed = status.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function mapMadrStatus(status: unknown, context: { path: string; id?: string }): MadrStatusMapping {
  const raw = rawStatusText(status);
  const normalized = raw?.toLowerCase();
  if (normalized && STATUS_SET.has(normalized)) {
    return { status: normalized as AdrFrontmatter['status'], findings: [] };
  }

  return {
    status: 'proposed',
    findings: [
      {
        rule: 'import-status-unrecognized',
        severity: 'warn',
        message: raw
          ? `MADR status "${raw}" is not recognized; using "proposed"`
          : 'MADR status is missing; using "proposed"',
        path: context.path,
        id: context.id,
        field: 'status',
      },
    ],
  };
}
