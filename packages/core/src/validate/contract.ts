import type { z } from 'zod';
import { AdrFrontmatter, type Adr } from '../schema/adr.schema.ts';
import type { ParsedAdrFile } from '../load/corpus.ts';
import type { Finding } from './findings.ts';

export interface ContractValidationResult {
  record?: Adr;
  findings: Finding[];
}

function fieldPath(path: readonly PropertyKey[]): string | undefined {
  return path.length === 0 ? undefined : path.map(String).join('.');
}

function rawId(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'id' in data) {
    const id = (data as { id?: unknown }).id;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}

function ruleForIssue(issue: z.core.$ZodIssue): string {
  if (issue.code === 'unrecognized_keys') {
    return 'strict-unknown-key';
  }

  if (issue.code === 'custom') {
    if (issue.message === 'status "superseded" requires supersededBy') {
      return 'superseded-requires-supersededBy';
    }
    if (issue.message === 'supersededBy is set but status is not "superseded"') {
      return 'supersededBy-requires-superseded-status';
    }
    if (issue.message === 'an accepted decision must name at least one decider, unless it was imported') {
      return 'accepted-requires-decider-unless-imported';
    }
    if (
      issue.message ===
      'an agent-authored record cannot reach "accepted" without a named human ratifier'
    ) {
      return 'agent-accepted-requires-ratifier';
    }
    if (issue.message === 'one-way-door decisions may not take the auto-approve fast path') {
      return 'one-way-door-disallows-auto';
    }
    if (issue.message === 'Items must be unique') {
      return 'unique-items';
    }
    return 'contract-refinement';
  }

  if (issue.code === 'invalid_type') {
    return issue.message.includes('undefined') ? 'required-field' : 'invalid-type';
  }

  if (issue.code === 'invalid_value') {
    return 'invalid-enum-value';
  }

  if (issue.code === 'invalid_format') {
    return 'invalid-format';
  }

  if (issue.code === 'too_small' || issue.code === 'too_big') {
    return 'invalid-size';
  }

  return `contract-${issue.code}`;
}

function issueFindings(issue: z.core.$ZodIssue, path: string, id?: string): Finding[] {
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({
      rule: 'strict-unknown-key',
      severity: 'error' as const,
      message: `Unknown frontmatter field "${key}" is not allowed`,
      path,
      id,
      field: key,
    }));
  }

  return [
    {
      rule: ruleForIssue(issue),
      severity: 'error',
      message: issue.message,
      path,
      id,
      field: fieldPath(issue.path),
    },
  ];
}

export function validateParsedAdr(parsed: ParsedAdrFile): ContractValidationResult {
  const result = AdrFrontmatter.safeParse(parsed.data);
  if (result.success) {
    return {
      findings: [],
      record: {
        frontmatter: result.data,
        body: parsed.body,
        path: parsed.path,
      },
    };
  }

  const id = rawId(parsed.data);
  return {
    findings: result.error.issues.flatMap((issue) => issueFindings(issue, parsed.path, id)),
  };
}

export function validateAdrFrontmatter(data: unknown, path: string): ContractValidationResult {
  return validateParsedAdr({ data, body: '', path, absolutePath: path });
}
