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
  /** Set only when the source expressed status as `superseded by <ref>` (MADR 2.x). */
  supersededBy?: string;
  findings: Finding[];
}

export interface MadrStatusContext {
  path: string;
  id?: string;
  /**
   * Maps a reference scraped from a `superseded by <ref>` status into the id space of
   * the corpus being written. A scraped number belongs to the *source* project's
   * numbering, which is not the numbering migration allocates, so without a resolver
   * the form is treated as unrecognized rather than pointed at whatever record happens
   * to hold that number. Return `undefined` to reject a reference.
   */
  resolveSupersededRef?: (ref: string) => string | undefined;
}

function rawStatusText(status: unknown): string | undefined {
  if (typeof status !== 'string') return undefined;
  const trimmed = status.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * MADR 2.x writes supersession into the status itself — `superseded by [ADR-0005](…)`.
 * Recognize it only when a reference can be recovered *and* resolved, because the
 * schema requires `supersededBy` whenever status is `superseded`; an unresolvable
 * reference stays unrecognized and is reported rather than silently coerced into an
 * edge that points at the wrong record.
 */
function supersededByRef(normalized: string, context: MadrStatusContext): string | undefined {
  if (!/^superse(?:ded|des)\s+by\b/.test(normalized)) return undefined;
  const scraped = /\b(\d{4,})\b/.exec(normalized)?.[1];
  if (!scraped) return undefined;
  const resolved = context.resolveSupersededRef?.(scraped);
  // A record cannot supersede itself.
  return resolved && resolved !== context.id ? resolved : undefined;
}

export function mapMadrStatus(status: unknown, context: MadrStatusContext): MadrStatusMapping {
  const raw = rawStatusText(status);
  const normalized = raw?.toLowerCase();
  if (normalized && STATUS_SET.has(normalized)) {
    return { status: normalized as AdrFrontmatter['status'], findings: [] };
  }

  if (normalized) {
    const ref = supersededByRef(normalized, context);
    if (ref) return { status: 'superseded', supersededBy: ref, findings: [] };
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
