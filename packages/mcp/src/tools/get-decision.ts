/**
 * @adrkit/mcp — the `get_decision` tool (US1, contracts/tools.md §4).
 *
 * Fetches one within-limit decision by ref. `parseAdrRef` detects a log-qualified
 * ref first (→ federated-log-unavailable, never a local substitute); a bare id is
 * resolved through the fresh local `byId` bucket into found / not-found /
 * ambiguous-local-id. Relation refs are surfaced verbatim, never expanded.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseAdrRef, type Adr } from '@adrkit/core';
import { paginate, queryShapeHash, checkInapplicablePrimaryCursor } from '../pagination/cursor.ts';
import {
  ANNOTATIONS,
  corpusHealthOf,
  getDecisionInputSchema,
  getDecisionOutputSchema,
  invalidCursor,
  loadProjection,
  renderResponseText,
  structuredResult,
  toSummary,
  type DecisionSummary,
  type FullDecision,
  type GetDecisionResult,
  type ToolConfig,
} from './shared.ts';

interface GetDecisionArgs {
  readonly ref: string;
  readonly cursor?: string;
  readonly limit: number;
  readonly findingsCursor?: string;
  readonly findingsLimit: number;
}

function fullDecision(record: Adr, ref: string): FullDecision {
  return {
    requestedRef: ref,
    id: record.frontmatter.id,
    title: record.frontmatter.title,
    status: record.frontmatter.status,
    sourcePath: record.path,
    frontmatter: record.frontmatter,
    body: record.body,
  };
}

export function registerGetDecision(server: McpServer, config: ToolConfig): void {
  server.registerTool(
    'get_decision',
    {
      title: 'Get a decision by ref',
      description:
        'Fetch one architecture decision by its bare local id (e.g. "0042"). Returns the complete typed frontmatter and Markdown body, or an explicit not-found / ambiguous-local-id / federated-log-unavailable outcome. Relation refs are surfaced verbatim, never expanded.',
      inputSchema: getDecisionInputSchema(),
      outputSchema: getDecisionOutputSchema(),
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const { ref, cursor, limit, findingsCursor, findingsLimit } = args as GetDecisionArgs;

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
      const responseFindings = projection.corpusFindings; // get_decision derives none.

      // Findings channel (always applicable).
      const findingsPage = paginate({
        items: responseFindings,
        cursor: findingsCursor,
        limit: findingsLimit,
        scope: 'get_decision.findings',
        fp,
        qh: queryShapeHash([findingsLimit]),
      });

      const parsed = parseAdrRef(ref);
      const candidatesQh = queryShapeHash([ref, limit]);

      // Log-qualified refs are federated-log-unavailable; byId is never consulted.
      if (parsed.log !== undefined) {
        const inapplicable = checkInapplicablePrimaryCursor({ cursor, scope: 'get_decision.candidates', fp, qh: candidatesQh });
        if (!inapplicable.ok) return invalidResult(inapplicable.reason, health);
        if (!findingsPage.ok) return invalidResult(findingsPage.reason, health);
        const result: GetDecisionResult = {
          outcome: 'federated-log-unavailable',
          requestedRef: ref,
          log: parsed.log,
          id: parsed.id,
          findings: findingsPage.page,
        };
        return structuredResult(
          result,
          renderResponseText({ kind: 'federated-log-unavailable', requestedRef: ref, findings: findingsPage.page.items.length }),
          health,
        );
      }

      const bucket = projection.byId.get(parsed.id) ?? [];

      if (bucket.length > 1) {
        const candidates: DecisionSummary[] = bucket.map(toSummary);
        const primary = paginate({
          items: candidates,
          cursor,
          limit,
          scope: 'get_decision.candidates',
          fp,
          qh: candidatesQh,
        });
        if (!primary.ok) return invalidResult(primary.reason, health);
        if (!findingsPage.ok) return invalidResult(findingsPage.reason, health);
        const result: GetDecisionResult = {
          outcome: 'ambiguous-local-id',
          requestedRef: ref,
          candidates: primary.page.items,
          cursor: primary.page.cursor,
          findings: findingsPage.page,
        };
        return structuredResult(
          result,
          renderResponseText({
            kind: 'ambiguous-local-id',
            candidatesLength: primary.page.items.length,
            requestedRef: ref,
            findings: findingsPage.page.items.length,
          }),
          health,
        );
      }

      // found / not-found: the primary channel does not exist.
      const inapplicable = checkInapplicablePrimaryCursor({ cursor, scope: 'get_decision.candidates', fp, qh: candidatesQh });
      if (!inapplicable.ok) return invalidResult(inapplicable.reason, health);
      if (!findingsPage.ok) return invalidResult(findingsPage.reason, health);

      if (bucket.length === 1) {
        const record = bucket[0] as Adr;
        const result: GetDecisionResult = { outcome: 'found', decision: fullDecision(record, ref), findings: findingsPage.page };
        return structuredResult(
          result,
          renderResponseText({ kind: 'found', id: record.frontmatter.id, findings: findingsPage.page.items.length }),
          health,
        );
      }

      const result: GetDecisionResult = { outcome: 'not-found', requestedRef: ref, findings: findingsPage.page };
      return structuredResult(
        result,
        renderResponseText({ kind: 'not-found', requestedRef: ref, findings: findingsPage.page.items.length }),
        health,
      );

      function invalidResult(reason: Parameters<typeof invalidCursor>[0], corpusHealth: ReturnType<typeof corpusHealthOf>) {
        const outcome = invalidCursor(reason);
        return structuredResult(outcome, renderResponseText({ kind: 'invalid-cursor', reason }), corpusHealth);
      }
    },
  );
}
