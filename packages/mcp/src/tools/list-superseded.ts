/**
 * @adrkit/mcp — the `list_superseded` tool (US4, contracts/tools.md §7).
 *
 * Lists every superseded record with its DIRECT local replacement state, resolving
 * only unqualified local targets through the fresh `byId` bucket. Never walks
 * lineage, never embeds candidate arrays, and mints only the two specified derived
 * finding templates.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseAdrRef, type Adr, type Finding } from '@adrkit/core';
import { sortFindingsCanonical } from '../corpus/ordering.ts';
import { paginate, queryShapeHash } from '../pagination/cursor.ts';
import {
  ANNOTATIONS,
  corpusHealthOf,
  invalidCursor,
  loadProjection,
  renderResponseText,
  listSupersededInputSchema,
  listSupersededOutputSchema,
  structuredResult,
  toSummary,
  type ListSupersededResult,
  type SupersededByState,
  type SupersededEntry,
  type ToolConfig,
} from './shared.ts';

interface ListSupersededArgs {
  readonly cursor?: string;
  readonly limit: number;
  readonly findingsCursor?: string;
  readonly findingsLimit: number;
}

interface ResolvedEntry {
  readonly entry: SupersededEntry;
  readonly derived: Finding | undefined;
}

function resolveEntry(record: Adr, byId: ReadonlyMap<string, readonly Adr[]>): ResolvedEntry {
  // The schema invariant guarantees a superseded record has supersededBy.
  const targetRef = record.frontmatter.supersededBy as string;
  const parsed = parseAdrRef(targetRef);
  const summary = toSummary(record);

  if (parsed.log !== undefined) {
    const supersededBy: SupersededByState = {
      resolved: false,
      targetRef,
      reason: 'federated-unavailable',
      log: parsed.log,
      id: parsed.id,
    };
    const derived: Finding = {
      rule: 'superseded-target-federated-unavailable',
      severity: 'info',
      id: record.frontmatter.id,
      message: `supersededBy target "${targetRef}" is a log-qualified ref; named-log federation is not available in this phase`,
    };
    return { entry: { ...summary, supersededBy }, derived };
  }

  const bucket = byId.get(parsed.id) ?? [];
  if (bucket.length === 1) {
    return { entry: { ...summary, supersededBy: { resolved: true, target: toSummary(bucket[0] as Adr) } }, derived: undefined };
  }
  if (bucket.length === 0) {
    return { entry: { ...summary, supersededBy: { resolved: false, targetRef, reason: 'dangling' } }, derived: undefined };
  }
  const supersededBy: SupersededByState = { resolved: false, targetRef, reason: 'ambiguous', candidateCount: bucket.length };
  const derived: Finding = {
    rule: 'superseded-target-ambiguous',
    severity: 'warn',
    id: record.frontmatter.id,
    message: `supersededBy target "${targetRef}" resolves to ${bucket.length} local records; see get_decision("${targetRef}") for the full candidate list`,
  };
  return { entry: { ...summary, supersededBy }, derived };
}

export function registerListSuperseded(server: McpServer, config: ToolConfig): void {
  server.registerTool(
    'list_superseded',
    {
      title: 'List superseded decisions',
      description:
        'List every superseded decision with its direct local replacement state: resolved, dangling, ambiguous (candidateCount only), or federated-unavailable. Direct edges only \u2014 no transitive lineage, no embedded candidate arrays.',
      inputSchema: listSupersededInputSchema(),
      outputSchema: listSupersededOutputSchema(),
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const { cursor, limit, findingsCursor, findingsLimit } = args as ListSupersededArgs;

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

      const entries: SupersededEntry[] = [];
      const derivedFindings: Finding[] = [];
      for (const record of projection.records) {
        if (record.frontmatter.status !== 'superseded') continue;
        const resolved = resolveEntry(record, projection.byId);
        entries.push(resolved.entry);
        if (resolved.derived) derivedFindings.push(resolved.derived);
      }

      const responseFindings = sortFindingsCanonical([...projection.corpusFindings, ...derivedFindings]);

      const primary = paginate({ items: entries, cursor, limit, scope: 'superseded.results', fp, qh: queryShapeHash([limit]) });
      if (!primary.ok) return invalid(primary.reason);
      const findingsPage = paginate({
        items: responseFindings,
        cursor: findingsCursor,
        limit: findingsLimit,
        scope: 'superseded.findings',
        fp,
        qh: queryShapeHash([findingsLimit]),
      });
      if (!findingsPage.ok) return invalid(findingsPage.reason);

      const result: ListSupersededResult = {
        outcome: 'entries',
        items: primary.page.items,
        cursor: primary.page.cursor,
        findings: findingsPage.page,
      };
      return structuredResult(
        result,
        renderResponseText({ kind: 'entries', itemsLength: primary.page.items.length, findings: findingsPage.page.items.length }),
        health,
      );

      function invalid(reason: Parameters<typeof invalidCursor>[0]) {
        return structuredResult(invalidCursor(reason), renderResponseText({ kind: 'invalid-cursor', reason }), health);
      }
    },
  );
}
