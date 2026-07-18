/**
 * @adrkit/core — ADR frontmatter schema
 *
 * Single source of truth for the typed half of a decision record. The JSON
 * Schema in ./adr.schema.json is generated from this file (`bun run schema:emit`)
 * so non-TS consumers — editors, CI in other languages, IDP plugins — get the
 * same contract.
 *
 * Targets Zod 4. Deliberately avoids `.brand()` and other Zod-only constructs
 * in the public shapes so the JSON Schema emit stays lossless.
 */

import { z } from 'zod';

export const SCHEMA_VERSION = '0.1.0' as const;

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

/** `@handle`, `team:platform`, or an email address. */
export const Identity = z
  .string()
  .regex(
    /^(@[A-Za-z0-9-]+|team:[a-z0-9-]+|[^@\s]+@[^@\s]+\.[^@\s]+)$/,
    'Expected @handle, team:slug, or an email address',
  );

/** `0042` (same log) or `payments:0012` (federated). */
export const AdrRef = z
  .string()
  .regex(
    /^(([a-z0-9][a-z0-9-]*):)?([0-9]{4,}|[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26})$/,
    'Expected an ADR id, optionally prefixed with a log name',
  );

/** Calendar-correct `YYYY-MM-DD`; rejects impossible dates like `2026-02-31`. */
const IsoDate = z.string().date();
const IsoDateTime = z.string().datetime({ offset: true });

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);

/**
 * Array whose items must be unique. Mirrors JSON Schema `uniqueItems: true`
 * so TS and non-TS consumers reject duplicate entries identically.
 */
const uniqueArray = <T extends z.ZodTypeAny>(item: T) =>
  z
    .array(item)
    .refine((xs) => new Set(xs.map((x) => JSON.stringify(x))).size === xs.length, {
      message: 'Items must be unique',
    })
    .meta({ uniqueItems: true });

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

/**
 * `rejected` is retained on purpose. The decision *not* to do something is the
 * one most often re-litigated, and the graveyard is where "we tried that in
 * 2023" knowledge lives.
 */
export const Status = z.enum([
  'draft',
  'proposed',
  'accepted',
  'rejected',
  'superseded',
  'deprecated',
]);

export const Scope = z.enum(['component', 'domain', 'org']);
export const Reversibility = z.enum(['two-way-door', 'one-way-door', 'unknown']);
export const BlastRadius = z.enum(['component', 'team', 'cross-team', 'org']);
export const ReviewTier = z.enum(['auto', 'async', 'arb']);
export const Severity = z.enum(['error', 'warn', 'info']);

export const EscalationReason = z.enum([
  'one-way-door',
  'cost-threshold',
  'security-surface',
  'data-residency',
  'regulatory',
  'contradicts-accepted-adr',
  'low-confidence',
  'pass-disagreement',
  'agent-authored-production',
  'novel-no-precedent',
  'human-requested',
]);

/* ------------------------------------------------------------------ *
 * affects — the hinge
 * ------------------------------------------------------------------ *
 * Without this, an ADR is a document. With it, CI can answer "which
 * decisions govern the code in this PR?" and put the answer where the
 * next decision is actually being made.
 */

export const AffectsType = z.enum([
  'path', // repo-relative glob, picomatch semantics
  'entity', // IDP catalog ref, Backstage-compatible: component:default/payments-api
  'package', // dependency, optional semver range: react@>=19
  'resource', // IaC resource type: azurerm_storage_account
  'api', // OpenAPI/AsyncAPI path or operationId
  'data', // dataset / table identifier
]);

export const AffectsMatcher = strictObject({
  type: AffectsType,
  pattern: z.string().min(1),
  /** Qualifier for federated logs. Omit for same-repo. */
  repo: z.string().optional(),
  /** Exclusions are evaluated after includes. */
  negate: z.boolean().default(false),
  note: z.string().optional(),
});

/* ------------------------------------------------------------------ *
 * assertions — optional executable guardrails
 * ------------------------------------------------------------------ */

export const Assertion = strictObject({
  id: Slug,
  description: z.string().optional(),
  engine: z.enum(['rego', 'jsonpath', 'grep', 'custom']),
  expression: z.string().optional(),
  expressionFile: z.string().optional(),
  input: z
    .enum(['source', 'iac-plan', 'sbom', 'openapi', 'catalog', 'custom'])
    .default('source'),
  severity: Severity,
});

/* ------------------------------------------------------------------ *
 * provenance — capture from day one; cannot be backfilled
 * ------------------------------------------------------------------ */

export const Provenance = strictObject({
  authoredBy: z.enum(['human', 'agent', 'agent-drafted']).default('human'),
  agent: strictObject({
    name: z.string().optional(),
    model: z.string().optional(),
    /** e.g. spec-kit, claude-code, copilot */
    harness: z.string().optional(),
    runId: z.string().optional(),
  }).optional(),
  ratifiedBy: Identity.optional(),
  /** Path/URI of the plan or spec this record was derived from. */
  sourceArtifact: z.string().optional(),
  /**
   * Present when an importer created this record rather than an author here.
   * Its presence exempts the record from the deciders-required invariant: the
   * decision was made elsewhere, and fabricating a decider from git blame is
   * worse than an empty field.
   */
  importedFrom: strictObject({
    sourceKind: z.enum(['madr', 'agent-log', 'plan-artifact', 'other']),
    /** Source-local identifier: file path, entry id, or URI. */
    sourceRef: z.string(),
    /** Content hash of the source entry at import time; drives re-import classification. */
    fingerprint: z.string(),
    importedAt: IsoDateTime.optional(),
  }).optional(),
});

/* ------------------------------------------------------------------ *
 * review — ARB routing state
 * ------------------------------------------------------------------ */

export const Objection = strictObject({
  by: Identity,
  summary: z.string().optional(),
  resolved: z.boolean().default(false),
});

export const Review = strictObject({
  tier: ReviewTier.optional(),
  /** Required when a human overrides the router's tier. */
  tierReason: z.string().optional(),
  queuedAt: IsoDateTime.optional(),
  slaDays: z.number().int().min(0).optional(),
  escalatedAt: IsoDateTime.optional(),
  decidedAt: IsoDateTime.optional(),
  quorum: z.number().int().min(1).optional(),
  approvals: z.array(Identity).default([]),
  objections: z.array(Objection).default([]),
});

/* ------------------------------------------------------------------ *
 * evaluation — written by tooling, never by hand
 * ------------------------------------------------------------------ */

export const DeterministicFinding = strictObject({
  rule: z.string(),
  severity: Severity,
  message: z.string().optional(),
  adr: AdrRef.optional(),
});

export const Evaluation = strictObject({
  ranAt: IsoDateTime.optional(),
  evaluatorVersion: z.string().optional(),
  rubricVersion: z.string().optional(),
  /** Per-dimension 0–4, keyed by rubric dimension id. */
  scores: z.record(z.string(), z.number().min(0).max(4)).optional(),
  confidence: z.number().min(0).max(1).optional(),
  escalate: z.boolean().optional(),
  escalationReasons: z.array(EscalationReason).default([]),
  deterministicFindings: z.array(DeterministicFinding).default([]),
});

export const ExternalRef = strictObject({
  type: z.enum(['issue', 'pr', 'rfc', 'incident', 'doc', 'meeting', 'control', 'other']),
  id: z.string().optional(),
  url: z.string().url(),
  label: z.string().optional(),
});

/* ------------------------------------------------------------------ *
 * The record
 * ------------------------------------------------------------------ */

export const AdrFrontmatter = strictObject({
  schemaVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default(SCHEMA_VERSION),

  id: z.string().regex(/^([0-9]{4,}|[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26})$/),
  /** Imperative phrase naming the decision, not the problem. */
  title: z.string().min(3).max(120),
  status: Status,
  date: IsoDate,
  created: IsoDate.optional(),

  deciders: z.array(Identity).default([]),
  consulted: z.array(Identity).default([]),
  informed: z.array(Identity).default([]),

  tags: uniqueArray(Slug).default([]),
  scope: Scope.default('component'),
  domain: z.string().optional(),

  reversibility: Reversibility.default('unknown'),
  blastRadius: BlastRadius.default('component'),

  supersedes: uniqueArray(AdrRef).default([]),
  supersededBy: AdrRef.optional(),
  relatesTo: uniqueArray(AdrRef).default([]),
  /** Knowingly-held tension. A lint warning on accepted records, not an error. */
  conflictsWith: z.array(AdrRef).default([]),

  affects: z.array(AffectsMatcher).default([]),
  assertions: z.array(Assertion).default([]),

  provenance: Provenance.optional(),
  review: Review.optional(),
  evaluation: Evaluation.optional(),

  externalRefs: z.array(ExternalRef).default([]),
  /** e.g. SOC2 CC8.1, ISO 27001 A.8.25 — audit evidence as a byproduct. */
  complianceControls: uniqueArray(z.string()).default([]),
  /** Decisions with an expiry get maintained. Decisions without one rot. */
  reviewBy: IsoDate.optional(),
  })
  /* --- cross-field invariants ------------------------------------- */
  .refine((a) => (a.status === 'superseded' ? Boolean(a.supersededBy) : true), {
    message: 'status "superseded" requires supersededBy',
    path: ['supersededBy'],
  })
  .refine((a) => (a.supersededBy ? a.status === 'superseded' : true), {
    message: 'supersededBy is set but status is not "superseded"',
    path: ['status'],
  })
  .refine(
    (a) =>
      a.status !== 'accepted' ||
      a.deciders.length > 0 ||
      Boolean(a.provenance?.importedFrom),
    {
      message:
        'an accepted decision must name at least one decider, unless it was imported',
      path: ['deciders'],
    },
  )
  .refine(
    (a) =>
      a.status !== 'accepted' ||
      a.provenance?.authoredBy !== 'agent' ||
      Boolean(a.provenance?.ratifiedBy),
    {
      message:
        'an agent-authored record cannot reach "accepted" without a named human ratifier',
      path: ['provenance', 'ratifiedBy'],
    },
  )
  .refine((a) => !(a.reversibility === 'one-way-door' && a.review?.tier === 'auto'), {
    message: 'one-way-door decisions may not take the auto-approve fast path',
    path: ['review', 'tier'],
  });

export type AdrFrontmatter = z.infer<typeof AdrFrontmatter>;

export interface Adr {
  frontmatter: AdrFrontmatter;
  /** Raw markdown body below the frontmatter. */
  body: string;
  /** Repo-relative path, e.g. docs/adr/0042-use-postgres-for-the-index.md */
  path: string;
  /** Log name for federated corpora; undefined for single-repo. */
  log?: string;
}
