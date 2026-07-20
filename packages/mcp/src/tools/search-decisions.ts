/**
 * @adrkit/mcp — the `search_decisions` tool (US3, contracts/tools.md §5).
 *
 * Deterministic normalized literal substring search over id, title, tags, and
 * body. Filters (status any-of, scope any-of, tags all-of, ANDed) apply before the
 * normalizer. Graveyard records are included by default. Returns bounded summaries
 * only — never a body, ranking score, or hidden index.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Adr } from '@adrkit/core';
import { compareCodeUnits } from '../corpus/ordering.ts';
import { normalize } from '../search/normalize.ts';
import { paginate, queryShapeHash } from '../pagination/cursor.ts';
import {
  ANNOTATIONS,
  corpusHealthOf,
  invalidCursor,
  loadProjection,
  renderResponseText,
  searchDecisionsInputSchema,
  searchDecisionsOutputSchema,
  structuredResult,
  toSummary,
  type SearchDecisionsResult,
  type SearchMatch,
  type ToolConfig,
} from './shared.ts';

interface SearchDecisionsArgs {
  readonly query: string;
  readonly status?: string[];
  readonly tags?: string[];
  readonly scope?: string[];
  readonly cursor?: string;
  readonly limit: number;
  readonly findingsCursor?: string;
  readonly findingsLimit: number;
}

const MATCHED_FIELD_ORDER = ['body', 'id', 'tag', 'title'] as const;
type MatchedField = (typeof MATCHED_FIELD_ORDER)[number];

function sortedUnique(values: readonly string[] | undefined): string[] {
  return values ? [...new Set(values)].sort(compareCodeUnits) : [];
}

function passesFilters(record: Adr, status: string[] | undefined, scope: string[] | undefined, tags: string[] | undefined): boolean {
  if (status && !status.includes(record.frontmatter.status)) return false;
  if (scope && !scope.includes(record.frontmatter.scope)) return false;
  if (tags && !tags.every((tag) => record.frontmatter.tags.includes(tag))) return false;
  return true;
}

function matchedFields(record: Adr, needle: string): MatchedField[] {
  const fields: MatchedField[] = [];
  if (normalize(record.body).includes(needle)) fields.push('body');
  if (normalize(record.frontmatter.id).includes(needle)) fields.push('id');
  if (record.frontmatter.tags.some((tag) => normalize(tag).includes(needle))) fields.push('tag');
  if (normalize(record.frontmatter.title).includes(needle)) fields.push('title');
  return fields; // already in the fixed ['body','id','tag','title'] order
}

export function registerSearchDecisions(server: McpServer, config: ToolConfig): void {
  server.registerTool(
    'search_decisions',
    {
      title: 'Search decisions',
      description:
        'Search the decision corpus (including the graveyard by default) by deterministic normalized literal substring over id, title, tags, and Markdown body. Optional status/scope (any-of) and tags (all-of) filters are ANDed. Returns bounded summaries only \u2014 no ranking, no model, no body.',
      inputSchema: searchDecisionsInputSchema(),
      outputSchema: searchDecisionsOutputSchema(),
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const { query, status, tags, scope, cursor, limit, findingsCursor, findingsLimit } = args as SearchDecisionsArgs;

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

      const needle = normalize(query);
      const primaryQh = queryShapeHash([needle, sortedUnique(status), sortedUnique(tags), sortedUnique(scope), limit]);
      const findingsQh = queryShapeHash([findingsLimit]);

      const matches: SearchMatch[] = [];
      for (const record of projection.records) {
        if (!passesFilters(record, status, scope, tags)) continue;
        const fields = matchedFields(record, needle);
        if (fields.length === 0) continue;
        matches.push({ ...toSummary(record), matchedFields: fields });
      }

      const primary = paginate({ items: matches, cursor, limit, scope: 'search.results', fp, qh: primaryQh });
      if (!primary.ok) return invalid(primary.reason);
      const findingsPage = paginate({
        items: projection.corpusFindings,
        cursor: findingsCursor,
        limit: findingsLimit,
        scope: 'search.findings',
        fp,
        qh: findingsQh,
      });
      if (!findingsPage.ok) return invalid(findingsPage.reason);

      const result: SearchDecisionsResult = {
        outcome: 'results',
        items: primary.page.items,
        cursor: primary.page.cursor,
        findings: findingsPage.page,
      };
      return structuredResult(
        result,
        renderResponseText({ kind: 'results', itemsLength: primary.page.items.length, findings: findingsPage.page.items.length }),
        health,
      );

      function invalid(reason: Parameters<typeof invalidCursor>[0]) {
        return structuredResult(invalidCursor(reason), renderResponseText({ kind: 'invalid-cursor', reason }), health);
      }
    },
  );
}
