/**
 * @adrkit/mcp — the `get_decision_context` tool (US2, contracts/tools.md §6).
 *
 * Reports governing, active-proposal, and historical records for logical file
 * paths using the existing `resolveAffects` resolver, once per record, without ever
 * reading a caller-supplied path. One canonical flat walk is paginated, then the
 * page is partitioned by status.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveAffects, type Adr, type Finding, type FiredMatcher } from '@adrkit/core';
import { compareCodeUnits, sortFindingsCanonical } from '../corpus/ordering.ts';
import { paginate, queryShapeHash } from '../pagination/cursor.ts';
import {
  ANNOTATIONS,
  corpusHealthOf,
  getDecisionContextInputSchema,
  getDecisionContextOutputSchema,
  invalidCursor,
  loadProjection,
  renderResponseText,
  structuredResult,
  toRelationRefs,
  toSummary,
  type ContextEntry,
  type GetDecisionContextResult,
  type ToolConfig,
} from './shared.ts';

interface GetDecisionContextArgs {
  readonly files: string[];
  readonly cursor?: string;
  readonly limit: number;
  readonly findingsCursor?: string;
  readonly findingsLimit: number;
}

type Bucket = 'governing' | 'activeProposals' | 'history';

function bucketFor(status: string): Bucket {
  if (status === 'accepted') return 'governing';
  if (status === 'draft' || status === 'proposed') return 'activeProposals';
  return 'history';
}

function contextEntry(record: Adr, firedMatchers: readonly FiredMatcher[]): ContextEntry {
  return { ...toSummary(record), firedMatchers, relations: toRelationRefs(record.frontmatter) };
}

export function registerGetDecisionContext(server: McpServer, config: ToolConfig): void {
  server.registerTool(
    'get_decision_context',
    {
      title: 'Get decision context for files',
      description:
        'Given repo-relative logical file paths, report which decisions govern them, which active proposals touch them, and which historical records once did — using the corpus\u2019s own affects matchers. The supplied paths are compared against patterns only; they are never opened or read.',
      inputSchema: getDecisionContextInputSchema(),
      outputSchema: getDecisionContextOutputSchema(),
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const { files, cursor, limit, findingsCursor, findingsLimit } = args as GetDecisionContextArgs;

      const loaded = await loadProjection(config);
      if (!loaded.ok) {
        return structuredResult(
          loaded.outcome,
          renderResponseText({ kind: 'corpus-unavailable', reason: loaded.outcome.reason }),
          undefined,
        );
      }
      const projection = loaded.projection;
      const health = corpusHealthOf(projection);
      const fp = projection.fingerprint;

      const canonicalFiles = [...new Set(files)].sort(compareCodeUnits);
      const primaryQh = queryShapeHash([canonicalFiles, limit]);
      const findingsQh = queryShapeHash([canonicalFiles, findingsLimit]);

      // Once per record, in canonical order. Derived findings are concatenated.
      const flat: ContextEntry[] = [];
      const derivedFindings: Finding[] = [];
      for (const record of projection.records) {
        const resolved = resolveAffects({ records: [record], changedFiles: files });
        derivedFindings.push(...resolved.findings);
        const match = resolved.matches[0];
        if (match) flat.push(contextEntry(record, match.firedMatchers));
      }

      const responseFindings = sortFindingsCanonical([...projection.corpusFindings, ...derivedFindings]);

      const primary = paginate({ items: flat, cursor, limit, scope: 'context.results', fp, qh: primaryQh });
      if (!primary.ok) return invalid(primary.reason);
      const findingsPage = paginate({
        items: responseFindings,
        cursor: findingsCursor,
        limit: findingsLimit,
        scope: 'context.findings',
        fp,
        qh: findingsQh,
      });
      if (!findingsPage.ok) return invalid(findingsPage.reason);

      const governing: ContextEntry[] = [];
      const activeProposals: ContextEntry[] = [];
      const history: ContextEntry[] = [];
      for (const entry of primary.page.items) {
        const target = bucketFor(entry.status) === 'governing' ? governing : bucketFor(entry.status) === 'activeProposals' ? activeProposals : history;
        target.push(entry);
      }

      const result: GetDecisionContextResult = {
        outcome: 'matches',
        governing,
        activeProposals,
        history,
        cursor: primary.page.cursor,
        findings: findingsPage.page,
      };
      return structuredResult(
        result,
        renderResponseText({
          kind: 'matches',
          governing: governing.length,
          activeProposals: activeProposals.length,
          history: history.length,
          findings: findingsPage.page.items.length,
        }),
        health,
      );

      function invalid(reason: Parameters<typeof invalidCursor>[0]) {
        return structuredResult(invalidCursor(reason), renderResponseText({ kind: 'invalid-cursor', reason }), health);
      }
    },
  );
}
